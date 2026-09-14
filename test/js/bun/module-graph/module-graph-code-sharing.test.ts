import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// Instances of a module that share compiled code share its ModuleProgramExecutable and the FunctionExecutable of every
// function declared in it, so sharing is observable as the number of live executables `heapStats()` of "bun:jsc"
// reports: an instance that shares adds [0, 0] ([module executables, function executables]), an instance that
// compiles its own adds one module executable per module and one function executable per function in them.
const prelude = `
  import { heapStats, numberOfDFGCompiles } from "bun:jsc";
  import { readFileSync, writeFileSync } from "node:fs";
  const { ModuleGraph } = Bun.unsafe;

  function executables() {
    Bun.gc(true);
    const { ModuleProgramExecutable = 0, FunctionExecutable = 0 } = heapStats().objectTypeCounts;
    return [ModuleProgramExecutable, FunctionExecutable];
  }
  // What \`create()\` returns stays referenced, so the difference is exactly what it had to compile.
  const kept = [];
  async function added(create) {
    const before = executables();
    kept.push(await create());
    const after = executables();
    return [after[0] - before[0], after[1] - before[1]];
  }
  // Calls \`fn\` 100k times and, unless the JIT is off (then this is 1000000), until the DFG has compiled it.
  function warmUp(fn, argument) {
    for (let i = 0; i < 100_000; i++) fn(argument);
    while (numberOfDFGCompiles(fn) === 0) fn(argument);
  }
`;

// Every fixture module exists twice. main.mjs runs `scenario` on the "warm-up" copies first, so that every harness
// function, closure and lazily created builtin already exists when it runs again on the "measured" copies (other
// module keys, so nothing is shared with the first run) and the counts contain the fixture modules' executables only.
function fixture(name: string, modules: Record<string, string>, scenario: string) {
  const files: Record<string, string> = {
    "main.mjs": `
      ${prelude}
      ${scenario}
      await scenario(import.meta.dir + "/warm-up");
      console.log(JSON.stringify(await scenario(import.meta.dir + "/measured")));
    `,
  };
  for (const [file, source] of Object.entries(modules)) {
    files["warm-up/" + file] = source;
    files["measured/" + file] = source;
  }
  return tempDir(name, files);
}

async function runMain(dir: string, env: Record<string, string> = {}) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "main.mjs"],
    env: { ...bunEnv, ...env },
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  try {
    return { result: JSON.parse(stdout), exitCode };
  } catch {
    return { result: { stdout, stderr }, exitCode };
  }
}

