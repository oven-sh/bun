// Bun.ModuleGraph and the garbage collector: what keeps a graph (its loader, module
// records, CommonJS modules and, with `isolateIO`, its context) alive, and that nothing else does.
import { heapStats } from "bun:jsc";
import { afterAll, describe, expect, test } from "bun:test";
import { rmSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
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
      export async function connectToOwnServer() {
        const server = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {}, close() { control.heard.push("server socket close"); } } });
        control.tcpPort = server.port;
        await Bun.connect({ hostname: "127.0.0.1", port: server.port, socket: { data() {}, close() { control.heard.push("client close"); } } });
      }
      export function worker() {
        const w = new Worker("data:text/javascript,setInterval(() => {}, 1000); postMessage('up')");
        return new Promise(resolve => { w.onmessage = () => resolve(); w.addEventListener("close", () => control.heard.push("worker close")); });
      }
    `,
  }),
);
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const file = (name: string) => join(dir, name);

/** A full collection from a timer callback, then a turn for FinalizationRegistry callbacks. Not
 *  from the caller's own continuation: the native frame that runs microtasks still holds what the
 *  microtasks before it were given (an import()'s settle reaction is given its graph). */
function collect(): Promise<void> {
  return new Promise(resolve =>
    setTimeout(() => {
      Bun.gc(true);
      setTimeout(resolve, 0);
    }, 0),
  );
}

/** For a failure message: from the debugging heap snapshot, what keeps each live `ModuleGraph` cell
 *  (shortest path from a root), or that nothing in the heap does. */
function whatRetainsGraphs(): string[] {
  const snapshot = require("bun:jsc").generateHeapSnapshotForDebugging() as any;
  const { nodes, edges, roots, nodeClassNames, edgeTypes, edgeNames, labels } = snapshot;
  const className = new Map<number, string>();
  for (let i = 0; i < nodes.length; i += 7)
    className.set(
      nodes[i],
      nodeClassNames[nodes[i + 2]] + (labels[nodes[i + 4]] ? "(" + labels[nodes[i + 4]] + ")" : ""),
    );
  const incoming = new Map<number, [number, string][]>();
  for (let i = 0; i < edges.length; i += 4) {
    const type = edgeTypes[edges[i + 2]];
    const name = type === "Property" || type === "Variable" ? edgeNames[edges[i + 3]] : edges[i + 3];
    let list = incoming.get(edges[i + 1]);
    if (!list) incoming.set(edges[i + 1], (list = []));
    list.push([edges[i], type + ":" + name]);
  }
  const rootReason = new Map<number, string>();
  for (let i = 0; i < roots.length; i += 3) rootReason.set(roots[i], String(labels[roots[i + 1]] ?? roots[i + 1]));
  const report: string[] = [];
  for (const [id, name] of className) {
    // A graph (not the constructor or the prototype) is what an overlay's `moduleGraph` variable holds.
    if (
      !name.startsWith("ModuleGraph") ||
      !(incoming.get(id) ?? []).some(([, edge]) => edge === "Variable:moduleGraph")
    )
      continue;
    const from = new Map<number, [number, string] | undefined>([[id, undefined]]);
    const queue = [id];
    let root: number | undefined;
    while (queue.length && root === undefined) {
      const at = queue.shift()!;
      if (rootReason.has(at)) root = at;
      else
        for (const [parent, edge] of incoming.get(at) ?? [])
          if (!from.has(parent)) (from.set(parent, [at, edge]), queue.push(parent));
    }
    if (root === undefined) {
      // Unreached from any root, so held from the machine stack or a register, through one of the
      // cells that lead to it: most likely one nothing in the heap points at.
      const ancestors = [...from.keys()];
      const entries = ancestors.filter(cell => !incoming.get(cell)?.length).map(cell => className.get(cell));
      const classes = [...new Set(ancestors.map(cell => className.get(cell)))];
      const pointsAt = (cell: number) => {
        const out: string[] = [];
        for (let i = 0; i < edges.length; i += 4) {
          if (edges[i] !== cell) continue;
          const type = edgeTypes[edges[i + 2]];
          out.push(
            (type === "Property" || type === "Variable" ? edgeNames[edges[i + 3]] : type + edges[i + 3]) +
              "->" +
              className.get(edges[i + 1]),
          );
        }
        return out.join(", ");
      };
      for (const cell of ancestors.filter(cell => !incoming.get(cell)?.length))
        report.push(
          `${name}#${id}: ${className.get(cell)}#${cell}, which nothing in the heap points at, points at: ${pointsAt(cell)}`,
        );
      report.push(
        `${name}#${id}: island of ${ancestors.length} cells (${classes.join(", ")}); nothing in the heap points at: ${entries.join(", ") || "(none: a cycle)"}`,
      );
      report.push(
        `${name}#${id}: no root reaches it; held from ${[...(incoming.get(id) ?? [])].map(([parent, edge]) => className.get(parent) + " " + edge).join(", ") || "nothing"}`,
      );
      continue;
    }
    const path = [`root(${rootReason.get(root)}) ${className.get(root)}`];
    for (let at = root, step = from.get(at); step; at = step[0], step = from.get(at))
      path.push(`-${step[1]}-> ${className.get(step[0])}`);
    report.push(`${name}#${id}: ${path.join(" ")}`);
  }
  return report;
}

