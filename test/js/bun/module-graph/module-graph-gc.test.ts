// Bun.ModuleGraph and the garbage collector: what keeps a graph (its loader, module
// records, CommonJS modules and its context) alive, and that nothing else does.
import { generateHeapSnapshotForDebugging, heapStats, jscDescribe } from "bun:jsc";
import { afterAll, describe, expect, jest, test } from "bun:test";
import { rmSync } from "fs";
import { bunEnv, bunExe, isArm64, isLinux, tempDir } from "harness";
import { AsyncLocalStorage } from "node:async_hooks";
import { join } from "path";

const ModuleGraph = Bun.ModuleGraph;
type Graph = InstanceType<typeof ModuleGraph>;

const dir = String(
  tempDir("module-graph-gc-", {
    "keeps-a-file-handle.mjs": `
      import fs from "node:fs";
      export const handle = await fs.promises.open(import.meta.path, "r");
    `,
    "dep.mjs": `export const dep = { tag: typeof TAG === "undefined" ? "host" : TAG };`,
    "esm.mjs": `
      import { dep } from "./dep.mjs";
      export { dep };
      export let n = 0;
      export function inc() { return ++n; }
      export function closure() { let local = { n: 0 }; return () => ++local.n; }
      export const meta = import.meta;
      export const dynamic = () => import("./dep.mjs");
    `,
    "cjs.cjs": `module.exports = { n: 0, inc() { return ++this.n; }, require, module, cache: () => require.cache };`,
    "cjs-dep.cjs": `module.exports = { big: new Array(1000).fill("x") };`,
    "uses-cjs.mjs": `
      import cjs from "./cjs.cjs";
      export default cjs;
      export const dep = cjs.require("./cjs-dep.cjs");
      export const viaMeta = import.meta.require("./cjs.cjs");
    `,
    "tla-stuck.mjs": `await new Promise(() => {}); export const never = 1;`,
    // What the graph opens reports to, and is stopped through, `control` (a host object in
    // `globals`), so the host can stop it without holding anything of the graph.
    "io.mjs": `
      export function serve() {
        const server = Bun.serve({ port: 0, fetch: () => new Response("graph " + TAG) });
        control.httpPort = server.port;
        const watch = setInterval(() => { if (control.stop) { clearInterval(watch); server.stop(true); } }, 1);
      }
      export function tick() {
        const interval = setInterval(() => { control.ticks++; if (control.stop) clearInterval(interval); }, 1);
      }
      // A cron job whose tick waits for something that never comes.
      export function cronTickThatParks() {
        Bun.cron("* * * * *", () => { control.ticks++; return new Promise(() => {}); });
      }
      // A cron job whose tick waits for a promise the host holds.
      export function cronTickThatWaitsFor(promise) {
        Bun.cron("* * * * *", () => { control.ticks++; return promise; });
      }
      export async function connectToOwnServer() {
        const server = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {}, close() { control.heard.push("server socket close"); } } });
        control.tcpPort = server.port;
        await Bun.connect({ hostname: "127.0.0.1", port: server.port, socket: { data() {}, close() { control.heard.push("client close"); } } });
      }
      export function worker() {
        const w = new Worker("data:text/javascript,setInterval(() => {}, 1000); postMessage('up')");
        return new Promise(resolve => { w.onmessage = () => resolve(); w.addEventListener("close", () => control.heard.push("worker close")); });
      }
      // A rewrite whose <div> is never closed, with an onEndTag() callback that reaches the output Response.
      export function rewriteThatWaitsForAnEndTag() {
        let controller;
        const holder = {};
        const registered = Promise.withResolvers();
        holder.response = new HTMLRewriter()
          .on("div", { element(el) { el.onEndTag(() => void holder.response); registered.resolve(); } })
          .transform(new Response(new ReadableStream({ start: c => void (controller = c) })));
        controller.enqueue(new TextEncoder().encode("<div>x"));
        return registered.promise;
      }
    `,
  }),
);
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const file = (name: string) => join(dir, name);

/** A full collection from a timer callback, then a turn for FinalizationRegistry callbacks. Not
 *  from the caller's own continuation: that runs inside a microtask job, which still holds what it
 *  was given (the promise an `await` just resumed from, and through it the module that promise
 *  was fulfilled with). */
