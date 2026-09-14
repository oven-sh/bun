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
    return remaining();
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

  test("dispose() and a collection in the same tick: close handlers are still told, then the graph goes", async () => {
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
    // (The Worker object itself is unreferenced once terminated, so its listener may go with it.)
    expect(state.heard.filter(what => what !== "worker close").sort()).toEqual(["client close", "server socket close"]);
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