/** Lifetimes by name: `track` an object, then ask which are `gone` or still `alive`. */
class Lifetimes {
  #finalized = new Set<string>();
  #registry = new FinalizationRegistry<string>(name => this.#finalized.add(name));
  track<T extends object>(name: string, object: T): T {
    this.#registry.register(object, name);
    return object;
  }
  /** Collects until every name is finalized (bounded); returns the names that still are not. */
  async stillAlive(...names: string[]): Promise<string[]> {
    const remaining = () => names.filter(name => !this.#finalized.has(name));
    for (let i = 0; i < 100 && remaining().length; i++) {
      await collect();
    }
    if (!remaining().length) return [];
    const survivors = remaining();
    // Before anything else runs (the snapshot below is a lot of other code): the same collection
    // from a timer callback, after that callback recursed and returned, which writes over the
    // stack its collection is about to run on. If that alone gets the survivor, it was held from
    // there. For the failure message only: the result is a failure whatever this finds.
    for (let i = 0; i < 3 && remaining().length; i++) {
      await new Promise<void>(resolve =>
        setTimeout(() => {
          const recurse = (depth: number): number => (depth ? recurse(depth - 1) + 1 : 0);
          recurse(256);
          Bun.gc(true);
          setTimeout(resolve, 0);
        }, 0),
      );
    }
    const afterRecursing = `after 100 collections from timer callbacks, 3 more from a timer callback that first recursed 256 frames and returned: ${survivors.length - remaining().length} of ${survivors.length} collected`;
    // The same recursion, but from this function's continuation (a microtask run after a timer
    // callback returned, not inside one), and no collection there: then collections from timer
    // callbacks as before. It writes over the depths the timer dispatch's own native frames use.
    const beforeContinuation = remaining().length;
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    {
      const recurse = (depth: number): number => (depth ? recurse(depth - 1) + 1 : 0);
      recurse(256);
    }
    for (let i = 0; i < 3 && remaining().length; i++) await collect();
    const afterContinuation = `then 3 more from timer callbacks after a continuation (not a timer callback) recursed 256 frames: ${beforeContinuation - remaining().length} of ${beforeContinuation} collected`;
    // A heap snapshot that is thrown away (it collects by itself), then the same collections:
    // separates what taking the snapshot does from what analysing it (a lot of script) does.
    const beforeSnapshot = remaining().length;
    if (beforeSnapshot) void require("bun:jsc").generateHeapSnapshotForDebugging();
    for (let i = 0; i < 3 && remaining().length; i++) await collect();
    const afterSnapshot = `then 3 more from timer callbacks after a heap snapshot that was thrown away: ${beforeSnapshot - remaining().length} of ${beforeSnapshot} collected`;
    // Say what keeps them, not just that something does.
    const report = [
      ...survivors,
      afterRecursing,
      afterContinuation,
      afterSnapshot,
      ...(remaining().length ? whatRetainsGraphs() : []),
    ];
    // When no root reaches a survivor, say from where a collection does get it: only for the
    // failure message (the result is a failure whatever these find).
    const turn = () => new Promise<void>(resolve => setTimeout(resolve, 0));
    const probes: [string, () => Promise<void>][] = [
      // (First, so that what the heap snapshot above changed is not credited to a later probe.)
      ["timer callbacks again", collect],
      // If what holds it is something the timer path writes only for a repeating timer, the next
      // repeating timer to fire replaces it.
      [
        "timer callbacks, after an unrelated interval fired once and cleared itself",
        async () => {
          await new Promise<void>(resolve => {
            const interval = setInterval(() => (clearInterval(interval), resolve()), 1);
          });
          await collect();
        },
      ],
      ["a setImmediate callback", () => new Promise<void>(resolve => setImmediate(() => (Bun.gc(true), resolve())))],
      ["a microtask", async () => (await Promise.resolve(), void Bun.gc(true))],
      [
        "a timer callback, 64 JS frames deeper",
        () =>
          new Promise<void>(resolve =>
            setTimeout(() => {
              const deeper = (depth: number): void => (depth ? deeper(depth - 1) : void Bun.gc(true));
              deeper(64);
              resolve();
            }, 0),
          ),
      ],
    ];
    for (const [where, probe] of probes) {
      const before = remaining().length;
      for (let i = 0; i < 3 && remaining().length; i++) {
        await probe();
        await turn();
      }
      report.push(
        `after 100 collections from timer callbacks, 3 more from ${where}: ${before - remaining().length} of ${before} collected`,
      );
    }
    return report;
  }
  /** Collects a few times; whether `name` survived all of them. */
  async survives(name: string): Promise<boolean> {
    for (let i = 0; i < 5; i++) {
      await collect();
    }
    return !this.#finalized.has(name);
  }
}

const count = (type: string) => heapStats().objectTypeCounts[type] ?? 0;
/** Collects until the count of each type is at most its limit (bounded); returns the counts. */
async function settle(limits: Record<string, number>): Promise<Record<string, number>> {
  const counts = () => {
    const all = heapStats().objectTypeCounts;
    return Object.fromEntries(Object.keys(limits).map(type => [type, all[type] ?? 0]));
  };
  let now = counts();
  for (let i = 0; i < 100 && Object.keys(limits).some(type => now[type] > limits[type]); i++) {
    await collect();
    now = counts();
  }
  return now;
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
    ["plain", () => new ModuleGraph()],
    ["with globals and onError", () => new ModuleGraph({ globals: { TAG: "g" }, onError() {} })],
    ["isolateIO", () => new ModuleGraph({ isolateIO: true })],
    ["subclass", () => new Subclass({ isolateIO: true })],
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
      expect(await lifetimes.survives("graph")).toBe(keepsAlive);
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

describe("ModuleGraph GC: isolateIO", () => {
  const control = () => ({ stop: false, ticks: 0, httpPort: 0, tcpPort: 0, heard: [] as string[] });

  test("a listening server keeps its graph alive and serving after the host dropped the graph; stopping it lets the graph go", async () => {
    const lifetimes = new Lifetimes();
    const state = control();
    await (async () => {
      const graph = lifetimes.track(
        "graph",
        new ModuleGraph({ isolateIO: true, globals: { TAG: "served", control: state } }),
      );
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
      const graph = lifetimes.track("graph", new ModuleGraph({ isolateIO: true, globals: { control: state } }));
      const io = await graph.import(file("io.mjs"));
      graph.run(() => io.tick());
    })();
    expect(await lifetimes.survives("graph")).toBe(true);
    const ticks = state.ticks;
    while (state.ticks === ticks) await new Promise<void>(resolve => setImmediate(resolve));
    state.stop = true;
    expect(await lifetimes.stillAlive("graph")).toEqual([]);
  });

  test("run(): what the host opens inside the graph's context keeps the graph alive until it is closed", async () => {
    const lifetimes = new Lifetimes();
    let timer: Timer | undefined;
    let snapshot: (<R>(fn: () => R) => R) | undefined;
    await (async () => {
      const timed = lifetimes.track("with a pending timer", new ModuleGraph({ isolateIO: true }));
      timer = timed.run(() => setTimeout(() => {}, 1_000_000));
      const snapshotted = lifetimes.track("with a captured async context", new ModuleGraph({ isolateIO: true }));
      snapshot = snapshotted.run(() => AsyncLocalStorage.snapshot());
      lifetimes.track("ran and returned", new ModuleGraph({ isolateIO: true })).run(() => 1);
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
      const graph = lifetimes.track("graph", new ModuleGraph({ isolateIO: true, globals: { control: state } }));
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
        const graph = lifetimes.track(
          "graph " + i,
          new ModuleGraph({ isolateIO: true, globals: { TAG: "n" + i, control: state } }),
        );
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
        const graph = new ModuleGraph({ isolateIO: true, globals: { TAG: "c" + i, control: state } });
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
describe.concurrent("ModuleGraph GC: a dropped graph whose module keeps a FileHandle open is collected", () => {
  for (const isolateIO of [false, true]) {
    test(isolateIO ? "isolateIO" : "plain", async () => {
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
            const graph = new Bun.ModuleGraph({ isolateIO: ${isolateIO}, onError() {} });
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
  }
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
        const graph = new Bun.ModuleGraph({ isolateIO: i % 2 === 0, globals: { TAG: "cc" + i, control } });
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