describe.concurrent("Bun.unsafe.ModuleGraph compiled-code sharing", () => {
  test("a graph without globals shares with the host, whichever instance compiled first", async () => {
    using dir = fixture(
      "module-graph-code-sharing-host",
      {
        "host-first.mjs": `export function run(n) { return n + 1; }`,
        "graph-first.mjs": `export function run(n) { return n + 2; }`,
      },
      `
        async function scenario(dir) {
          const results = [];
          async function viaHost(file) {
            const ns = await import(file);
            results.push(ns.run(1));
            return ns;
          }
          async function viaGraph(file) {
            const ns = await new ModuleGraph().import(file);
            results.push(ns.run(1));
            return ns;
          }
          return {
            host: await added(() => viaHost(dir + "/host-first.mjs")),
            graphAfterHost: await added(() => viaGraph(dir + "/host-first.mjs")),
            graph: await added(() => viaGraph(dir + "/graph-first.mjs")),
            hostAfterGraph: await added(() => viaHost(dir + "/graph-first.mjs")),
            distinctFunctions: new Set(kept.slice(-4).map(ns => ns.run)).size,
            results,
          };
        }
      `,
    );

    const { result, exitCode } = await runMain(String(dir));
    expect(result).toEqual({
      host: [1, 1],
      graphAfterHost: [0, 0],
      graph: [1, 1],
      hostAfterGraph: [0, 0],
      distinctFunctions: 4,
      results: [2, 2, 3, 3],
    });
    expect(exitCode).toBe(0);
  });

  test("graphs without globals share with each other when the host never imports the module", async () => {
    using dir = fixture(
      "module-graph-code-sharing-no-host",
      {
        "only-graphs.mjs": `
          let calls = 0;
          export function run() { return ++calls; }
        `,
      },
      `
        async function scenario(dir) {
          async function create() {
            const ns = await new ModuleGraph().import(dir + "/only-graphs.mjs");
            ns.run();
            return ns;
          }
          const counts = [await added(create), await added(create), await added(create)];
          const [first, second, third] = kept.slice(-3);
          return { counts, results: [first.run(), second.run(), third.run(), third.run(), first.run()] };
        }
      `,
    );

    const { result, exitCode } = await runMain(String(dir));
    expect(result).toEqual({
      counts: [
        [1, 1],
        [0, 0],
        [0, 0],
      ],
      results: [2, 2, 2, 3, 3],
    });
    expect(exitCode).toBe(0);
  });

  test("`globals: {}` and globals with only symbol or non-enumerable keys share with the host", async () => {
    using dir = fixture(
      "module-graph-code-sharing-empty-globals",
      { "empty-globals.mjs": `export function run() { return typeof hidden; }` },
      `
        async function scenario(dir) {
          const file = dir + "/empty-globals.mjs";
          const results = [];
          async function create(globals) {
            const ns = await new ModuleGraph({ globals }).import(file);
            results.push(ns.run());
            return ns;
          }
          async function host() {
            const ns = await import(file);
            results.push(ns.run());
            return ns;
          }
          return {
            host: await added(host),
            empty: await added(() => create({})),
            symbolOnly: await added(() => create({ [Symbol("hidden")]: 1 })),
            nonEnumerable: await added(() => create(Object.defineProperty({}, "hidden", { value: 1, enumerable: false }))),
            named: await added(() => create({ hidden: 1 })),
            results,
          };
        }
      `,
    );

    const { result, exitCode } = await runMain(String(dir));
    expect(result).toEqual({
      host: [1, 1],
      empty: [0, 0],
      symbolOnly: [0, 0],
      nonEnumerable: [0, 0],
      named: [1, 1],
      results: ["undefined", "undefined", "undefined", "undefined", "number"],
    });
    expect(exitCode).toBe(0);
  });

  test("the same names in a different insertion order share", async () => {
    using dir = fixture(
      "module-graph-code-sharing-order",
      { "ordered.mjs": `export function run() { return [alpha, beta, gamma]; }` },
      `
        async function scenario(dir) {
          const results = [];
          async function create(globals) {
            const ns = await new ModuleGraph({ globals }).import(dir + "/ordered.mjs");
            results.push(ns.run());
            return ns;
          }
          return {
            first: await added(() => create({ alpha: 1, beta: 2, gamma: 3 })),
            reversed: await added(() => create({ gamma: 30, beta: 20, alpha: 10 })),
            rotated: await added(() => create({ beta: 200, gamma: 300, alpha: 100 })),
            results,
          };
        }
      `,
    );

    const { result, exitCode } = await runMain(String(dir));
    expect(result).toEqual({
      first: [1, 1],
      reversed: [0, 0],
      rotated: [0, 0],
      results: [
        [1, 2, 3],
        [10, 20, 30],
        [100, 200, 300],
      ],
    });
    expect(exitCode).toBe(0);
  });

  test("the same names with different values and value types share", async () => {
    using dir = fixture(
      "module-graph-code-sharing-values",
      { "typed.mjs": `export function run() { return typeof tenant + ":" + String(tenant); }` },
      `
        const values = ["a", "b", 1, 1.5, 10n, true, null, undefined, { toString: () => "object" }, () => {}, Symbol.iterator];
        async function scenario(dir) {
          const results = [];
          async function create(tenant) {
            const ns = await new ModuleGraph({ globals: { tenant } }).import(dir + "/typed.mjs");
            results.push(ns.run());
            return ns;
          }
          async function createRest() {
            const rest = [];
            for (const tenant of values.slice(1)) rest.push(await create(tenant));
            return rest;
          }
          return { first: await added(() => create(values[0])), rest: await added(createRest), results };
        }
      `,
    );

    const { result, exitCode } = await runMain(String(dir));
    expect(result).toEqual({
      first: [1, 1],
      rest: [0, 0],
      results: [
        "string:a",
        "string:b",
        "number:1",
        "number:1.5",
        "bigint:10",
        "boolean:true",
        "object:null",
        "undefined:undefined",
        "object:object",
        "function:() => {}",
        "symbol:Symbol(Symbol.iterator)",
      ],
    });
    expect(exitCode).toBe(0);
  });

  test("subset, superset and disjoint name sets share within their own set only", async () => {
    using dir = fixture(
      "module-graph-code-sharing-name-sets",
      {
        "name-sets.mjs": `
          export function run() {
            return [typeof one, typeof two, typeof three, typeof other].map(type => type === "number" ? 1 : 0).join("");
          }
        `,
      },
      `
        const sets = [undefined, { one: 1 }, { one: 1, two: 2 }, { one: 1, two: 2, three: 3 }, { other: 4 }];
        async function scenario(dir) {
          const results = [];
          async function create(globals) {
            const ns = await new ModuleGraph({ globals }).import(dir + "/name-sets.mjs");
            results.push(ns.run());
            return ns;
          }
          const firstOfItsSet = [], secondOfItsSet = [];
          for (const globals of sets) firstOfItsSet.push(await added(() => create(globals)));
          for (const globals of sets) secondOfItsSet.push(await added(() => create(globals && { ...globals })));
          return { firstOfItsSet, secondOfItsSet, results };
        }
      `,
    );

    const { result, exitCode } = await runMain(String(dir));
    expect(result).toEqual({
      // `run` and the arrow function in it
      firstOfItsSet: [
        [1, 2],
        [1, 2],
        [1, 2],
        [1, 2],
        [1, 2],
      ],
      secondOfItsSet: [
        [0, 0],
        [0, 0],
        [0, 0],
        [0, 0],
        [0, 0],
      ],
      results: ["0000", "1000", "1100", "1110", "0001", "0000", "1000", "1100", "1110", "0001"],
    });
    expect(exitCode).toBe(0);
  });

  test("every kind of function declared in the module is shared", async () => {
    using dir = fixture(
      "module-graph-code-sharing-kinds",
      {
        "kinds.mjs": `
          let state = 0;
          export function declaration() { return ++state; }
          export const arrow = () => ++state;
          export async function asyncFunction() { return ++state; }
          export function* generator() { yield ++state; }
          export async function* asyncGenerator() { yield ++state; }
          export function outer() {
            function inner() { return () => ++state; }
            return inner;
          }
          export class Counter {
            constructor() { state++; }
            method() { return ++state; }
            static staticMethod() { return ++state; }
            get accessor() { return ++state; }
          }
          export const object = { method() { return ++state; } };
          export default function () { return state; }
        `,
      },
      `
        async function scenario(dir) {
          const states = [];
          async function create(globals) {
            const ns = await new ModuleGraph({ globals }).import(dir + "/kinds.mjs");
            ns.declaration();
            ns.arrow();
            await ns.asyncFunction();
            for (const _ of ns.generator());
            for await (const _ of ns.asyncGenerator());
            const inner = ns.outer(), innermost = inner();
            innermost();
            const counter = new ns.Counter();
            counter.method();
            ns.Counter.staticMethod();
            counter.accessor;
            ns.object.method();
            states.push(ns.default());
            // The closures keep the nested functions' executables alive whatever happens to \`outer\`'s code.
            return [ns, inner, innermost];
          }
          return {
            first: await added(() => create({ tenant: 1 })),
            sameNames: await added(() => create({ tenant: 2 })),
            otherNames: await added(() => create({ other: 3 })),
            states,
          };
        }
      `,
    );

    const { result, exitCode } = await runMain(String(dir));
    expect(result).toEqual({
      // The 14 functions written in kinds.mjs, plus the separate body function of the generator and of the async
      // generator.
      first: [1, 16],
      sameNames: [0, 0],
      otherNames: [1, 16],
      states: [11, 11, 11],
    });
    expect(exitCode).toBe(0);
  });

  test("an importer and its dependency are both shared, and each instance is linked to its own dependency", async () => {
    using dir = fixture(
      "module-graph-code-sharing-imports",
      {
        "dependency.mjs": `
          export let count = 0;
          export const registry = [];
          export function increment() { return ++count; }
        `,
        "importer.mjs": `
          import { count, increment, registry } from "./dependency.mjs";
          import * as dependency from "./dependency.mjs";
          export function run(label) {
            registry.push(label);
            return [increment(), count, dependency.count, registry.join()];
          }
          export { increment, registry };
        `,
      },
      `
        async function scenario(dir) {
          const results = [], ownDependency = [];
          async function viaHost() {
            const ns = await import(dir + "/importer.mjs");
            results.push(ns.run("host"), ns.run("host"));
            return ns;
          }
          async function viaGraph(label) {
            const graph = new ModuleGraph();
            const ns = await graph.import(dir + "/importer.mjs");
            results.push(ns.run(label));
            ownDependency.push((await graph.import(dir + "/dependency.mjs")).increment === ns.increment);
            return ns;
          }
          const counts = [await added(viaHost), await added(() => viaGraph("first")), await added(() => viaGraph("second"))];
          const [host, first, second] = kept.slice(-3);
          results.push(second.run("second"), host.run("host"), first.run("first"));
          return { counts, ownDependency, distinctRegistries: new Set([host.registry, first.registry, second.registry]).size, results };
        }
      `,
    );

    const { result, exitCode } = await runMain(String(dir));
    expect(result).toEqual({
      // Two modules with one function each.
      counts: [
        [2, 2],
        [0, 0],
        [0, 0],
      ],
      ownDependency: [true, true],
      distinctRegistries: 3,
      results: [
        [1, 1, 1, "host"],
        [2, 2, 2, "host,host"],
        [1, 1, 1, "first"],
        [1, 1, 1, "second"],
        [2, 2, 2, "second,second"],
        [3, 3, 3, "host,host,host"],
        [2, 2, 2, "first,first"],
      ],
    });
    expect(exitCode).toBe(0);
  });

  test("modules in an import cycle are shared", async () => {
    using dir = fixture(
      "module-graph-code-sharing-cycle",
      {
        "cycle-even.mjs": `
          import { isOdd } from "./cycle-odd.mjs";
          export let evenCalls = 0;
          export function isEven(n) { evenCalls++; return n === 0 ? true : isOdd(n - 1); }
        `,
        "cycle-odd.mjs": `
          import { isEven, evenCalls } from "./cycle-even.mjs";
          export function isOdd(n) { return n === 0 ? false : isEven(n - 1); }
          export function evenCallsSeenFromOdd() { return evenCalls; }
        `,
      },
      `
        async function scenario(dir) {
          const even = dir + "/cycle-even.mjs", odd = dir + "/cycle-odd.mjs";
          const results = [];
          async function create(entry, other, n) {
            const graph = new ModuleGraph();
            const ns = { ...await graph.import(entry), ...await graph.import(other) };
            results.push([ns.isEven(n), ns.isOdd(n), ns.evenCallsSeenFromOdd()]);
            return ns;
          }
          return {
            enteredAtEven: await added(() => create(even, odd, 10)),
            enteredAtOdd: await added(() => create(odd, even, 4)),
            results,
          };
        }
      `,
    );

    const { result, exitCode } = await runMain(String(dir));
    expect(result).toEqual({
      enteredAtEven: [2, 3],
      enteredAtOdd: [0, 0],
      results: [
        [true, false, 11],
        [true, false, 5],
      ],
    });
    expect(exitCode).toBe(0);
  });

  test("an importer whose dependency's source changed is not shared and runs the new dependency", async () => {
    using dir = fixture(
      "module-graph-code-sharing-rewrite",
      {
        "rewritten-dependency.mjs": `export function value() { return "original"; }\n`,
        "stable-importer.mjs": `
          import { value } from "./rewritten-dependency.mjs";
          export function read() { return value(); }
          export { value };
        `,
      },
      `
        async function scenario(dir) {
          const dependency = dir + "/rewritten-dependency.mjs";
          const original = readFileSync(dependency, "utf8");
          const results = [];
          async function create() {
            const ns = await new ModuleGraph().import(dir + "/stable-importer.mjs");
            results.push(ns.read(), ns.value());
            return ns;
          }
          const first = await added(create);
          const sameSource = await added(create);
          writeFileSync(dependency, original.replace("original", "rewritten"));
          const afterRewrite = await added(create);
          const sameRewrittenSource = await added(create);
          writeFileSync(dependency, original);
          kept.push(await create());
          for (const ns of kept.slice(-5)) results.push(ns.read());
          return { first, sameSource, afterRewrite, sameRewrittenSource, results };
        }
      `,
    );

    const { result, exitCode } = await runMain(String(dir));
    expect(result).toEqual({
      first: [2, 2],
      sameSource: [0, 0],
      afterRewrite: [2, 2],
      sameRewrittenSource: [0, 0],
      results: [
        ...["original", "original", "original", "original"],
        ...["rewritten", "rewritten", "rewritten", "rewritten"],
        ...["original", "original"],
        ...["original", "original", "rewritten", "rewritten", "original"],
      ],
    });
    expect(exitCode).toBe(0);
  });

  test("a module whose own source changed is not shared, but its unchanged dependency is", async () => {
    using dir = fixture(
      "module-graph-code-sharing-rewrite-importer",
      {
        "stable-dependency.mjs": `
          let calls = 0;
          export function count() { return ++calls; }
        `,
        "rewritten-importer.mjs": `
          import { count } from "./stable-dependency.mjs";
          export function read() { return "original " + count(); }
        `,
      },
      `
        async function scenario(dir) {
          const file = dir + "/rewritten-importer.mjs";
          const results = [];
          async function create() {
            const ns = await new ModuleGraph().import(file);
            results.push(ns.read());
            return ns;
          }
          const first = await added(create);
          writeFileSync(file, readFileSync(file, "utf8").replace("original", "rewritten"));
          const afterRewrite = await added(create);
          const [original, rewritten] = kept.slice(-2);
          results.push(rewritten.read(), original.read());
          return { first, afterRewrite, results };
        }
      `,
    );

    const { result, exitCode } = await runMain(String(dir));
    expect(result).toEqual({
      first: [2, 2],
      // Only the importer and its one function.
      afterRewrite: [1, 1],
      results: ["original 1", "rewritten 1", "rewritten 2", "original 2"],
    });
    expect(exitCode).toBe(0);
  });

  test("different importers of the same dependency share the dependency only", async () => {
    using dir = fixture(
      "module-graph-code-sharing-two-importers",
      {
        "common-leaf.mjs": `
          let calls = 0;
          export function leaf() { return ++calls; }
        `,
        "importer-one.mjs": `
          import { leaf } from "./common-leaf.mjs";
          export function run() { return "one " + leaf(); }
        `,
        "importer-two.mjs": `
          import { leaf } from "./common-leaf.mjs";
          export function run() { return "two " + leaf(); }
        `,
      },
      `
        async function scenario(dir) {
          const results = [];
          async function create(file) {
            const ns = await new ModuleGraph().import(dir + file);
            results.push(ns.run());
            return ns;
          }
          const one = await added(() => create("/importer-one.mjs"));
          const two = await added(() => create("/importer-two.mjs"));
          results.push(kept.at(-2).run());
          return { one, two, results };
        }
      `,
    );

    const { result, exitCode } = await runMain(String(dir));
    expect(result).toEqual({
      one: [2, 2],
      two: [1, 1],
      results: ["one 1", "two 1", "one 2"],
    });
    expect(exitCode).toBe(0);
  });

  test("sharing is keyed by module key, not by content", async () => {
    using dir = fixture(
      "module-graph-code-sharing-key",
      {
        "content-one.mjs": `export function same() { return import.meta.file; }`,
        "content-two.mjs": `export function same() { return import.meta.file; }`,
      },
      `
        async function scenario(dir) {
          const results = [];
          async function create(specifier) {
            const ns = await new ModuleGraph().import(specifier);
            results.push(ns.same());
            return ns;
          }
          return {
            first: await added(() => create(dir + "/content-one.mjs")),
            otherPath: await added(() => create(dir + "/content-two.mjs")),
            otherQuery: await added(() => create(dir + "/content-one.mjs?query")),
            fileUrl: await added(() => create(Bun.pathToFileURL(dir + "/content-one.mjs").href)),
            results,
          };
        }
      `,
    );

    const { result, exitCode } = await runMain(String(dir));
    expect(result).toEqual({
      first: [1, 1],
      otherPath: [1, 1],
      otherQuery: [1, 1],
      fileUrl: [0, 0],
      results: ["content-one.mjs", "content-two.mjs", "content-one.mjs", "content-one.mjs"],
    });
    expect(exitCode).toBe(0);
  });

  test("import() and import.meta inside shared functions belong to the calling instance's graph", async () => {
    using dir = fixture(
      "module-graph-code-sharing-affinity",
      {
        "lazy-target.mjs": `
          export const token = {};
          export function getToken() { return token; }
        `,
        "affinity.mjs": `
          export const load = () => import("./lazy-target.mjs");
          export function meta() { return import.meta; }
          export function required() { return import.meta.require("./lazy-target.mjs"); }
        `,
      },
      `
        async function scenario(dir) {
          const file = dir + "/affinity.mjs", lazy = dir + "/lazy-target.mjs";
          async function viaHost() {
            const ns = await import(file);
            const loaded = await ns.load();
            return { ns, loaded, token: loaded.getToken(), meta: ns.meta(), required: ns.required(), own: await import(lazy) };
          }
          async function viaGraph() {
            const graph = new ModuleGraph();
            const ns = await graph.import(file);
            const loaded = await ns.load();
            return { ns, loaded, token: loaded.getToken(), meta: ns.meta(), required: ns.required(), own: await graph.import(lazy) };
          }
          const counts = [await added(viaHost), await added(viaGraph), await added(viaGraph)];
          const instances = kept.slice(-3);
          return {
            counts,
            loadedOwn: instances.map(instance => instance.loaded === instance.own),
            requiredOwn: instances.map(instance => instance.required.token === instance.own.token),
            distinctTokens: new Set(instances.map(instance => instance.token)).size,
            distinctMetas: new Set(instances.map(instance => instance.meta)).size,
          };
        }
      `,
    );

    const { result, exitCode } = await runMain(String(dir));
    expect(result).toEqual({
      // affinity.mjs with its three functions and lazy-target.mjs with its one
      counts: [
        [2, 4],
        [0, 0],
        [0, 0],
      ],
      loadedOwn: [true, true, true],
      requiredOwn: [true, true, true],
      distinctTokens: 3,
      distinctMetas: 3,
    });
    expect(exitCode).toBe(0);
  });

  test("errors raised by shared code go to the instance that raised them", async () => {
    using dir = fixture(
      "module-graph-code-sharing-errors",
      {
        "raises.mjs": `
          export function throwLater(label) { setTimeout(() => { throw new Error("exception " + label); }, 0); }
          export function reject(label) { Promise.reject(new Error("rejection " + label)); }
        `,
      },
      `
        let log = [];
        process.on("uncaughtException", error => log.push("process: " + error.message));
        process.on("unhandledRejection", error => log.push("process: " + error.message));

        async function scenario(dir) {
          log = [];
          async function create(label) {
            const onError = error => log.push(label + ": " + error.message);
            const ns = label === "host" ? await import(dir + "/raises.mjs") : await new ModuleGraph({ onError }).import(dir + "/raises.mjs");
            ns.throwLater(label);
            ns.reject(label);
            return ns;
          }
          const counts = [await added(() => create("host")), await added(() => create("first")), await added(() => create("second"))];
          while (log.length < 6) await new Promise(resolve => setImmediate(resolve));
          return { counts, log: log.sort() };
        }
      `,
    );

    const { result, exitCode } = await runMain(String(dir));
    expect(result).toEqual({
      // `throwLater`, the timer callback in it, and `reject`
      counts: [
        [1, 3],
        [0, 0],
        [0, 0],
      ],
      log: [
        "first: exception first",
        "first: rejection first",
        "process: exception host",
        "process: rejection host",
        "second: exception second",
        "second: rejection second",
      ],
    });
    expect(exitCode).toBe(0);
  });

  test("an instance shares the code of an instance that is suspended in top-level await", async () => {
    using dir = fixture(
      "module-graph-code-sharing-tla",
      {
        "suspended.mjs": `
          export function early() { return "early " + tenant; }
          started(early);
          export const released = await gate;
          export function late() { return released + " " + tenant; }
        `,
      },
      `
        async function scenario(dir) {
          async function start(tenant) {
            const gate = Promise.withResolvers(), started = Promise.withResolvers();
            const imported = new ModuleGraph({ globals: { tenant, gate: gate.promise, started: started.resolve } }).import(dir + "/suspended.mjs");
            const early = await started.promise;
            return { gate, imported, early, earlyResult: early() };
          }
          const counts = [await added(() => start("first")), await added(() => start("second"))];
          const [first, second] = kept.slice(-2);
          second.gate.resolve("released-second");
          const secondLate = (await second.imported).late();
          first.gate.resolve("released-first");
          return { counts, results: [first.earlyResult, second.earlyResult, (await first.imported).late(), secondLate] };
        }
      `,
    );

    const { result, exitCode } = await runMain(String(dir));
    expect(result).toEqual({
      counts: [
        [1, 2],
        [0, 0],
      ],
      results: ["early first", "early second", "released-first first", "released-second second"],
    });
    expect(exitCode).toBe(0);
  });

  test("an instance shares the code of an instance whose evaluation threw", async () => {
    using dir = fixture(
      "module-graph-code-sharing-threw",
      {
        "throws-for-some.mjs": `
          export function read() { return tenant; }
          collect(read);
          read();
          if (shouldThrow) throw new Error("threw in " + tenant);
        `,
      },
      `
        async function scenario(dir) {
          const outcomes = [];
          async function create(tenant, shouldThrow) {
            let read;
            const graph = new ModuleGraph({ globals: { tenant, shouldThrow, collect(fn) { read = fn; } } });
            outcomes.push(await graph.import(dir + "/throws-for-some.mjs").then(ns => ns.read === read, error => error.message));
            return read;
          }
          const counts = [
            await added(() => create("a", true)),
            await added(() => create("b", false)),
            await added(() => create("c", true)),
            await added(() => create("d", false)),
          ];
          return { counts, outcomes, results: kept.slice(-4).map(read => read()) };
        }
      `,
    );

    const { result, exitCode } = await runMain(String(dir));
    expect(result).toEqual({
      counts: [
        [1, 1],
        [0, 0],
        [0, 0],
        [0, 0],
      ],
      outcomes: ["threw in a", true, "threw in c", true],
      results: ["a", "b", "c", "d"],
    });
    expect(exitCode).toBe(0);
  });

  test("sharing survives Bun.gc(true) while one instance is alive", async () => {
    using dir = fixture(
      "module-graph-code-sharing-gc-alive",
      {
        "survivor.mjs": `
          let calls = 0;
          export function run() { return typeof tenant + ++calls; }
        `,
      },
      `
        async function scenario(dir) {
          const results = [];
          // Only the function of the first instance of each kind is kept.
          async function create(globals) {
            const ns = await new ModuleGraph({ globals }).import(dir + "/survivor.mjs");
            results.push(ns.run());
            return ns.run;
          }
          const first = [await added(() => create()), await added(() => create({ tenant: "a" }))];
          for (let i = 0; i < 3; i++) {
            Bun.gc(true);
            await new Promise(resolve => setImmediate(resolve));
          }
          const afterGC = [await added(() => create()), await added(() => create({ tenant: "b" }))];
          for (const run of kept.slice(-4)) results.push(run());
          return { first, afterGC, results };
        }
      `,
    );

    const { result, exitCode } = await runMain(String(dir));
    expect(result).toEqual({
      first: [
        [1, 1],
        [1, 1],
      ],
      afterGC: [
        [0, 0],
        [0, 0],
      ],
      results: ["undefined1", "string1", "undefined1", "string1", "undefined2", "string2", "undefined2", "string2"],
    });
    expect(exitCode).toBe(0);
  });

  test("a disposed graph's instance still shares its code with new graphs", async () => {
    using dir = fixture(
      "module-graph-code-sharing-dispose",
      {
        "disposed.mjs": `
          let calls = 0;
          export function run() { return ++calls; }
        `,
      },
      `
        async function scenario(dir) {
          const results = [];
          async function create(tenant, dispose) {
            const graph = new ModuleGraph({ globals: { tenant } });
            const ns = await graph.import(dir + "/disposed.mjs");
            results.push(ns.run());
            if (dispose) graph.dispose();
            return ns;
          }
          const disposed = await added(() => create(1, true));
          const afterDispose = await added(() => create(2, false));
          results.push(kept.at(-2).run());
          return { disposed, afterDispose, results };
        }
      `,
    );

    const { result, exitCode } = await runMain(String(dir));
    expect(result).toEqual({ disposed: [1, 1], afterDispose: [0, 0], results: [1, 1, 2] });
    expect(exitCode).toBe(0);
  });

  test("20 instances calling the same shared functions interleaved keep their own state", async () => {
    using dir = fixture(
      "module-graph-code-sharing-interleaved",
      {
        "interleaved-dependency.mjs": `
          export let total = 0;
          export function add(n) { total += n; }
        `,
        "interleaved.mjs": `
          import { add, total } from "./interleaved-dependency.mjs";
          let calls = 0;
          export function step() {
            add(id);
            seen.push(id);
            return [id, ++calls, total];
          }
        `,
      },
      `
        async function scenario(dir) {
          const seen = [];
          async function create(from, to) {
            const instances = [];
            for (let id = from; id < to; id++) {
              const globals = { id, seen: [] };
              seen.push(globals.seen);
              const ns = await new ModuleGraph({ globals }).import(dir + "/interleaved.mjs");
              ns.step();
              instances.push(ns);
            }
            return instances;
          }
          const first = await added(() => create(0, 1));
          const rest = await added(() => create(1, 20));
          const instances = kept.slice(-2).flat();

          let last;
          for (let round = 0; round < 500; round++) last = instances.map(instance => instance.step());
          return { first, rest, last, seen: seen.map(ids => ids.length + "x" + [...new Set(ids)].join()) };
        }
      `,
    );

    const { result, exitCode } = await runMain(String(dir));
    expect(result).toEqual({
      first: [2, 2],
      rest: [0, 0],
      last: Array.from({ length: 20 }, (_, id) => [id, 501, id * 501]),
      seen: Array.from({ length: 20 }, (_, id) => `501x${id}`),
    });
    expect(exitCode).toBe(0);
  });

  // A shared function that is already hot in one instance (100k calls, and compiled by the DFG unless the JIT is off)
  // must not have that instance's module environment, imported bindings or graph globals folded into the code another
  // instance runs.
  describe.each([
    ["with the JIT", {}],
    ["with BUN_JSC_useJIT=0", { BUN_JSC_useJIT: "0" }],
  ] as [string, Record<string, string>][])("an instance created after a shared function got hot %s", (_, env) => {
    test("reads its own imported bindings", async () => {
      using dir = fixture(
        "module-graph-code-sharing-hot-imports",
        {
          "hot-dependency.mjs": `
            export let count = 0;
            export const registry = { owner: undefined };
            export function increment() { return ++count; }
          `,
          "hot-importer.mjs": `
            import { count, increment, registry } from "./hot-dependency.mjs";
            export function read() { return count; }
            export function owner() { return registry.owner; }
            export function callIncrement() { return increment(); }
            export { increment, registry };
          `,
        },
        `
          async function scenario(dir) {
            async function createHot() {
              const a = await new ModuleGraph().import(dir + "/hot-importer.mjs");
              a.registry.owner = "a";
              a.increment();
              a.increment();
              a.callIncrement();
              warmUp(a.read);
              warmUp(a.owner);
              return a;
            }
            const hot = await added(createHot);
            const afterHot = await added(() => new ModuleGraph().import(dir + "/hot-importer.mjs"));
            const [a, b] = kept.slice(-2);
            const fresh = [b.read(), String(b.owner()), a.read(), a.owner()];
            b.registry.owner = "b";
            b.callIncrement();
            warmUp(b.read);
            warmUp(b.owner);
            warmUp(a.read);
            a.callIncrement();
            return { hot, afterHot, fresh, stillHot: [b.read(), b.owner(), a.read(), a.owner()] };
          }
        `,
      );

      const { result, exitCode } = await runMain(String(dir), env);
      expect(result).toEqual({
        hot: [2, 4],
        afterHot: [0, 0],
        fresh: [0, "undefined", 3, "a"],
        stillHot: [1, "b", 4, "a"],
      });
      expect(exitCode).toBe(0);
    });

    test("reads and writes its own module-level `let` and `const`", async () => {
      using dir = fixture(
        "module-graph-code-sharing-hot-let",
        {
          "hot-state.mjs": `
            let calls = 0;
            const table = { label: "unset" };
            export let live = "initial";
            export function next() { return ++calls; }
            export function peek() { return calls; }
            export function getTable() { return table; }
            export function setLive(value) { live = value; }
          `,
        },
        `
          async function scenario(dir) {
            async function createHot() {
              const a = await new ModuleGraph().import(dir + "/hot-state.mjs");
              a.getTable().label = "a";
              warmUp(a.next);
              warmUp(a.peek);
              warmUp(a.getTable);
              warmUp(a.setLive, "a");
              return a;
            }
            const hot = await added(createHot);
            const afterHot = await added(() => new ModuleGraph().import(dir + "/hot-state.mjs"));
            const [a, b] = kept.slice(-2);
            const aCalls = a.peek();
            const fresh = [b.peek(), b.next(), b.getTable().label, b.live, a.peek() - aCalls, a.live];
            b.getTable().label = "b";
            b.setLive("b");
            warmUp(b.peek);
            warmUp(b.getTable);
            warmUp(a.peek);
            return {
              hot,
              afterHot,
              aCallsAtLeast100k: aCalls >= 100_000,
              fresh,
              stillHot: [b.peek(), b.getTable().label, b.live, a.peek() - aCalls, a.getTable().label, a.live],
            };
          }
        `,
      );

      const { result, exitCode } = await runMain(String(dir), env);
      expect(result).toEqual({
        hot: [1, 4],
        afterHot: [0, 0],
        aCallsAtLeast100k: true,
        fresh: [0, 1, "unset", "initial", 0, "a"],
        stillHot: [1, "b", "b", 0, "a", "a"],
      });
      expect(exitCode).toBe(0);
    });

    test("reads and writes its own graph globals", async () => {
      using dir = fixture(
        "module-graph-code-sharing-hot-globals",
        {
          "hot-globals.mjs": `
            export function read() { return tenant; }
            export function kind() { return typeof tenant; }
            export function write(value) { tenant = value; }
            export function bump() { return ++counter; }
          `,
        },
        `
          async function scenario(dir) {
            const aGlobals = { tenant: "a", counter: 0 }, bGlobals = { counter: 1000.5, tenant: { name: "b" } };
            async function createHot() {
              const a = await new ModuleGraph({ globals: aGlobals }).import(dir + "/hot-globals.mjs");
              warmUp(a.read);
              warmUp(a.kind);
              warmUp(a.write, "a2");
              warmUp(a.bump);
              return a;
            }
            const hot = await added(createHot);
            const afterHot = await added(() => new ModuleGraph({ globals: bGlobals }).import(dir + "/hot-globals.mjs"));
            const [a, b] = kept.slice(-2);
            const aCounter = a.bump();
            const fresh = [b.read(), b.kind(), b.bump(), a.read(), a.kind(), a.bump() - aCounter];
            b.write(7);
            warmUp(b.read);
            warmUp(b.kind);
            warmUp(a.read);
            return {
              hot,
              afterHot,
              fresh,
              stillHot: [b.read(), b.kind(), b.bump(), a.read(), a.kind(), a.bump() - aCounter],
              optionsObjects: [aGlobals, bGlobals],
              leaked: [typeof globalThis.tenant, typeof globalThis.counter],
            };
          }
        `,
      );

      const { result, exitCode } = await runMain(String(dir), env);
      expect(result).toEqual({
        hot: [1, 4],
        afterHot: [0, 0],
        fresh: [{ name: "b" }, "object", 1001.5, "a2", "string", 1],
        stillHot: [7, "number", 1002.5, "a2", "string", 2],
        optionsObjects: [
          { tenant: "a", counter: 0 },
          { counter: 1000.5, tenant: { name: "b" } },
        ],
        leaked: ["undefined", "undefined"],
      });
      expect(exitCode).toBe(0);
    });
  });
});