function collect(): Promise<void> {
  return new Promise(resolve =>
    setTimeout(() => {
      Bun.gc(true);
      setTimeout(resolve, 0);
    }, 0),
  );
}

/** What these tests mean by "kept alive": a root reaches the cell through the heap. A collection
 *  alone cannot say that. JavaScriptCore also marks whatever a word on the native stack happens to
 *  point at, and a slot a live native frame never writes can hold a cell of an earlier callback's
 *  frames for as long as the loop re-enters that frame, so "it was not finalized" does not mean
 *  something holds it. The debugging heap snapshot has every edge and every root, and no entry for
 *  such words. */
class Heap {
  readonly #className = new Map<number, string>();
  readonly #label = new Map<number, string>();
  readonly #idOfAddress = new Map<bigint, number>();
  /** For each cell a root reaches: the cell it was reached from and the edge, on a shortest path. */
  readonly #reachedFrom = new Map<number, [number, string] | undefined>();
  readonly #rootReason = new Map<number, string>();

  constructor() {
    const { nodes, edges, roots, nodeClassNames, edgeTypes, edgeNames, labels } =
      generateHeapSnapshotForDebugging() as any;
    for (let i = 0; i < nodes.length; i += 7) {
      this.#className.set(nodes[i], nodeClassNames[nodes[i + 2]]);
      if (labels[nodes[i + 4]]) this.#label.set(nodes[i], labels[nodes[i + 4]]);
      this.#idOfAddress.set(BigInt(nodes[i + 5]), nodes[i]);
    }
    const outgoing = new Map<number, [number, string][]>();
    for (let i = 0; i < edges.length; i += 4) {
      const type = edgeTypes[edges[i + 2]];
      const name = type === "Property" || type === "Variable" ? edgeNames[edges[i + 3]] : edges[i + 3];
      let list = outgoing.get(edges[i]);
      if (!list) outgoing.set(edges[i], (list = []));
      list.push([edges[i + 1], type + ":" + name]);
    }
    const queue: number[] = [];
    for (let i = 0; i < roots.length; i += 3) {
      const reason = String(labels[roots[i + 1]] ?? roots[i + 1]);
      // What an output constraint appends (the listeners of a marked EventTarget, ...) is recorded
      // as a root, but only follows from its owner being marked, and the owner's edges say the same.
      if (this.#reachedFrom.has(roots[i]) || reason.includes("DOMGCOutput")) continue;
      this.#rootReason.set(roots[i], reason);
      this.#reachedFrom.set(roots[i], undefined);
      queue.push(roots[i]);
    }
    for (let i = 0; i < queue.length; i++)
      for (const [child, edge] of outgoing.get(queue[i]) ?? [])
        if (!this.#reachedFrom.has(child)) (this.#reachedFrom.set(child, [queue[i], edge]), queue.push(child));
  }

  /** The shortest path from a root to the cell at `address`, or undefined when no root reaches it. */
  pathTo(address: bigint): string | undefined {
    const id = this.#idOfAddress.get(address);
    if (id === undefined || !this.#reachedFrom.has(id)) return undefined;
    const describe = (cell: number) =>
      this.#className.get(cell) + (this.#label.has(cell) ? "(" + this.#label.get(cell) + ")" : "");
    const path: string[] = [];
    let at = id;
    for (let step = this.#reachedFrom.get(at); step; at = step[0], step = this.#reachedFrom.get(at))
      path.unshift(`-${step[1]}-> ${describe(at)}`);
    return [`root(${this.#rootReason.get(at)}) ${describe(at)}`, ...path].join(" ");
  }

  /** How many cells of each type a root reaches. */
  counts(types: string[]): Record<string, number> {
    const counts = Object.fromEntries(types.map(type => [type, 0]));
    for (const id of this.#reachedFrom.keys()) {
      const name = this.#className.get(id)!;
      if (name in counts) counts[name]++;
    }
    return counts;
  }
}

/** The heap as a timer callback sees it: with the caller suspended, so that what its frames hold
 *  is held through the heap, like everything else. The caller's continuation hangs off the promise
 *  returned here, which the timer's callback (on the stack while the snapshot is taken) would
 *  otherwise be the only thing to hold: `pendingHeap` holds it from this module's scope. */
let pendingHeap: Promise<Heap> | undefined;
function heapFromTimer(): Promise<Heap> {
  return (pendingHeap = new Promise(resolve => setTimeout(() => resolve(new Heap()), 0)));
}

const addressOf = (object: object) => BigInt(/0x[0-9a-fA-F]+/.exec(jscDescribe(object))![0]);

/** Lifetimes by name: `track` an object, then ask which are gone or still kept alive.
 *  A finalized object is gone, and that is all most runs need. One that is not finalized after a
 *  few collections is looked up in the heap (its cell is its own for as long as it is not
 *  collected): kept alive only if a root reaches it. A snapshot is slow on a debug build, so it
 *  is taken only then. */
class Lifetimes {
  #finalized = new Set<string>();
  #registry = new FinalizationRegistry<string>(name => this.#finalized.add(name));
  #address = new Map<string, bigint>();
  track<T extends object>(name: string, object: T): T {
    this.#registry.register(object, name);
    this.#address.set(name, addressOf(object));
    return object;
  }
  #notFinalized(names: string[]): string[] {
    const untracked = names.filter(name => !this.#address.has(name));
    if (untracked.length) throw new Error("never tracked: " + untracked.join(", "));
    return names.filter(name => !this.#finalized.has(name));
  }
  /** Of `names`, those a root reaches, each with its path. */
  async #kept(names: string[]): Promise<Map<string, string>> {
    const heap = await heapFromTimer();
    const kept = new Map<string, string>();
    for (const name of this.#notFinalized(names)) {
      const path = heap.pathTo(this.#address.get(name)!);
      if (path !== undefined) kept.set(name, path);
    }
    return kept;
  }
  /** Collects until nothing keeps any of `names` alive (bounded); returns those still kept, with what keeps them. */
  async stillAlive(...names: string[]): Promise<string[]> {
    let waiting = this.#notFinalized(names);
    for (let i = 0; i < 100 && waiting.length; i++) {
      await collect();
      waiting = this.#notFinalized(waiting);
      // Not finalized after a few collections: from here on only what a root reaches is waited for.
      if (i === 4 && waiting.length) waiting = [...(await this.#kept(waiting)).keys()];
    }
    if (!waiting.length) return [];
    return [...(await this.#kept(waiting))].map(([name, path]) => `${name}: ${path}`);
  }
  /** Collects a few times; whether `name` survived all of them. Every caller expects it to, so
   *  this goes by finalization alone: a stack word can only make that pass, and asking the heap
   *  would cost each of them a snapshot. */
  async survives(name: string): Promise<boolean> {
    for (let i = 0; i < 5; i++) {
      await collect();
    }
    return this.#notFinalized([name]).length > 0;
  }
}

const count = (type: string) => heapStats().objectTypeCounts[type] ?? 0;
/** Collects until the count of each type is at most its limit (bounded); returns the counts. When
 *  the collector's own counts stay above a limit, what counts is the cells a root reaches. The
 *  limits come from the collector's counts (a snapshot per baseline is too slow on a debug build),
 *  which can only be higher than what a root reached then. */
async function settle(limits: Record<string, number>): Promise<Record<string, number>> {
  const types = Object.keys(limits);
  const counts = () => {
    const all = heapStats().objectTypeCounts;
    return Object.fromEntries(types.map(type => [type, all[type] ?? 0]));
  };
  let now = counts();
  for (let i = 0; i < 100 && types.some(type => now[type] > limits[type]); i++) {
    await collect();
    now = counts();
  }
  return types.some(type => now[type] > limits[type]) ? (await heapFromTimer()).counts(types) : now;
}
/** The counts after what is already garbage has been collected. */
async function baselineOf(...types: string[]): Promise<Record<string, number>> {
  for (let i = 0; i < 5; i++) {
    await collect();
  }
  const all = heapStats().objectTypeCounts;
  return Object.fromEntries(types.map(type => [type, all[type] ?? 0]));
}

async function accepts(port: number): Promise<boolean> {
  try {
    const socket = await Bun.connect({ hostname: "127.0.0.1", port, socket: { data() {} } });
    socket.end();
    return true;
  } catch {
    return false;
  }
}

describe("ModuleGraph GC: an unreferenced graph is collected", () => {
  class Subclass extends ModuleGraph {}
  const kinds: [string, () => Graph][] = [
    ["without options", () => new ModuleGraph()],
    ["with globals and onError", () => new ModuleGraph({ globals: { TAG: "g" }, onError() {} })],
    ["subclass", () => new Subclass()],
  ];
  for (const [kind, make] of kinds) {
    test(kind, async () => {
      const lifetimes = new Lifetimes();
      await (async () => {
        lifetimes.track("never imported", make());

        const imported = lifetimes.track("imported", make());
        const namespace = lifetimes.track("imported namespace", await imported.import(file("esm.mjs")));
        expect(namespace.inc()).toBe(1);

        const withCommonJS = lifetimes.track("imported CommonJS", make());
        const cjs = (await withCommonJS.import(file("uses-cjs.mjs"))).default;
        expect(cjs.inc()).toBe(1);
        lifetimes.track("CommonJS module", cjs.module);
        lifetimes.track("require.cache", cjs.cache());

        const disposed = lifetimes.track("disposed", make());
        await disposed.import(file("esm.mjs"));
        disposed.dispose();

        const stuck = lifetimes.track("import pending forever", make());
        stuck.import(file("tla-stuck.mjs"));

        const disposedWhilePending = lifetimes.track("disposed while an import is pending", make());
        const rejected = disposedWhilePending.import(file("tla-stuck.mjs")).then(
          () => "fulfilled",
          error => String(error),
        );
        disposedWhilePending.dispose();
        expect(await rejected).toContain("ModuleGraph has been disposed");
      })();
      expect(
        await lifetimes.stillAlive(
          "never imported",
          "imported",
          "imported namespace",
          "imported CommonJS",
          "CommonJS module",
          "require.cache",
          "disposed",
          "import pending forever",
          "disposed while an import is pending",
        ),
      ).toEqual([]);
    });
  }

  test("reference cycles through globals and onError do not keep a graph alive", async () => {
    const lifetimes = new Lifetimes();
    await (async () => {
      const holder: { graph?: Graph; namespace?: unknown } = {};
      const graph = lifetimes.track(
        "graph",
        new ModuleGraph({
          globals: { TAG: "cycle", holder },
          onError() {
            void graph;
          },
        }),
      );
      holder.graph = graph;
      holder.namespace = await graph.import(file("esm.mjs"));
      lifetimes.track("holder", holder);
    })();
    expect(await lifetimes.stillAlive("graph", "holder")).toEqual([]);
  });
});

describe("ModuleGraph GC: what a graph's code made keeps the graph alive, and only while the host holds it", () => {
  const holders: [string, (graph: Graph) => Promise<unknown>][] = [
    ["a module namespace", graph => graph.import(file("esm.mjs"))],
    ["an exported function", async graph => (await graph.import(file("esm.mjs"))).inc],
    ["a closure made by an exported function", async graph => (await graph.import(file("esm.mjs"))).closure()],
    ["import.meta", async graph => (await graph.import(file("esm.mjs"))).meta],
    ["an object created by the graph's module", async graph => (await graph.import(file("esm.mjs"))).dep],
    ["a CommonJS module", async graph => (await graph.import(file("uses-cjs.mjs"))).default.module],
    ["a CommonJS module's require", async graph => (await graph.import(file("uses-cjs.mjs"))).default.require],
    ["import.meta.require's result", async graph => (await graph.import(file("uses-cjs.mjs"))).viaMeta],
    ["the graph's require.cache", async graph => (await graph.import(file("uses-cjs.mjs"))).default.cache()],
  ];
  for (const [what, hold] of holders) {
    test(what, async () => {
      const lifetimes = new Lifetimes();
      // What is held lives in `box` only: an awaited value can outlive the variable it was
      // assigned to in the awaiting function's saved frame.
      const box: { held?: unknown } = {};
      await (async () => {
        box.held = await hold(lifetimes.track("graph", new ModuleGraph({ globals: { TAG: "held" } })));
      })();
      // Plain data the module made does not reference its module; everything else does.
      const keepsAlive = what !== "an object created by the graph's module";
      if (keepsAlive) expect(await lifetimes.survives("graph")).toBe(true);
      else expect(await lifetimes.stillAlive("graph")).toEqual([]);
      expect(typeof box.held).toMatch(/object|function/);
      box.held = undefined;
      expect(await lifetimes.stillAlive("graph")).toEqual([]);
    });
  }

  test("a graph's code still works after the host dropped the graph object", async () => {
    const lifetimes = new Lifetimes();
    const namespace = await (async () => {
      const graph = lifetimes.track("graph", new ModuleGraph({ globals: { TAG: "dropped" } }));
      return await graph.import(file("uses-cjs.mjs"));
    })();
    for (let i = 0; i < 3; i++) Bun.gc(true);
    // import() from the graph's code and require() in the graph still find the graph.
    const esm = await namespace.default.require(file("esm.mjs"));
    expect(esm.dep).toEqual({ tag: "dropped" });
    expect((await esm.dynamic()).dep).toBe(esm.dep);
    expect(namespace.default.inc()).toBe(1);
    expect(await lifetimes.survives("graph")).toBe(true);
  });
});

describe("ModuleGraph GC: cells a graph made go with it", () => {
  test("module records, environments, loaders and CommonJS modules return to the baseline", async () => {
    // Warm up: the host's own copies and everything lazily created stay.
    await (async () => {
      const graph = new ModuleGraph({ globals: { TAG: "warm" } });
      (await graph.import(file("uses-cjs.mjs"))).default.cache();
      await graph.import(file("esm.mjs"));
    })();
    const types = [
      "ModuleGraph",
      "JSModuleLoader",
      "JSModuleRecord",
      "SyntheticModuleRecord",
      "JSModuleEnvironment",
      "Module",
    ];
    const baseline = await baselineOf(...types);

    await (async () => {
      const graphs: Graph[] = [];
      for (let i = 0; i < 8; i++) {
        const graph = new ModuleGraph({ globals: { TAG: "t" + i } });
        (await graph.import(file("uses-cjs.mjs"))).default.cache();
        await graph.import(file("esm.mjs"));
        graphs.push(graph);
      }
      // Eight graphs' worth exist now.
      expect(count("ModuleGraph") - baseline.ModuleGraph).toBeGreaterThanOrEqual(8);
      expect(count("Module") - baseline.Module).toBeGreaterThanOrEqual(16);
    })();

    const after = await settle(baseline);
    expect(Object.keys(after).filter(type => after[type] > baseline[type])).toEqual([]);
  });

  test("a disposed graph the host still holds keeps none of its modules", async () => {
    await (async () => {
      const graph = new ModuleGraph({ globals: { TAG: "warm" } });
      await graph.import(file("esm.mjs"));
    })();
    const types = ["JSModuleRecord", "JSModuleEnvironment"];
    const baseline = await baselineOf(...types);
    const held: Graph[] = [];
    await (async () => {
      for (let i = 0; i < 8; i++) {
        const graph = new ModuleGraph({ globals: { TAG: "held" + i } });
        await graph.import(file("esm.mjs"));
        graph.dispose();
        held.push(graph);
      }
    })();
    // Kept, it is every module of all eight: sixteen of each type.
    const limits = Object.fromEntries(types.map(type => [type, baseline[type] + 7]));
    const after = await settle(limits);
    expect(Object.keys(after).filter(type => after[type] > limits[type])).toEqual([]);
    expect(held.length).toBe(8);
  });

  test("overlay symbol tables of graphs that are gone are not retained", async () => {
    const make = async (names: number) => {
      for (let i = 0; i < names; i++) {
        const graph = new ModuleGraph({ globals: { ["unique_global_" + i]: i, TAG: "shape" } });
        await graph.import(file("esm.mjs"));
      }
    };
    await make(2);
    const { SymbolTable: baseline } = await baselineOf("SymbolTable");
    await make(30);
    expect((await settle({ SymbolTable: baseline + 10 })).SymbolTable).toBeLessThanOrEqual(baseline + 10);
  });

  test("the host's copy of a file a collected graph also loaded is untouched", async () => {
    const hostRequire = require("node:module").createRequire(import.meta.url);
    const before = hostRequire(file("cjs.cjs"));
    before.inc();
    const lifetimes = new Lifetimes();
    await (async () => {
      const graph = lifetimes.track("graph", new ModuleGraph());
      const inGraph = (await graph.import(file("uses-cjs.mjs"))).default;
      // (Compared here, so no matcher object ever holds the graph's exports.)
      expect(inGraph !== before).toBe(true);
      expect(inGraph.n).toBe(0);
    })();
    expect(await lifetimes.stillAlive("graph")).toEqual([]);
    expect(hostRequire(file("cjs.cjs"))).toBe(before);
    expect(before.n).toBe(1);
  });
});

describe("ModuleGraph GC: what the graph's context owns", () => {
  const control = () => ({ stop: false, ticks: 0, httpPort: 0, tcpPort: 0, heard: [] as string[] });

  test("a listening server keeps its graph alive and serving after the host dropped the graph; stopping it lets the graph go", async () => {
    const lifetimes = new Lifetimes();
    const state = control();
    await (async () => {
      const graph = lifetimes.track("graph", new ModuleGraph({ globals: { TAG: "served", control: state } }));
      const io = await graph.import(file("io.mjs"));
      graph.run(() => io.serve());
    })();
    expect(await lifetimes.survives("graph")).toBe(true);
    expect(await (await fetch(`http://127.0.0.1:${state.httpPort}/`)).text()).toBe("graph served");
    state.stop = true;
    expect(await lifetimes.stillAlive("graph")).toEqual([]);
    expect(await accepts(state.httpPort)).toBe(false);
  });

  test("a repeating timer keeps its graph alive; clearing it lets the graph go", async () => {
    const lifetimes = new Lifetimes();
    const state = control();
    await (async () => {
      const graph = lifetimes.track("graph", new ModuleGraph({ globals: { control: state } }));
      const io = await graph.import(file("io.mjs"));
      graph.run(() => io.tick());
    })();
    expect(await lifetimes.survives("graph")).toBe(true);
    const ticks = state.ticks;
    while (state.ticks === ticks) await new Promise<void>(resolve => setImmediate(resolve));
    state.stop = true;
    expect(await lifetimes.stillAlive("graph")).toEqual([]);
  });

  // The job holds a ref on itself while a tick's promise is pending; nothing settles it once the graph is disposed.
  test("a Bun.cron() job whose tick is waiting when its graph is disposed goes with the graph", async () => {
    const lifetimes = new Lifetimes();
    const state = control();
    jest.useFakeTimers();
    try {
      jest.setSystemTime(new Date("2026-01-01T12:00:00.000Z"));
      await (async () => {
        const graph = lifetimes.track("graph", new ModuleGraph({ globals: { control: state } }));
        const io = await graph.import(file("io.mjs"));
        graph.run(() => io.cronTickThatParks());
        jest.advanceTimersByTime(60_000);
        expect(state.ticks).toBe(1);
        graph.dispose();
      })();
    } finally {
      jest.useRealTimers();
    }
    expect(await lifetimes.stillAlive("graph")).toEqual([]);
  });

  // The callback was a GC root until its end tag came, and it reached its own rewrite through the Response.
  test("an HTMLRewriter rewrite that waits for an end tag when its graph is disposed goes with the graph", async () => {
    const lifetimes = new Lifetimes();
    await (async () => {
      const graph = lifetimes.track("graph", new ModuleGraph());
      const io = await graph.import(file("io.mjs"));
      await graph.run(() => io.rewriteThatWaitsForAnEndTag());
      graph.dispose();
    })();
    expect(await lifetimes.stillAlive("graph")).toEqual([]);
  });

  // The tick's promise is the host's to settle: the job is still there when it does, and gone afterwards.
  for (const how of ["resolves", "rejects"] as const) {
    test(`a Bun.cron() job whose tick waits on a promise the host ${how} after the graph was disposed: the job outlives the wait, and the graph goes`, async () => {
      const lifetimes = new Lifetimes();
      const state = control();
      const held = Promise.withResolvers<void>();
      held.promise.catch(() => {});
      const told: string[] = [];
      jest.useFakeTimers();
      try {
        jest.setSystemTime(new Date("2026-01-01T12:00:00.000Z"));
        await (async () => {
          const graph = lifetimes.track(
            "graph",
            new ModuleGraph({
              globals: { control: state },
              onError: (error: any, kind) => told.push(kind + ": " + error.message),
            }),
          );
          const io = await graph.import(file("io.mjs"));
          graph.run(() => io.cronTickThatWaitsFor(held.promise));
          jest.advanceTimersByTime(60_000);
          expect(state.ticks).toBe(1);
          graph.dispose();
        })();
      } finally {
        jest.useRealTimers();
      }
      // While the host holds the promise, its reactions keep the job, and the context they run in.
      for (let i = 0; i < 3; i++) {
        Bun.gc(true);
        await new Promise<void>(resolve => setImmediate(resolve));
      }
      how === "resolves" ? held.resolve() : held.reject(new Error("the host gave up"));
      // The reaction runs and lets the job go: a tick that rejected is reported, as for any job, to the
      // graph it ran in; the tick does not run again.
      for (let i = 0; i < 5; i++) await new Promise<void>(resolve => setImmediate(resolve));
      Bun.gc(true);
      expect(told).toEqual(how === "resolves" ? [] : ["unhandledRejection: the host gave up"]);
      expect(state.ticks).toBe(1);
      expect(await lifetimes.stillAlive("graph")).toEqual([]);
    });
  }

  test("run(): what the host opens inside the graph's context keeps the graph alive until it is closed", async () => {
    const lifetimes = new Lifetimes();
    let timer: Timer | undefined;
    let snapshot: (<R>(fn: () => R) => R) | undefined;
    await (async () => {
      const timed = lifetimes.track("with a pending timer", new ModuleGraph());
      timer = timed.run(() => setTimeout(() => {}, 1_000_000));
      const snapshotted = lifetimes.track("with a captured async context", new ModuleGraph());
      snapshot = snapshotted.run(() => AsyncLocalStorage.snapshot());
      lifetimes.track("ran and returned", new ModuleGraph()).run(() => 1);
    })();
    expect(await lifetimes.stillAlive("ran and returned")).toEqual([]);
    expect(await lifetimes.survives("with a pending timer")).toBe(true);
    expect(await lifetimes.survives("with a captured async context")).toBe(true);
    clearTimeout(timer);
    timer = undefined;
    snapshot = undefined;
    expect(await lifetimes.stillAlive("with a pending timer", "with a captured async context")).toEqual([]);
  });

  test("dispose() and a collection in the same tick: no close handler is called, and the graph goes", async () => {
    const lifetimes = new Lifetimes();
    const state = control();
    await (async () => {
      const graph = lifetimes.track("graph", new ModuleGraph({ globals: { control: state } }));
      const io = await graph.import(file("io.mjs"));
      await graph.run(() => io.connectToOwnServer());
      await graph.run(() => io.worker());
      graph.dispose();
      Bun.gc(true);
    })();
    Bun.gc(true);
    expect(await lifetimes.stillAlive("graph")).toEqual([]);
    expect(state.heard).toEqual([]);
    expect(await accepts(state.tcpPort)).toBe(false);
  });

  test("a graph dropped without dispose() while it has things open: closing them from inside lets it go, and nothing of it is left open", async () => {
    const lifetimes = new Lifetimes();
    const states = Array.from({ length: 10 }, control);
    await (async () => {
      for (const [i, state] of states.entries()) {
        const graph = lifetimes.track("graph " + i, new ModuleGraph({ globals: { TAG: "n" + i, control: state } }));
        const io = await graph.import(file("io.mjs"));
        graph.run(() => (io.serve(), io.tick()));
      }
    })();
    const open = () => Promise.all(states.map(state => accepts(state.httpPort)));
    expect(await open()).toEqual(states.map(() => true));
    for (const state of states) state.stop = true;
    expect(await lifetimes.stillAlive(...states.map((_, i) => "graph " + i))).toEqual([]);
    expect(await open()).toEqual(states.map(() => false));
  });

  test("creating, using and disposing many graphs leaves no graph, no protected value and no open port behind", async () => {
    const round = async (graphs: number) => {
      const states = Array.from({ length: graphs }, control);
      for (const [i, state] of states.entries()) {
        const graph = new ModuleGraph({ globals: { TAG: "c" + i, control: state } });
        const io = await graph.import(file("io.mjs"));
        graph.run(() => (io.serve(), io.tick()));
        await graph.run(() => io.connectToOwnServer());
        graph.dispose();
      }
      return states;
    };
    await round(3);
    const { ModuleGraph: graphsBefore } = await baselineOf("ModuleGraph");
    const protectedBefore = heapStats().protectedObjectCount;
    const states = await round(15);
    expect((await settle({ ModuleGraph: graphsBefore })).ModuleGraph).toBeLessThanOrEqual(graphsBefore);
    await collect();
    expect(heapStats().protectedObjectCount).toBeLessThanOrEqual(protectedBefore + 5);
    const open = await Promise.all(states.flatMap(state => [accepts(state.httpPort), accepts(state.tcpPort)]));
    expect(open).toEqual(open.map(() => false));
  });
});

// node:fs remembers every open FileHandle for the life of the realm, to close the ones nobody
// did: what it remembers of one must not hold the graph whose module holds the handle.
describe.concurrent("ModuleGraph GC: node:fs's record of open FileHandles", () => {
  // TODO: fails on every build on the three Linux aarch64 CI lanes and nowhere else (it passes on the CI's own
  // Linux aarch64 build under emulation, and on macOS arm64). What holds the graph there is not established: the
  // fixture is a child process and prints no heap snapshot.
  test.todoIf(isLinux && isArm64)("a dropped graph whose module keeps a FileHandle open is collected", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          // (node:fs reports the handle nobody closed; whoever that reaches, it is not the point here.)
          process.on("uncaughtException", () => {});
          let collected = false;
          const registry = new FinalizationRegistry(() => { collected = true; });
          await (async () => {
            const graph = new Bun.ModuleGraph({ onError() {} });
            registry.register(graph, "graph");
            await graph.import(${JSON.stringify(join(dir, "keeps-a-file-handle.mjs"))});
          })();
          for (let i = 0; i < 200 && !collected; i++) { Bun.gc(true); await new Promise(resolve => setImmediate(resolve)); }
          console.log(JSON.stringify({ collected }));
          process.exit(0);
          `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "inherit",
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    expect(stdout.trim()).toBe(`{"collected":true}`);
    expect(exitCode).toBe(0);
  });
});

test("ModuleGraph GC: survives collecting continuously", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const { join } = require("path");
      const dir = ${JSON.stringify(dir)};
      for (let i = 0; i < 3; i++) {
        const control = { stop: false, ticks: 0, httpPort: 0, tcpPort: 0, heard: [] };
        const graph = new Bun.ModuleGraph({ globals: { TAG: "cc" + i, control } });
        const cjs = (await graph.import(join(dir, "uses-cjs.mjs"))).default;
        cjs.inc(); cjs.cache();
        const esm = await graph.import(join(dir, "esm.mjs"));
        esm.inc(); await esm.dynamic();
        if (i % 2 === 0) { const io = await graph.import(join(dir, "io.mjs")); graph.run(() => io.tick()); await graph.run(() => io.connectToOwnServer()); }
        graph.dispose();
        await new Promise(resolve => setImmediate(resolve));
      }
      console.log("ok");
      `,
    ],
    env: { ...bunEnv, BUN_JSC_collectContinuously: "1" },
    stdout: "pipe",
    stderr: "inherit",
  });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  expect(stdout).toBe("ok\n");
  expect(exitCode).toBe(0);
}, 60_000);

// The period puts a collection in the middle of the signal's abort steps, whatever came before.
test.concurrent.each([2, 3, 4])(
  "ModuleGraph GC: aborting a signal whose fetch responses are garbage, collecting every %i slow allocations",
  async period => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        using server = Bun.serve({ port: 0, fetch: () => new Response("ok") });
        const graph = new Bun.ModuleGraph(), other = new Bun.ModuleGraph();
        const controller = new AbortController();
        const signal = AbortSignal.any([controller.signal]);
        const held = { responses: [] };
        await (async () => {
          for (let i = 0; i < 1000; i += 50) {
            const batch = await graph.run(() => Promise.all(Array.from({ length: 50 }, () => fetch(server.url, { signal }))));
            for (const response of batch) await response.text();
            held.responses.push(...batch);
          }
        })();
        // Runs between the controller's signal's abort steps and the dependent signal's.
        controller.signal.addEventListener("abort", () => { held.responses = undefined; });
        other.run(() => controller.abort());
        console.log("ok");
        `,
      ],
      env: { ...bunEnv, BUN_JSC_slowPathAllocsBetweenGCs: String(period) },
      stdout: "pipe",
      stderr: "inherit",
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    expect(stdout).toBe("ok\n");
    expect(exitCode).toBe(0);
  },
  60_000,
);
