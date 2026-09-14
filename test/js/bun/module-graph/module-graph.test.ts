import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";

const { ModuleGraph } = Bun.unsafe as any;

describe("Bun.unsafe.ModuleGraph", () => {
  test("each graph has its own module instances", async () => {
    using dir = tempDir("module-graph-instances", {
      "counter.mjs": `
        export let count = 0;
        export function increment() { return ++count; }
      `,
      "entry.mjs": `
        export * from "./counter.mjs";
        export const loadCounter = () => import("./counter.mjs");
      `,
    });
    const entry = join(String(dir), "entry.mjs");

    const host = await import(entry);
    using a = new ModuleGraph();
    using b = new ModuleGraph();
    const inA = await a.import(entry);
    const inB = await b.import(entry);

    expect(inA).not.toBe(host);
    expect(inA).not.toBe(inB);
    expect(await a.import(entry)).toBe(inA);

    inA.increment();
    inA.increment();
    inB.increment();
    expect({ host: host.count, a: inA.count, b: inB.count }).toEqual({ host: 0, a: 2, b: 1 });

    // import() inside a graph's module stays in that graph.
    expect((await inA.loadCounter()).count).toBe(2);
    expect((await inB.loadCounter()).count).toBe(1);
    expect((await host.loadCounter()).count).toBe(0);
  });

  test("`globals` are free identifiers of the graph's modules only", async () => {
    using dir = tempDir("module-graph-globals", {
      "tenant.mjs": `
        export const read = () => [tenant, typeof region];
        export const write = value => { tenant = value; };
        export const global = globalThis;
      `,
    });
    const file = join(String(dir), "tenant.mjs");

    using a = new ModuleGraph({ globals: { tenant: "a", region: "us" } });
    using b = new ModuleGraph({ globals: { region: "eu", tenant: "b" } });
    const inA = await a.import(file);
    const inB = await b.import(file);

    expect(inA.read()).toEqual(["a", "string"]);
    expect(inB.read()).toEqual(["b", "string"]);
    inA.write("changed");
    expect(inA.read()).toEqual(["changed", "string"]);
    expect(inB.read()).toEqual(["b", "string"]);

    expect(inA.global).toBe(globalThis);
    expect("tenant" in globalThis).toBe(false);
    expect((await import(file)).read).toThrow(ReferenceError);
  });

  test("import.meta belongs to the graph", async () => {
    using dir = tempDir("module-graph-meta", {
      "dep.mjs": `export const meta = import.meta;`,
      "main.mjs": `
        export { meta as depMeta } from "./dep.mjs";
        export const meta = import.meta;
      `,
    });
    const main = join(String(dir), "main.mjs");

    using graph = new ModuleGraph();
    expect(graph.mainModule).toBeUndefined();
    const inGraph = await graph.import(main);
    const host = await import(main);

    expect(graph.mainModule).toBe(main);
    expect(inGraph.meta).not.toBe(host.meta);
    expect(inGraph.meta.url).toBe(host.meta.url);
    expect({
      graphMain: inGraph.meta.main,
      graphDep: inGraph.depMeta.main,
      hostMain: host.meta.main,
    }).toEqual({ graphMain: true, graphDep: false, hostMain: false });
  });

  test("top-level await state is per graph", async () => {
    using dir = tempDir("module-graph-tla", {
      "tla.mjs": `
        export const id = nextId();
        await Promise.resolve();
        export const done = true;
      `,
    });
    const file = join(String(dir), "tla.mjs");

    let ids = 0;
    const globals = { nextId: () => ++ids };
    using a = new ModuleGraph({ globals });
    using b = new ModuleGraph({ globals });
    const [inA, inB] = await Promise.all([a.import(file), b.import(file)]);
    expect([inA.id, inB.id].sort()).toEqual([1, 2]);
    expect([inA.done, inB.done]).toEqual([true, true]);
  });

  test("dispose() drops the registry and nothing else", async () => {
    using dir = tempDir("module-graph-dispose", {
      "counter.mjs": `
        export let count = 0;
        export function increment() { return ++count; }
        export const again = () => import("./counter.mjs");
      `,
    });
    const file = join(String(dir), "counter.mjs");

    const graph = new ModuleGraph();
    expect(graph[Symbol.dispose]).toBe(graph.dispose);
    const counter = await graph.import(file);
    graph.dispose();
    graph.dispose();

    expect(counter.increment()).toBe(1);
    expect(graph.import(file)).rejects.toMatchObject({ code: "ERR_INVALID_STATE" });
    expect(counter.again()).rejects.toMatchObject({ code: "ERR_INVALID_STATE" });
  });

  test("graphs with the same `globals` names share compiled code", async () => {
    using dir = tempDir("module-graph-shared-code", {
      "mod.mjs": `
        export function run(n) {
          let sum = typeof tenant === "string" ? 1 : 0;
          for (let i = 0; i < n; i++) sum += i;
          return sum;
        }
      `,
      "main.mjs": `
        import { heapStats } from "bun:jsc";
        const { ModuleGraph } = Bun.unsafe;
        const file = import.meta.dir + "/mod.mjs";

        // One ModuleProgramExecutable is the compiled code of one module. Instances that share it add none.
        const executables = () => {
          Bun.gc(true);
          return heapStats().objectTypeCounts.ModuleProgramExecutable ?? 0;
        };
        const instances = [];
        async function added(count, globals) {
          const before = executables();
          for (let i = 0; i < count; i++) {
            const instance = await new ModuleGraph({ globals: globals(i) }).import(file);
            instances.push(instance);
          }
          return executables() - before;
        }

        instances.push(await import(file));
        console.log(JSON.stringify({
          withoutGlobals: await added(10, () => undefined),
          sameNames: await added(10, i => ({ tenant: "tenant " + i, region: i })),
          sameNamesInAnotherOrder: await added(10, i => ({ region: i, tenant: "tenant " + i })),
          differentNames: await added(10, i => ({ ["tenant" + i]: i })),
          results: [...new Set(instances.map(instance => instance.run(3)))].sort(),
        }));
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "main.mjs"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      // They run the host's.
      withoutGlobals: 0,
      sameNames: 1,
      sameNamesInAnotherOrder: 0,
      differentNames: 10,
      results: [3, 4],
    });
    expect(exitCode).toBe(0);
  });

  describe("import.meta.require() of an ES module returns the graph's instance", () => {
    const files = {
      "state.mjs": `
        export let count = 0;
        export const increment = () => ++count;
      `,
      "shared.cjs": `
        globalThis.sharedEvaluations = (globalThis.sharedEvaluations ?? 0) + 1;
        exports.value = {};
      `,
      "entry.mjs": `
        import * as imported from "./state.mjs";
        import shared from "./shared.cjs";
        export const required = import.meta.require("./state.mjs");
        export const requiredIsImported = required.increment === imported.increment;
        export const sharedValues = [shared.value, import.meta.require("./shared.cjs").value];
      `,
      "main.mjs": `
        import Module, { createRequire } from "node:module";
        const require = createRequire(import.meta.url);
        const statePath = import.meta.dir + "/state.mjs";
        const entryPath = import.meta.dir + "/entry.mjs";

        const hostState = await import(statePath);
        switch (process.argv[2]) {
          case "host enumerated require.cache":
            Object.keys(require.cache);
            require.cache[statePath];
            break;
          case "host required it":
            require(statePath);
            break;
          case "host wrapped Module._extensions":
            for (const extension of [".js", ".mjs"]) {
              const original = Module._extensions[extension];
              Module._extensions[extension] = (module, filename) => original(module, filename);
            }
            break;
        }

        const host = await import(entryPath);
        const graph = await new Bun.unsafe.ModuleGraph().import(entryPath);
        graph.required.increment();
        const cached = require.cache[statePath];
        console.log(JSON.stringify({
          requiredIsImported: [host.requiredIsImported, graph.requiredIsImported],
          counts: [hostState.count, graph.required.count],
          requireCacheHoldsGraphInstance: cached?.exports?.increment === graph.required.increment,
          commonJSIsShared: graph.sharedValues.every(value => value === host.sharedValues[0]),
          sharedEvaluations: globalThis.sharedEvaluations,
        }));
      `,
    };

    test.concurrent.each([
      "host never touched it",
      "host enumerated require.cache",
      "host required it",
      "host wrapped Module._extensions",
    ])("%s", async mode => {
      using dir = tempDir("module-graph-require", files);
      await using proc = Bun.spawn({
        cmd: [bunExe(), "main.mjs", mode],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toEqual({
        requiredIsImported: [true, true],
        counts: [0, 1],
        requireCacheHoldsGraphInstance: false,
        commonJSIsShared: true,
        sharedEvaluations: 1,
      });
      expect(exitCode).toBe(0);
    });
  });

  test("onError receives the graph's uncaught exceptions and unhandled rejections", async () => {
    using dir = tempDir("module-graph-on-error", {
      "faults.mjs": `
        export const throwInTimer = message => { setTimeout(() => { throw new Error(message); }, 0); };
        export const rejectInAsyncFunction = message => { (async () => { throw new Error(message); })(); };
        export const rejectDirectly = message => { Promise.reject(new Error(message)); };
        // A tail call: this function's frame is gone by the time the promise is rejected.
        export const rejectInTailCall = message => Promise.reject(new Error(message));
        export const callInTimer = fn => { setTimeout(() => { fn(); }, 0); };
      `,
      "main.mjs": `
        const { ModuleGraph } = Bun.unsafe;
        const log = [];
        process.on("uncaughtException", error => log.push("process uncaughtException: " + error.message));
        process.on("unhandledRejection", error => log.push("process unhandledRejection: " + error.message));
        process.on("rejectionHandled", () => log.push("process rejectionHandled"));

        const file = import.meta.dir + "/faults.mjs";
        const reports = name => error => log.push(name + ".onError: " + error.message);
        const a = await new ModuleGraph({ onError: reports("a") }).import(file);
        const throwing = await new ModuleGraph({
          onError(error) {
            reports("throwing")(error);
            throw new Error("thrown by onError");
          },
        }).import(file);
        const silent = await new ModuleGraph().import(file);
        const host = await import(file);

        // Each fault is reported once the event loop gets to it; wait for that report.
        async function reported(act) {
          const before = log.length;
          act();
          while (log.length === before) await new Promise(resolve => setImmediate(resolve));
        }

        await reported(() => a.throwInTimer("timer"));
        await reported(() => a.rejectInAsyncFunction("async function"));
        await reported(() => a.rejectDirectly("direct"));
        await reported(() => a.callInTimer(() => { throw new Error("host function the graph called"); }));
        let handledLate;
        await reported(() => { handledLate = a.rejectInTailCall("tail call"); });
        handledLate.catch(() => {});
        await reported(() => throwing.throwInTimer("throwing graph"));
        await reported(() => silent.throwInTimer("graph without onError"));
        await reported(() => host.throwInTimer("host timer"));
        await reported(() => host.rejectInAsyncFunction("host async function"));
        console.log(JSON.stringify(log, null, 2));
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "main.mjs"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual([
      "a.onError: timer",
      "a.onError: async function",
      "a.onError: direct",
      "a.onError: host function the graph called",
      "a.onError: tail call",
      "throwing.onError: throwing graph",
      "process uncaughtException: thrown by onError",
      "process uncaughtException: graph without onError",
      "process uncaughtException: host timer",
      "process unhandledRejection: host async function",
    ]);
    expect(exitCode).toBe(0);
  });

  test("a graph lives as long as its code does", async () => {
    using dir = tempDir("module-graph-lifetime", {
      "fault.mjs": `
        export const throwInTimer = () => { setTimeout(() => { throw new Error("from " + tenant); }, 0); };
      `,
    });
    const file = join(String(dir), "fault.mjs");

    const errors: string[] = [];
    async function load() {
      const graph = new ModuleGraph({ globals: { tenant: "a collected graph" }, onError: e => errors.push(e.message) });
      return (await graph.import(file)).throwInTimer;
    }
    const throwInTimer = await load();
    Bun.gc(true);

    throwInTimer();
    while (errors.length === 0) await new Promise(resolve => setImmediate(resolve));
    expect(errors).toEqual(["from a collected graph"]);
  });

  test("validates its options", () => {
    expect(() => ModuleGraph()).toThrow(TypeError);
    expect(() => new ModuleGraph(1)).toThrow(expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" }));
    expect(() => new ModuleGraph({ globals: 1 })).toThrow(expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" }));
    expect(() => new ModuleGraph({ onError: 1 })).toThrow(expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" }));
    expect(() => ModuleGraph.prototype.import.call({}, "x")).toThrow(TypeError);
  });
});
