import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const { ModuleGraph } = Bun.unsafe as any;

// The host's require: the one every CommonJS module and every host ES module uses.
const hostRequire = createRequire(import.meta.url);

// What a graph's (or the host's) module code can do, handed to the test.
const probe = `
  export const metaRequire = import.meta.require;
  export const load = specifier => import(specifier);
  export const attempt = specifier => {
    try {
      return { value: import.meta.require(specifier) };
    } catch (error) {
      return { error, name: error?.name, code: error?.code, message: error?.message };
    }
  };
`;

const counter = `
  export let count = 0;
  export function increment() { return ++count; }
`;

/** Whether some `require.cache` entry's exports is the module instance that owns `fn`. */
function requireCacheHolds(name: string, fn: unknown) {
  return Object.values(hostRequire.cache).some((module: any) => module?.exports?.[name] === fn);
}

async function run(dir: { toString(): string }, ...args: string[]) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...args],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

describe("import.meta.require() in a Bun.unsafe.ModuleGraph", () => {
  describe("of an ES module", () => {
    test("is the graph's own instance, the one its `import` sees", async () => {
      using dir = tempDir("module-graph-require-own", {
        "counter.mjs": counter,
        "entry.mjs": `
          import * as imported from "./counter.mjs";
          export { imported };
          ${probe}
        `,
      });
      const entry = join(String(dir), "entry.mjs");

      const host = await import(entry);
      using a = new ModuleGraph();
      using b = new ModuleGraph();
      const inA = await a.import(entry);
      const inB = await b.import(entry);

      const required = inA.metaRequire("./counter.mjs");
      required.increment();
      required.increment();
      inB.metaRequire("./counter.mjs").increment();

      expect({
        isTheImportedNamespace: required === inA.imported,
        sameFunctions: required.increment === inA.imported.increment,
        repeated: inA.metaRequire("./counter.mjs") === required,
        dynamicImport: (await inA.load("./counter.mjs")) === required,
        isHosts: required === host.metaRequire("./counter.mjs"),
        isOtherGraphs: required === inB.metaRequire("./counter.mjs"),
        hostRequiredIsHostImported: host.metaRequire("./counter.mjs") === host.imported,
        counts: [host.imported.count, inA.imported.count, inB.imported.count],
      }).toEqual({
        isTheImportedNamespace: true,
        sameFunctions: true,
        repeated: true,
        dynamicImport: true,
        isHosts: false,
        isOtherGraphs: false,
        hostRequiredIsHostImported: true,
        counts: [0, 2, 1],
      });
    });

    // What the host did with the module before (and again after) the graph required it.
    const hostTouches: Record<string, (path: string) => Promise<unknown>> = {
      "the host never touched it": async () => {},
      "the host imported it": async path => await import(path),
      "the host required it": async path => hostRequire(path),
      "the host imported, then required it": async path => [await import(path), hostRequire(path)],
      "the host imported it and read require.cache[path]": async path => [await import(path), hostRequire.cache[path]],
      "the host imported it and enumerated require.cache": async path => [
        await import(path),
        Object.keys(hostRequire.cache),
      ],
      "the host imported it and asked `path in require.cache`": async path => [
        await import(path),
        path in hostRequire.cache,
      ],
    };

    test.each(Object.keys(hostTouches))("never enters require.cache: %s", async touch => {
      using dir = tempDir("module-graph-require-cache", {
        "imported.mjs": counter,
        "lazy.mjs": counter,
        "entry.mjs": `
          import * as imported from "./imported.mjs";
          export { imported };
          ${probe}
        `,
      });
      const entry = join(String(dir), "entry.mjs");
      const paths = [join(String(dir), "imported.mjs"), join(String(dir), "lazy.mjs")];

      using graph = new ModuleGraph();
      const inGraph = await graph.import(entry);
      for (const path of paths) await hostTouches[touch](path);

      // "lazy.mjs" is loaded into the graph by this require().
      const required = paths.map(path => inGraph.metaRequire(path));
      for (const instance of required) instance.increment();
      const leakedBefore = required.map(instance => requireCacheHolds("increment", instance.increment));

      for (const path of paths) await hostTouches[touch](path);
      const hostInstances = await Promise.all(paths.map(path => import(path)));

      expect({
        requiredIsImported: [required[0] === inGraph.imported, required[1] === (await inGraph.load(paths[1]))],
        leakedBefore,
        leakedAfter: required.map(instance => requireCacheHolds("increment", instance.increment)),
        hostRequiresItsOwn: paths.map((path, i) => hostRequire(path) === hostInstances[i]),
        requireCacheHoldsHosts: paths.map((path, i) => hostRequire.cache[path].exports === hostInstances[i]),
        counts: [hostInstances.map(instance => instance.count), required.map(instance => instance.count)],
      }).toEqual({
        requiredIsImported: [true, true],
        leakedBefore: [false, false],
        leakedAfter: [false, false],
        hostRequiresItsOwn: [true, true],
        requireCacheHoldsHosts: [true, true],
        counts: [
          [0, 0],
          [1, 1],
        ],
      });
    });

    test("loads a module nobody has loaded, without a require.cache entry", async () => {
      using dir = tempDir("module-graph-require-first-load", {
        "fresh.mjs": counter,
        "static.mjs": `export * as viaStatic from "./fresh.mjs";`,
        "entry.mjs": probe,
      });
      const entry = join(String(dir), "entry.mjs");
      const fresh = join(String(dir), "fresh.mjs");

      using graph = new ModuleGraph();
      const inGraph = await graph.import(entry);
      const required = inGraph.metaRequire("./fresh.mjs");

      expect({
        inRequireCache: [fresh in hostRequire.cache, Object.keys(hostRequire.cache).includes(fresh)],
        entry: hostRequire.cache[fresh],
        dynamicImport: (await inGraph.load("./fresh.mjs")) === required,
        staticImport: (await inGraph.load("./static.mjs")).viaStatic === required,
        graphImport: (await graph.import(fresh)) === required,
      }).toEqual({
        inRequireCache: [false, false],
        entry: undefined,
        dynamicImport: true,
        staticImport: true,
        graphImport: true,
      });
    });

    test("the required module's imports are the graph's too", async () => {
      using dir = tempDir("module-graph-require-transitive", {
        "leaf.mjs": counter,
        "middle.mjs": `
          export * as leaf from "./leaf.mjs";
          export const leafRequired = import.meta.require("./leaf.mjs");
          export const loadLeaf = () => import("./leaf.mjs");
        `,
        "entry.mjs": probe,
      });
      const entry = join(String(dir), "entry.mjs");

      const host = await import(entry);
      using graph = new ModuleGraph();
      const inGraph = await graph.import(entry);
      const middle = inGraph.metaRequire("./middle.mjs");
      const hostMiddle = host.metaRequire("./middle.mjs");
      middle.leaf.increment();

      expect({
        nestedRequire: middle.leafRequired === middle.leaf,
        nestedImport: (await middle.loadLeaf()) === middle.leaf,
        graphImport: (await inGraph.load("./leaf.mjs")) === middle.leaf,
        isHosts: middle.leaf === hostMiddle.leaf,
        counts: [hostMiddle.leaf.count, middle.leaf.count],
        leaked: [requireCacheHolds("leaf", middle.leaf), requireCacheHolds("increment", middle.leaf.increment)],
      }).toEqual({
        nestedRequire: true,
        nestedImport: true,
        graphImport: true,
        isHosts: false,
        counts: [0, 1],
        leaked: [false, false],
      });
    });

    test("a module loaded by require() sees the graph's `globals`", async () => {
      using dir = tempDir("module-graph-require-globals", {
        "tenant.mjs": `export const read = () => typeof tenant === "undefined" ? undefined : tenant;`,
        "entry.mjs": probe,
      });
      const entry = join(String(dir), "entry.mjs");

      const host = await import(entry);
      using a = new ModuleGraph({ globals: { tenant: "a" } });
      using b = new ModuleGraph({ globals: { tenant: "b" } });
      using plain = new ModuleGraph();
      const instances = [host, await a.import(entry), await b.import(entry), await plain.import(entry)];

      expect(instances.map(instance => instance.metaRequire("./tenant.mjs").read())).toEqual([
        undefined,
        "a",
        "b",
        undefined,
      ]);
    });

    test("the required module's import.meta is the graph's", async () => {
      using dir = tempDir("module-graph-require-meta", {
        "meta.mjs": `export const meta = import.meta;`,
        "entry.mjs": `
          export const meta = import.meta;
          ${probe}
        `,
      });
      const entry = join(String(dir), "entry.mjs");

      const host = await import(entry);
      using graph = new ModuleGraph();
      const inGraph = await graph.import(entry);
      const required = inGraph.metaRequire("./meta.mjs");
      const hostRequired = host.metaRequire("./meta.mjs");

      expect({
        sameAsGraphImport: required.meta === (await inGraph.load("./meta.mjs")).meta,
        isHosts: required.meta === hostRequired.meta,
        url: required.meta.url === hostRequired.meta.url,
        main: [inGraph.meta.main, required.meta.main, hostRequired.meta.main],
        requireIsCached: inGraph.meta.require === inGraph.metaRequire,
        requireIsHosts: inGraph.meta.require === host.meta.require,
        requireIsPerModule: required.meta.require === inGraph.meta.require,
      }).toEqual({
        sameAsGraphImport: true,
        isHosts: false,
        url: true,
        main: [true, false, false],
        requireIsCached: true,
        requireIsHosts: false,
        requireIsPerModule: false,
      });
    });

    test("the require function remembers its graph wherever it is called from", async () => {
      using dir = tempDir("module-graph-require-remembers", {
        "counter.mjs": counter,
        "entry.mjs": `
          export const call = (fn, specifier) => [fn(specifier)];
          ${probe}
        `,
      });
      const entry = join(String(dir), "entry.mjs");

      const host = await import(entry);
      using a = new ModuleGraph();
      using b = new ModuleGraph();
      const inA = await a.import(entry);
      const inB = await b.import(entry);
      const ofA = await inA.load("./counter.mjs");
      const ofB = await inB.load("./counter.mjs");
      const ofHost = await host.load("./counter.mjs");

      expect({
        aFromHost: inA.metaRequire("./counter.mjs") === ofA,
        aFromB: inB.call(inA.metaRequire, "./counter.mjs")[0] === ofA,
        bFromA: inA.call(inB.metaRequire, "./counter.mjs")[0] === ofB,
        hostFromA: inA.call(host.metaRequire, "./counter.mjs")[0] === ofHost,
        hostRequireFromA: inA.call(hostRequire, join(String(dir), "counter.mjs"))[0] === ofHost,
        distinct: new Set([ofA, ofB, ofHost]).size,
      }).toEqual({
        aFromHost: true,
        aFromB: true,
        bFromA: true,
        hostFromA: true,
        hostRequireFromA: true,
        distinct: 3,
      });
    });

    test("a bare `require` in the graph's ES module is import.meta.require", async () => {
      using dir = tempDir("module-graph-require-bare", {
        "counter.mjs": counter,
        "entry.mjs": `
          import * as imported from "./counter.mjs";
          export const required = require("./counter.mjs");
          export const requiredIsImported = required === imported;
          export const lazily = () => require("./later.mjs");
          export const load = specifier => import(specifier);
        `,
        "later.mjs": counter,
      });
      const entry = join(String(dir), "entry.mjs");

      const host = await import(entry);
      using graph = new ModuleGraph();
      const inGraph = await graph.import(entry);
      const later = inGraph.lazily();

      expect({
        requiredIsImported: [host.requiredIsImported, inGraph.requiredIsImported],
        isHosts: [inGraph.required === host.required, later === host.lazily()],
        laterIsGraphs: later === (await inGraph.load("./later.mjs")),
        leaked: [inGraph.required, later].map(instance => requireCacheHolds("increment", instance.increment)),
      }).toEqual({
        requiredIsImported: [true, true],
        isHosts: [false, false],
        laterIsGraphs: true,
        leaked: [false, false],
      });
    });

    test("every way to spell the specifier reaches the same instance", async () => {
      using dir = tempDir("module-graph-require-specifiers", {
        "counter.mjs": counter,
        "typed.ts": `export const typed = (value: number): number => value;`,
        "plain.js": `export const plain = () => "esm in .js";`,
        "package/package.json": JSON.stringify({ name: "package", type: "module", main: "./index.js" }),
        "package/index.js": `export const packaged = () => "package";`,
        "node_modules/bare-esm/package.json": JSON.stringify({
          name: "bare-esm",
          type: "module",
          exports: "./main.js",
        }),
        "node_modules/bare-esm/main.js": `export const bare = () => "bare";`,
        "entry.mjs": probe,
      });
      const entry = join(String(dir), "entry.mjs");
      const counterPath = join(String(dir), "counter.mjs");

      const host = await import(entry);
      using graph = new ModuleGraph();
      const inGraph = await graph.import(entry);
      const imported = await inGraph.load("./counter.mjs");

      expect({
        relative: inGraph.metaRequire("./counter.mjs") === imported,
        absolute: inGraph.metaRequire(counterPath) === imported,
        fileURL: inGraph.metaRequire(pathToFileURL(counterPath).href) === imported,
        extensionless: inGraph.metaRequire("./counter") === imported,
        typescript: inGraph.metaRequire("./typed.ts") === (await inGraph.load("./typed.ts")),
        esmInJs: inGraph.metaRequire("./plain.js") === (await inGraph.load("./plain.js")),
        directory: inGraph.metaRequire("./package") === (await inGraph.load("./package/index.js")),
        bare: inGraph.metaRequire("bare-esm") === (await inGraph.load("bare-esm")),
        isHosts: ["./counter.mjs", "./typed.ts", "./plain.js", "./package", "bare-esm"].map(
          specifier => inGraph.metaRequire(specifier) === host.metaRequire(specifier),
        ),
        leaked: [
          requireCacheHolds("typed", inGraph.metaRequire("./typed.ts").typed),
          requireCacheHolds("plain", inGraph.metaRequire("./plain.js").plain),
          requireCacheHolds("packaged", inGraph.metaRequire("./package").packaged),
          requireCacheHolds("bare", inGraph.metaRequire("bare-esm").bare),
        ],
      }).toEqual({
        relative: true,
        absolute: true,
        fileURL: true,
        extensionless: true,
        typescript: true,
        esmInJs: true,
        directory: true,
        bare: true,
        isHosts: [false, false, false, false, false],
        leaked: [false, false, false, false],
      });
    });

    test("a module that throws while evaluating: require() throws, again on retry, and leaves nothing behind", async () => {
      using dir = tempDir("module-graph-require-throws", {
        "throws.mjs": `
          export const marker = () => {};
          evaluated();
          if (shouldThrow) throw new Error("thrown by throws.mjs");
        `,
        "entry.mjs": probe,
      });
      const entry = join(String(dir), "entry.mjs");
      const throws = join(String(dir), "throws.mjs");

      let evaluations = 0;
      const evaluated = () => ++evaluations;
      using failing = new ModuleGraph({ globals: { evaluated, shouldThrow: true } });
      using working = new ModuleGraph({ globals: { evaluated, shouldThrow: false } });
      const inFailing = await failing.import(entry);
      const inWorking = await working.import(entry);

      const first = inFailing.attempt("./throws.mjs");
      const second = inFailing.attempt("./throws.mjs");
      const imported = await inFailing.load("./throws.mjs").catch((error: unknown) => error);
      const leftover = [throws in hostRequire.cache, Object.keys(hostRequire.cache).includes(throws)];
      const ok = inWorking.attempt("./throws.mjs");

      expect({
        messages: [first.message, second.message],
        sameError: [first.error === second.error, imported === first.error],
        isError: first.error instanceof Error,
        leftover,
        otherGraphLoadsIt: typeof ok.value?.marker,
        evaluations,
        leaked: requireCacheHolds("marker", ok.value?.marker),
        stillNothing: throws in hostRequire.cache,
      }).toEqual({
        messages: ["thrown by throws.mjs", "thrown by throws.mjs"],
        sameError: [true, true],
        isError: true,
        leftover: [false, false],
        otherGraphLoadsIt: "function",
        evaluations: 2,
        leaked: false,
        stillNothing: false,
      });
    });

    test("after the graph's require() threw, the host still requires its own instance", async () => {
      using dir = tempDir("module-graph-require-throws-host", {
        "sometimes.mjs": `
          export const marker = () => {};
          if (typeof shouldThrow !== "undefined") throw new Error("only in the graph");
        `,
        "entry.mjs": probe,
      });
      const entry = join(String(dir), "entry.mjs");
      const sometimes = join(String(dir), "sometimes.mjs");

      using graph = new ModuleGraph({ globals: { shouldThrow: true } });
      const inGraph = await graph.import(entry);
      const failed = inGraph.attempt("./sometimes.mjs");
      const leftover = sometimes in hostRequire.cache;
      const hostInstance = hostRequire(sometimes);
      const failedAgain = inGraph.attempt("./sometimes.mjs");

      expect({
        failed: [failed.message, failedAgain.message, failedAgain.error === failed.error],
        leftover,
        host: typeof hostInstance.marker,
        hostIsImported: hostInstance === (await import(sometimes)),
        requireCacheHoldsHosts: hostRequire.cache[sometimes].exports === hostInstance,
      }).toEqual({
        failed: ["only in the graph", "only in the graph", true],
        leftover: false,
        host: "function",
        hostIsImported: true,
        requireCacheHoldsHosts: true,
      });
    });

    test("a module that fails to parse throws what the host's require() throws", async () => {
      using dir = tempDir("module-graph-require-syntax-error", {
        "broken.mjs": `export const = ;`,
        "entry.mjs": probe,
      });
      const entry = join(String(dir), "entry.mjs");
      const broken = join(String(dir), "broken.mjs");

      using graph = new ModuleGraph();
      const inGraph = await graph.import(entry);
      const host = await import(entry);
      const failed = inGraph.attempt("./broken.mjs");
      const leftover = broken in hostRequire.cache;
      const hostFailed = host.attempt("./broken.mjs");

      expect(failed.error).toBeInstanceOf(Error);
      expect({ name: failed.name, message: failed.message, leftover }).toEqual({
        name: hostFailed.name,
        message: hostFailed.message,
        leftover: false,
      });
    });

    test('`__esModule` and the "module.exports" export name work as they do for the host', async () => {
      using dir = tempDir("module-graph-require-interop", {
        "unmarked.mjs": `
          export default "default export";
          export const named = "named";
        `,
        "marked.mjs": `
          export const __esModule = true;
          export default "default export";
        `,
        "marked-false.mjs": `
          export const __esModule = false;
          export const named = "named";
        `,
        "module-exports.mjs": `
          export let calls = 0;
          function main() { return ++calls; }
          export { main as "module.exports" };
        `,
        "entry.mjs": probe,
      });
      const entry = join(String(dir), "entry.mjs");

      const describeExports = (exports: any) => ({
        type: typeof exports,
        keys: Object.keys(exports),
        esModule: exports.__esModule,
        default: exports.default,
        tag: Object.prototype.toString.call(exports),
      });
      const host = await import(entry);
      using graph = new ModuleGraph();
      const inGraph = await graph.import(entry);
      const specifiers = ["./unmarked.mjs", "./marked.mjs", "./marked-false.mjs", "./module-exports.mjs"];
      const inGraphExports = specifiers.map(specifier => describeExports(inGraph.metaRequire(specifier)));

      expect(inGraphExports).toEqual(specifiers.map(specifier => describeExports(host.metaRequire(specifier))));
      expect(inGraphExports).toEqual([
        {
          type: "object",
          keys: ["default", "named"],
          esModule: true,
          default: "default export",
          tag: "[object Module]",
        },
        {
          type: "object",
          keys: ["__esModule", "default"],
          esModule: true,
          default: "default export",
          tag: "[object Module]",
        },
        { type: "object", keys: ["__esModule", "named"], esModule: false, default: undefined, tag: "[object Module]" },
        { type: "function", keys: [], esModule: undefined, default: undefined, tag: "[object Function]" },
      ]);

      // "module.exports" is the graph's function, not the host's.
      const main = inGraph.metaRequire("./module-exports.mjs");
      const namespace = await inGraph.load("./module-exports.mjs");
      main();
      expect({
        isTheGraphsExport: main === namespace["module.exports"],
        isHosts: main === host.metaRequire("./module-exports.mjs"),
        calls: [namespace.calls, (await host.load("./module-exports.mjs")).calls],
        leaked: Object.values(hostRequire.cache).some((module: any) => module?.exports === main),
      }).toEqual({ isTheGraphsExport: true, isHosts: false, calls: [1, 0], leaked: false });
    });

    test("a module with top-level await is a TypeError, as for the host", async () => {
      using dir = tempDir("module-graph-require-tla", {
        "tla.mjs": `
          await new Promise(resolve => setImmediate(resolve));
          export const done = () => true;
        `,
        "entry.mjs": probe,
      });
      const entry = join(String(dir), "entry.mjs");
      const tla = join(String(dir), "tla.mjs");

      using graph = new ModuleGraph();
      const inGraph = await graph.import(entry);
      const failed = inGraph.attempt("./tla.mjs");
      const leftover = tla in hostRequire.cache;

      expect(failed.error).toBeInstanceOf(TypeError);
      expect({ message: failed.message, leftover }).toEqual({
        message: `require() async module "${tla}" is unsupported. use "await import()" instead.`,
        leftover: false,
      });

      // Once the graph has finished importing it, require() answers with that instance.
      const imported = await inGraph.load("./tla.mjs");
      expect({
        required: inGraph.metaRequire("./tla.mjs") === imported,
        leaked: requireCacheHolds("done", imported.done),
      }).toEqual({ required: true, leaked: false });
    });

    test("a require cycle through an import behaves like the host's", async () => {
      using dir = tempDir("module-graph-require-cycle", {
        "a.mjs": `
          export const b = import.meta.require("./b.mjs");
          export const value = "a";
        `,
        "b.mjs": `
          import * as a from "./a.mjs";
          export { a };
          export const sawValue = (() => { try { return a.value; } catch (error) { return error.name; } })();
        `,
        "entry.mjs": probe,
      });
      const entry = join(String(dir), "entry.mjs");

      const observe = async (instance: any) => {
        const a = await instance.load("./a.mjs");
        return {
          sawValue: a.b.sawValue,
          cycleCloses: a.b.a === a,
          value: a.b.a.value,
          requiredAgain: instance.metaRequire("./a.mjs") === a && instance.metaRequire("./b.mjs") === a.b,
        };
      };
      using graph = new ModuleGraph();
      const inGraph = await graph.import(entry);
      const host = await import(entry);
      const observed = await observe(inGraph);

      expect(observed).toEqual(await observe(host));
      expect(observed).toEqual({ sawValue: "ReferenceError", cycleCloses: true, value: "a", requiredAgain: true });
      expect((await inGraph.load("./a.mjs")).b).not.toBe((await host.load("./a.mjs")).b);
    });

    test("a require cycle through another require behaves like the host's", async () => {
      using dir = tempDir("module-graph-require-cycle-require", {
        "c.mjs": `
          export const d = import.meta.require("./d.mjs");
          export const value = "c";
        `,
        "d.mjs": `
          // c.mjs is still evaluating: this is its live namespace, whose bindings are in their temporal dead zone.
          const c = import.meta.require("./c.mjs");
          export const keysOfC = Reflect.ownKeys(c).filter(key => typeof key === "string");
          export const readC = () => c.value;
        `,
        "entry.mjs": probe,
      });
      const entry = join(String(dir), "entry.mjs");
      const paths = [join(String(dir), "c.mjs"), join(String(dir), "d.mjs")];

      const observe = (instance: any) => {
        const c = instance.metaRequire("./c.mjs");
        return { keys: Object.keys(c), keysOfC: c.d.keysOfC, readC: c.d.readC() };
      };
      using graph = new ModuleGraph();
      const inGraph = await graph.import(entry);
      const observed = observe(inGraph);
      const leftover = paths.map(path => path in hostRequire.cache);
      const host = await import(entry);

      expect(observed).toEqual({ keys: ["d", "value"], keysOfC: ["d", "value"], readC: "c" });
      expect(observe(host)).toEqual(observed);
      expect(leftover).toEqual([false, false]);
    });

    test("each graph evaluates a module it requires once, however often and however it asks", async () => {
      using dir = tempDir("module-graph-require-evaluations", {
        "evaluated.mjs": `
          export const evaluation = evaluated();
          export const marker = () => {};
        `,
        "entry.mjs": `
          export const viaBareRequire = () => require("./evaluated.mjs");
          ${probe}
        `,
      });
      const entry = join(String(dir), "entry.mjs");

      let evaluations = 0;
      const globals = { evaluated: () => ++evaluations };
      const seen: number[][] = [];
      const markers = new Set();
      for (let i = 0; i < 3; i++) {
        const inGraph = await new ModuleGraph({ globals }).import(entry);
        const instances = [
          inGraph.metaRequire("./evaluated.mjs"),
          inGraph.metaRequire(join(String(dir), "evaluated.mjs")),
          inGraph.viaBareRequire(),
          await inGraph.load("./evaluated.mjs"),
          inGraph.metaRequire("./evaluated.mjs"),
        ];
        seen.push(instances.map(instance => instance.evaluation));
        for (const instance of instances) markers.add(instance.marker);
      }

      expect({ seen, evaluations, distinctInstances: markers.size }).toEqual({
        seen: [
          [1, 1, 1, 1, 1],
          [2, 2, 2, 2, 2],
          [3, 3, 3, 3, 3],
        ],
        evaluations: 3,
        distinctInstances: 3,
      });
      expect([...markers].map(marker => requireCacheHolds("marker", marker))).toEqual([false, false, false]);
    });

    // While a graph's require() is evaluating an ES module for the first time, a placeholder for
    // it sits in require.cache, and a CommonJS module that requires the same file gets the
    // placeholder's empty exports instead of the host's instance.
    test("a CommonJS require() during the graph's first load still gets the host's instance", async () => {
      using dir = tempDir("module-graph-require-placeholder", {
        "helper.cjs": `exports.requireSubject = () => require("./subject.mjs");`,
        "subject.mjs": `
          import helper from "./helper.cjs";
          export const marker = () => {};
          export const seenByCommonJS = typeof inGraph === "undefined" ? undefined : helper.requireSubject();
        `,
        "entry.mjs": probe,
      });
      const entry = join(String(dir), "entry.mjs");

      const hostSubject = await import(join(String(dir), "subject.mjs"));
      using graph = new ModuleGraph({ globals: { inGraph: true } });
      const inGraph = await graph.import(entry);
      const subject = inGraph.metaRequire("./subject.mjs");

      expect(subject.marker).not.toBe(hostSubject.marker);
      expect(subject.seenByCommonJS).toBe(hostSubject);
    });

    test("another graph's require() during the first load still gets its own instance", async () => {
      using dir = tempDir("module-graph-require-placeholder-graphs", {
        "subject.mjs": `
          export const marker = () => {};
          export const seenByOtherGraph = duringEvaluation();
        `,
        "entry.mjs": probe,
      });
      const entry = join(String(dir), "entry.mjs");

      using other = new ModuleGraph({ globals: { duringEvaluation: () => undefined } });
      const inOther = await other.import(entry);
      using graph = new ModuleGraph({ globals: { duringEvaluation: () => inOther.metaRequire("./subject.mjs") } });
      const inGraph = await graph.import(entry);
      const subject = inGraph.metaRequire("./subject.mjs");

      expect(subject.seenByOtherGraph).toBe(await inOther.load("./subject.mjs"));
      expect(subject.seenByOtherGraph.marker).not.toBe(subject.marker);
    });
  });

  describe("of a CommonJS module", () => {
    test("is the one shared instance for the host and every graph", async () => {
      using dir = tempDir("module-graph-require-cjs-shared", {
        "shared.cjs": `
          exports.module = module;
          exports.token = {};
        `,
        "entry.mjs": `
          import imported from "./shared.cjs";
          export { imported };
          ${probe}
        `,
      });
      const entry = join(String(dir), "entry.mjs");
      const shared = join(String(dir), "shared.cjs");

      using a = new ModuleGraph();
      using b = new ModuleGraph({ globals: { tenant: "b" } });
      using c = new ModuleGraph();
      const instances = [await a.import(entry), await b.import(entry), await c.import(entry), await import(entry)];
      const exports = hostRequire(shared);

      expect({
        required: instances.map(instance => instance.metaRequire("./shared.cjs") === exports),
        imported: instances.map(instance => instance.imported === exports),
        inRequireCache: hostRequire.cache[shared] === exports.module,
        loaded: exports.module.loaded,
      }).toEqual({
        required: [true, true, true, true],
        imported: [true, true, true, true],
        inRequireCache: true,
        loaded: true,
      });
    });

    test("required by a graph first, it is what the host gets afterwards", async () => {
      using dir = tempDir("module-graph-require-cjs-graph-first", {
        "child.cjs": `exports.module = module;`,
        "parent.cjs": `
          exports.module = module;
          exports.child = require("./child.cjs");
          exports.seesGraphGlobals = typeof tenant !== "undefined";
        `,
        "entry.mjs": probe,
      });
      const entry = join(String(dir), "entry.mjs");
      const parent = join(String(dir), "parent.cjs");

      using graph = new ModuleGraph({ globals: { tenant: "a" } });
      const inGraph = await graph.import(entry);
      const required = inGraph.metaRequire("./parent.cjs");
      const { module } = required;

      expect({
        hostGetsTheSame: hostRequire(parent) === required,
        inRequireCache: hostRequire.cache[parent] === module,
        id: module.id,
        loaded: module.loaded,
        parent: [module.parent.id, module.parent.filename],
        parentKnowsIt: module.parent.children.includes(module),
        children: module.children.map((child: any) => child.id),
        childParent: required.child.module.parent === module,
        seesGraphGlobals: required.seesGraphGlobals,
      }).toEqual({
        hostGetsTheSame: true,
        inRequireCache: true,
        id: parent,
        loaded: true,
        parent: [entry, entry],
        parentKnowsIt: true,
        children: [join(String(dir), "child.cjs")],
        childParent: true,
        seesGraphGlobals: false,
      });
    });

    describe.each(["a graph", "the host"])("first required by %s", first => {
      test("its own require() and import() of an ES module give the host's instance", async () => {
        using dir = tempDir("module-graph-require-cjs-esm", {
          "counter.mjs": counter,
          "inner.cjs": `exports.counter = require("./counter.mjs");`,
          "outer.cjs": `
            exports.atLoad = require("./counter.mjs");
            exports.later = () => require("./counter.mjs");
            exports.lazy = () => require("./lazy.mjs");
            exports.nested = require("./inner.cjs").counter;
            exports.dynamic = () => import("./counter.mjs");
          `,
          "lazy.mjs": counter,
          "entry.mjs": `
            import * as imported from "./counter.mjs";
            export { imported };
            ${probe}
          `,
        });
        const entry = join(String(dir), "entry.mjs");
        const outerPath = join(String(dir), "outer.cjs");

        using graph = new ModuleGraph();
        const inGraph = await graph.import(entry);
        using other = new ModuleGraph();
        const inOther = await other.import(entry);
        const outer = first === "a graph" ? inGraph.metaRequire("./outer.cjs") : hostRequire(outerPath);
        const hostCounter = await import(join(String(dir), "counter.mjs"));
        inGraph.imported.increment();

        expect({
          sameForEveryone: [
            inGraph.metaRequire("./outer.cjs"),
            inOther.metaRequire("./outer.cjs"),
            hostRequire(outerPath),
          ].map(exports => exports === outer),
          atLoad: outer.atLoad === hostCounter,
          later: outer.later() === hostCounter,
          nested: outer.nested === hostCounter,
          dynamic: (await outer.dynamic()) === hostCounter,
          lazy: outer.lazy() === (await import(join(String(dir), "lazy.mjs"))),
          graphLazyIsItsOwn: inGraph.metaRequire("./lazy.mjs") !== outer.lazy(),
          graphKeepsItsOwn: inGraph.metaRequire("./counter.mjs") === inGraph.imported,
          counts: [hostCounter.count, inGraph.imported.count, inOther.imported.count],
        }).toEqual({
          sameForEveryone: [true, true, true],
          atLoad: true,
          later: true,
          nested: true,
          dynamic: true,
          lazy: true,
          graphLazyIsItsOwn: true,
          graphKeepsItsOwn: true,
          counts: [0, 1, 0],
        });
      });
    });

    test("a CommonJS module that throws is retried, for the graph as for the host", async () => {
      using dir = tempDir("module-graph-require-cjs-throws", {
        "flaky.cjs": `
          const attempts = require("./attempts.cjs");
          if (++attempts.count < 2) throw new Error("not yet");
          exports.attempts = attempts;
        `,
        "attempts.cjs": `exports.count = 0;`,
        "entry.mjs": probe,
      });
      const entry = join(String(dir), "entry.mjs");
      const flaky = join(String(dir), "flaky.cjs");

      using graph = new ModuleGraph();
      const inGraph = await graph.import(entry);
      const failed = inGraph.attempt("./flaky.cjs");
      const leftover = flaky in hostRequire.cache;
      const retried = inGraph.attempt("./flaky.cjs");

      expect({
        failed: failed.message,
        leftover,
        attempts: retried.value?.attempts.count,
        hostGetsTheSame: hostRequire(flaky) === retried.value,
      }).toEqual({ failed: "not yet", leftover: false, attempts: 2, hostGetsTheSame: true });
    });
  });

  describe("of everything else", () => {
    test("builtin modules are the shared ones", async () => {
      using dir = tempDir("module-graph-require-builtins", { "entry.mjs": probe });
      using graph = new ModuleGraph();
      const inGraph = await graph.import(join(String(dir), "entry.mjs"));

      const specifiers = ["node:fs", "fs", "node:path", "node:module", "node:events", "bun:sqlite", "bun:jsc", "bun"];
      expect(specifiers.map(specifier => inGraph.metaRequire(specifier) === hostRequire(specifier))).toEqual(
        specifiers.map(() => true),
      );
      expect(inGraph.metaRequire("bun")).toBe(Bun);
    });

    test("JSON and TOML are the shared objects", async () => {
      using dir = tempDir("module-graph-require-data", {
        "data.json": JSON.stringify({ name: "data", list: [1, 2, 3] }),
        "config.toml": `title = "config"`,
        "entry.mjs": probe,
      });
      const entry = join(String(dir), "entry.mjs");

      using graph = new ModuleGraph();
      const inGraph = await graph.import(entry);
      const json = inGraph.metaRequire("./data.json");
      const toml = inGraph.metaRequire("./config.toml");

      expect({ json, toml }).toEqual({ json: { name: "data", list: [1, 2, 3] }, toml: { title: "config" } });
      expect({
        json: [hostRequire(join(String(dir), "data.json")) === json, inGraph.metaRequire("./data.json") === json],
        toml: [hostRequire(join(String(dir), "config.toml")) === toml, inGraph.metaRequire("./config.toml") === toml],
      }).toEqual({ json: [true, true], toml: [true, true] });
    });

    test("a file that is not a native addon fails as it does for the host", async () => {
      using dir = tempDir("module-graph-require-native", {
        "addon.node": "not a shared library",
        "entry.mjs": probe,
      });
      const entry = join(String(dir), "entry.mjs");
      const addon = join(String(dir), "addon.node");

      using graph = new ModuleGraph();
      const inGraph = await graph.import(entry);
      const host = await import(entry);
      const failed = inGraph.attempt("./addon.node");
      const hostFailed = host.attempt("./addon.node");

      expect(failed.error).toBeInstanceOf(Error);
      expect({ code: failed.code, message: failed.message, leftover: addon in hostRequire.cache }).toEqual({
        code: "ERR_DLOPEN_FAILED",
        message: hostFailed.message,
        leftover: false,
      });
    });

    test("a module that does not resolve throws the usual error and leaves no require.cache entry", async () => {
      using dir = tempDir("module-graph-require-missing", { "entry.mjs": probe });
      const entry = join(String(dir), "entry.mjs");

      using graph = new ModuleGraph();
      const inGraph = await graph.import(entry);
      const host = await import(entry);
      const before = Object.keys(hostRequire.cache).length;
      const specifiers = ["./missing.mjs", "./missing.cjs", "module-graph-require-missing-package", "node:missing"];
      const failed = specifiers.map(specifier => inGraph.attempt(specifier));
      const hostFailed = specifiers.map(specifier => host.attempt(specifier));

      expect(failed.map(({ name, code, message }) => ({ name, code, message }))).toEqual(
        hostFailed.map(({ name, code, message }) => ({ name, code, message })),
      );
      expect({
        name: failed[0].name,
        code: failed[0].code,
        message: failed[0].message,
        leftover: join(String(dir), "missing.mjs") in hostRequire.cache,
        newEntries: Object.keys(hostRequire.cache).length - before,
      }).toEqual({
        name: "ResolveMessage",
        code: "MODULE_NOT_FOUND",
        message: `Cannot find module './missing.mjs'\nRequire stack:\n- ${entry}`,
        leftover: false,
        newEntries: 0,
      });
    });

    test("createRequire() called by the graph's code is an ordinary host require", async () => {
      using dir = tempDir("module-graph-require-create-require", {
        "counter.mjs": counter,
        "shared.cjs": `exports.token = {};`,
        "entry.mjs": `
          import { createRequire } from "node:module";
          import * as imported from "./counter.mjs";
          export { imported };
          export const created = createRequire(import.meta.url);
          ${probe}
        `,
      });
      const entry = join(String(dir), "entry.mjs");

      const host = await import(entry);
      using graph = new ModuleGraph();
      const inGraph = await graph.import(entry);

      expect({
        esmIsHosts: inGraph.created("./counter.mjs") === host.imported,
        esmIsGraphs: inGraph.created("./counter.mjs") === inGraph.imported,
        commonJS: inGraph.created("./shared.cjs") === inGraph.metaRequire("./shared.cjs"),
        cache: inGraph.created.cache === hostRequire.cache,
        resolve: inGraph.created.resolve("./counter.mjs"),
        graphKeepsItsOwn: inGraph.metaRequire("./counter.mjs") === inGraph.imported,
      }).toEqual({
        esmIsHosts: true,
        esmIsGraphs: false,
        commonJS: true,
        cache: true,
        resolve: join(String(dir), "counter.mjs"),
        graphKeepsItsOwn: true,
      });
    });

    test("require.resolve, require.cache and require.main", async () => {
      using dir = tempDir("module-graph-require-properties", {
        "counter.mjs": counter,
        "node_modules/resolved-package/package.json": JSON.stringify({ name: "resolved-package", main: "./main.cjs" }),
        "node_modules/resolved-package/main.cjs": `module.exports = "resolved-package";`,
        "elsewhere/marker.cjs": `module.exports = "elsewhere";`,
        "entry.mjs": probe,
      });
      const entry = join(String(dir), "entry.mjs");

      using graph = new ModuleGraph();
      const inGraph = await graph.import(entry);
      const host = await import(entry);
      const { metaRequire } = inGraph;
      let resolveError: any;
      try {
        metaRequire.resolve("./missing.mjs");
      } catch (error) {
        resolveError = error;
      }

      expect({
        relative: metaRequire.resolve("./counter.mjs"),
        bare: metaRequire.resolve("resolved-package"),
        builtin: metaRequire.resolve("node:fs"),
        paths: metaRequire.resolve("./marker.cjs", { paths: [join(String(dir), "elsewhere")] }),
        missing: [resolveError?.name, resolveError?.code],
        resolvingLoadsNothing: join(String(dir), "counter.mjs") in hostRequire.cache,
        cache: metaRequire.cache === hostRequire.cache,
        main: metaRequire.main === host.metaRequire.main,
        ownKeys: Reflect.ownKeys(metaRequire).sort(),
      }).toEqual({
        relative: join(String(dir), "counter.mjs"),
        bare: join(String(dir), "node_modules/resolved-package/main.cjs"),
        builtin: "node:fs",
        paths: join(String(dir), "elsewhere/marker.cjs"),
        missing: ["ResolveMessage", "MODULE_NOT_FOUND"],
        resolvingLoadsNothing: false,
        cache: true,
        main: true,
        ownKeys: Reflect.ownKeys(host.metaRequire).sort(),
      });
    });
  });

  describe("after dispose()", () => {
    test("an ES module throws ERR_INVALID_STATE, loaded before or not", async () => {
      using dir = tempDir("module-graph-require-disposed-esm", {
        "loaded.mjs": counter,
        "never-loaded.mjs": counter,
        "entry.mjs": `
          import * as imported from "./loaded.mjs";
          export { imported };
          ${probe}
        `,
      });
      const entry = join(String(dir), "entry.mjs");

      const graph = new ModuleGraph();
      const inGraph = await graph.import(entry);
      const before = inGraph.metaRequire("./loaded.mjs");
      graph.dispose();
      const neverLoaded = inGraph.attempt("./never-loaded.mjs");
      const loaded = inGraph.attempt("./loaded.mjs");

      expect(neverLoaded.error).toBeInstanceOf(Error);
      expect({
        codes: [neverLoaded.code, loaded.code],
        leftover: join(String(dir), "never-loaded.mjs") in hostRequire.cache,
        alreadyObtainedStillWorks: [before.increment(), inGraph.imported.count],
        hostIsUnaffected: hostRequire(join(String(dir), "never-loaded.mjs")).increment(),
      }).toEqual({
        codes: ["ERR_INVALID_STATE", "ERR_INVALID_STATE"],
        leftover: false,
        alreadyObtainedStillWorks: [1, 1],
        hostIsUnaffected: 1,
      });
    });

    test("CommonJS, builtins, JSON and require.resolve keep working", async () => {
      using dir = tempDir("module-graph-require-disposed-cjs", {
        "counter.mjs": counter,
        "before.cjs": `exports.token = {};`,
        "after.cjs": `
          exports.token = {};
          exports.counter = require("./counter.mjs");
        `,
        "data.json": JSON.stringify({ ok: true }),
        "entry.mjs": probe,
      });
      const entry = join(String(dir), "entry.mjs");

      const graph = new ModuleGraph();
      const inGraph = await graph.import(entry);
      const before = inGraph.metaRequire("./before.cjs");
      graph.dispose();
      const after = inGraph.metaRequire("./after.cjs");

      expect({
        loadedBefore: inGraph.metaRequire("./before.cjs") === before,
        loadedAfter: hostRequire(join(String(dir), "after.cjs")) === after,
        commonJSRequiresHostsESM: after.counter === (await import(join(String(dir), "counter.mjs"))),
        builtin: inGraph.metaRequire("node:fs") === hostRequire("node:fs"),
        json: inGraph.metaRequire("./data.json"),
        resolve: inGraph.metaRequire.resolve("./counter.mjs"),
        missing: inGraph.attempt("./missing.cjs").code,
      }).toEqual({
        loadedBefore: true,
        loadedAfter: true,
        commonJSRequiresHostsESM: true,
        builtin: true,
        json: { ok: true },
        resolve: join(String(dir), "counter.mjs"),
        missing: "MODULE_NOT_FOUND",
      });
    });

    test("other graphs and the host keep requiring their own instances", async () => {
      using dir = tempDir("module-graph-require-disposed-others", {
        "counter.mjs": counter,
        "entry.mjs": probe,
      });
      const entry = join(String(dir), "entry.mjs");

      const disposed = new ModuleGraph();
      using other = new ModuleGraph();
      const inDisposed = await disposed.import(entry);
      const inOther = await other.import(entry);
      const host = await import(entry);
      disposed.dispose();

      const ofOther = inOther.metaRequire("./counter.mjs");
      const ofHost = host.metaRequire("./counter.mjs");
      expect({
        disposed: inDisposed.attempt("./counter.mjs").code,
        other: ofOther === (await inOther.load("./counter.mjs")),
        host: ofHost === (await host.load("./counter.mjs")),
        distinct: ofOther !== ofHost,
      }).toEqual({ disposed: "ERR_INVALID_STATE", other: true, host: true, distinct: true });
    });
  });

  describe("when the host patches node:module", () => {
    const files = {
      "imported.mjs": counter,
      "lazy.mjs": counter,
      "typed.ts": `
        export let count: number = 0;
        export function increment(): number { return ++count; }
      `,
      "plain.js": counter,
      "common.cjs": `
        globalThis.commonEvaluations = (globalThis.commonEvaluations ?? 0) + 1;
        exports.imported = require("./imported.mjs");
        exports.injected = typeof injectedByWrapper === "undefined" ? undefined : injectedByWrapper;
      `,
      "entry.mjs": `
        import * as imported from "./imported.mjs";
        export { imported };
        ${probe}
      `,
      "main.mjs": `
        import Module, { createRequire } from "node:module";
        const require = createRequire(import.meta.url);
        const dir = import.meta.dir;
        const relative = value => typeof value === "string" ? value.replace(dir + "/", "") : typeof value;

        let log = [];
        const wrapExtensions = wrap => {
          for (const extension of [".js", ".mjs", ".ts"]) {
            Module._extensions[extension] = wrap(Module._extensions[extension], extension);
          }
        };
        const patches = {
          "nothing patched": () => {},
          "Module._extensions wrapped, calling the original": () =>
            wrapExtensions(original => (module, filename) => original(module, filename)),
          "Module._extensions wrapped, logging": () =>
            wrapExtensions((original, extension) => function (module, filename) {
              log.push(extension + " " + relative(filename));
              return original.call(this, module, filename);
            }),
          "Module.prototype.require overridden": () => {
            const original = Module.prototype.require;
            Module.prototype.require = function (id) {
              log.push("require " + relative(id));
              return original.call(this, id);
            };
          },
          "Module._resolveFilename overridden": () => {
            const original = Module._resolveFilename;
            Module._resolveFilename = function (request, ...rest) {
              log.push("resolve " + relative(request));
              return original.call(this, request === "redirected" ? dir + "/imported.mjs" : request, ...rest);
            };
          },
          "Module._load overridden": () => {
            const original = Module._load;
            Module._load = function (request, ...rest) {
              log.push("load " + relative(request));
              return original.call(this, request, ...rest);
            };
          },
          "Module.wrap overridden": () => {
            const original = Module.wrap;
            Module.wrap = source => {
              log.push("wrap");
              return original(source);
            };
          },
          "Module.wrapper modified": () => {
            Module.wrapper[0] += "var injectedByWrapper = 'Module.wrapper';";
          },
        };
        const [name, when] = process.argv.slice(2);

        if (when === "before the graph loads anything") patches[name]();
        const graph = await new Bun.unsafe.ModuleGraph().import(dir + "/entry.mjs");
        if (when === "after the graph loaded something") patches[name]();
        const host = await import(dir + "/entry.mjs");

        const result = { modules: {} };
        const logs = { host: [], graph: [] };
        const requireInGraph = file => {
          log = logs.graph;
          return graph.metaRequire("./" + file);
        };
        const requireInHost = file => {
          log = logs.host;
          return require("./" + file);
        };
        for (const [file, first] of [["imported.mjs", "host"], ["lazy.mjs", "graph"], ["typed.ts", "host"], ["plain.js", "graph"]]) {
          if (first === "graph") requireInGraph(file);
          const hostRequired = requireInHost(file);
          const required = requireInGraph(file);
          required.increment();
          result.modules[file] = {
            graphsOwn: required === await graph.load("./" + file),
            hostsOwn: hostRequired === await import(dir + "/" + file),
            counts: [hostRequired.count, required.count],
            leaked: Object.values(require.cache).some(module => module?.exports?.increment === required.increment),
          };
        }
        log = logs.graph;
        try {
          result.redirected = graph.metaRequire("redirected") === graph.imported;
        } catch (error) {
          result.redirected = error.code;
        }
        const common = graph.metaRequire("./common.cjs");
        result.commonJS = {
          shared: common === require("./common.cjs"),
          requiresHostsESM: common.imported === host.imported,
          evaluations: globalThis.commonEvaluations,
          injected: common.injected,
        };
        result.logs = logs;
        console.log(JSON.stringify(result));
      `,
    };

    const graphsOwn = { graphsOwn: true, hostsOwn: true, counts: [0, 1], leaked: false };
    const unpatched = {
      modules: { "imported.mjs": graphsOwn, "lazy.mjs": graphsOwn, "typed.ts": graphsOwn, "plain.js": graphsOwn },
      redirected: "MODULE_NOT_FOUND",
      commonJS: { shared: true, requiresHostsESM: true, evaluations: 1 },
      logs: { host: [], graph: [] },
    };
    // An extension handler runs for a require() that finds neither a loaded instance nor a require.cache
    // entry: never for "imported.mjs", and for the graph only where it required the file before the host did.
    const extensionLogs = {
      host: [".mjs lazy.mjs", ".ts typed.ts", ".js plain.js"],
      graph: [".mjs lazy.mjs", ".js plain.js"],
    };
    const hostRequests = ["./imported.mjs", "./lazy.mjs", "./typed.ts", "./plain.js"];
    const graphRequests = ["./imported.mjs", "./lazy.mjs", "./lazy.mjs", "./typed.ts", "./plain.js", "./plain.js"];

    test.concurrent.each([
      ["nothing patched", "before the graph loads anything", unpatched],
      ["Module._extensions wrapped, calling the original", "before the graph loads anything", unpatched],
      ["Module._extensions wrapped, calling the original", "after the graph loaded something", unpatched],
      ["Module._extensions wrapped, logging", "before the graph loads anything", { ...unpatched, logs: extensionLogs }],
      [
        "Module._extensions wrapped, logging",
        "after the graph loaded something",
        { ...unpatched, logs: extensionLogs },
      ],
      [
        "Module.prototype.require overridden",
        "before the graph loads anything",
        {
          ...unpatched,
          logs: {
            host: hostRequests.map(request => "require " + request),
            graph: [
              ...graphRequests.map(request => "require " + request),
              "require redirected",
              "require ./common.cjs",
              "require ./imported.mjs",
              "require ./common.cjs",
            ],
          },
        },
      ],
      [
        "Module._resolveFilename overridden",
        "before the graph loads anything",
        {
          ...unpatched,
          redirected: true,
          logs: {
            host: hostRequests.map(request => "resolve " + request),
            graph: [
              ...graphRequests.map(request => "resolve " + request),
              "resolve redirected",
              "resolve ./common.cjs",
              "resolve ./imported.mjs",
              "resolve ./common.cjs",
            ],
          },
        },
      ],
      ["Module._load overridden", "before the graph loads anything", unpatched],
      ["Module.wrap overridden", "before the graph loads anything", unpatched],
      [
        "Module.wrapper modified",
        "after the graph loaded something",
        { ...unpatched, commonJS: { ...unpatched.commonJS, injected: "Module.wrapper" } },
      ],
    ])("%s, %s", async (patch, when, expected) => {
      using dir = tempDir("module-graph-require-patched", files);
      const { stdout, stderr, exitCode } = await run(dir, "main.mjs", patch, when);

      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toEqual(expected);
      expect(exitCode).toBe(0);
    });

    test.concurrent("a wrapped Module._extensions handler is handed the graph's instance", async () => {
      using dir = tempDir("module-graph-require-extension-handler", {
        "counter.mjs": counter,
        "entry.mjs": probe,
        "main.mjs": `
          import Module, { createRequire } from "node:module";
          const require = createRequire(import.meta.url);
          const path = import.meta.dir + "/counter.mjs";

          const handled = [];
          const original = Module._extensions[".mjs"];
          Module._extensions[".mjs"] = function (module, filename) {
            original.call(this, module, filename);
            handled.push(module);
          };

          const graph = await new Bun.unsafe.ModuleGraph().import(import.meta.dir + "/entry.mjs");
          const required = graph.metaRequire("./counter.mjs");
          const afterGraph = [path in require.cache, Object.keys(require.cache).includes(path)];
          const hostRequired = require(path);

          console.log(JSON.stringify({
            handled: handled.map(module => module.id === path),
            handlerSawGraphsInstance: handled[0].exports === required,
            handlerSawHostsInstance: handled[1].exports === hostRequired,
            graphsOwn: required === await graph.load("./counter.mjs"),
            distinct: required !== hostRequired,
            afterGraph,
            requireCacheHoldsHosts: require.cache[path] === handled[1],
            requiredAgain: graph.metaRequire("./counter.mjs") === required,
          }));
        `,
      });
      const { stdout, stderr, exitCode } = await run(dir, "main.mjs");

      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toEqual({
        handled: [true, true],
        handlerSawGraphsInstance: true,
        handlerSawHostsInstance: true,
        graphsOwn: true,
        distinct: true,
        afterGraph: [false, false],
        requireCacheHoldsHosts: true,
        requiredAgain: true,
      });
      expect(exitCode).toBe(0);
    });

    // Debug builds abort with `ASSERTION FAILED: wasRemoved` in finishRequireWithError
    // (JSCommonJSModule.cpp). The host's own require() does the same without any ModuleGraph.
    test("a wrapped Module._extensions handler and a module that throws while evaluating", async () => {
      using dir = tempDir("module-graph-require-extension-throws", {
        "throws.mjs": `throw new Error("thrown by throws.mjs");`,
        "entry.mjs": probe,
        "main.mjs": `
          import Module, { createRequire } from "node:module";
          const require = createRequire(import.meta.url);
          const original = Module._extensions[".mjs"];
          Module._extensions[".mjs"] = (module, filename) => original(module, filename);

          const graph = await new Bun.unsafe.ModuleGraph().import(import.meta.dir + "/entry.mjs");
          const attempts = [graph.attempt("./throws.mjs"), graph.attempt("./throws.mjs")];
          console.log(JSON.stringify({
            messages: attempts.map(attempt => attempt.message),
            leftover: (import.meta.dir + "/throws.mjs") in require.cache,
          }));
        `,
      });
      const { stdout, exitCode } = await run(dir, "main.mjs");

      expect(JSON.parse(stdout)).toEqual({
        messages: ["thrown by throws.mjs", "thrown by throws.mjs"],
        leftover: false,
      });
      expect(exitCode).toBe(0);
    });
  });

  describe("and the process-wide require.cache", () => {
    test.concurrent("one evaluation of a CommonJS module for the host and every graph", async () => {
      using dir = tempDir("module-graph-require-cjs-evaluations", {
        "shared.cjs": `
          globalThis.sharedEvaluations = (globalThis.sharedEvaluations ?? 0) + 1;
          exports.token = {};
        `,
        "entry.mjs": `
          import imported from "./shared.cjs";
          export { imported };
          ${probe}
        `,
        "main.mjs": `
          import { createRequire } from "node:module";
          const require = createRequire(import.meta.url);
          const entry = import.meta.dir + "/entry.mjs";

          const graphs = [];
          for (let i = 0; i < 4; i++) graphs.push(await new Bun.unsafe.ModuleGraph().import(entry));
          const tokens = graphs.flatMap(graph => [graph.imported.token, graph.metaRequire("./shared.cjs").token]);
          const host = await import(entry);
          tokens.push(host.imported.token, require("./shared.cjs").token);

          console.log(JSON.stringify({
            distinctTokens: new Set(tokens).size,
            evaluations: globalThis.sharedEvaluations,
          }));
        `,
      });
      const { stdout, stderr, exitCode } = await run(dir, "main.mjs");

      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toEqual({ distinctTokens: 1, evaluations: 1 });
      expect(exitCode).toBe(0);
    });

    test.concurrent("deleting require.cache[path] leaves the graph's instances alone", async () => {
      using dir = tempDir("module-graph-require-cache-delete", {
        "counter.mjs": counter,
        "shared.cjs": `exports.token = {};`,
        "entry.mjs": `
          import * as imported from "./counter.mjs";
          export { imported };
          ${probe}
        `,
        "main.mjs": `
          import { createRequire } from "node:module";
          const require = createRequire(import.meta.url);
          const path = import.meta.dir + "/counter.mjs";
          const sharedPath = import.meta.dir + "/shared.cjs";

          const graph = await new Bun.unsafe.ModuleGraph().import(import.meta.dir + "/entry.mjs");
          graph.imported.increment();
          const hostBefore = require(path);
          const sharedBefore = graph.metaRequire("./shared.cjs");

          const deleted = [delete require.cache[path], delete require.cache[sharedPath]];
          const hostAfter = require(path);

          console.log(JSON.stringify({
            deleted,
            graphRequire: graph.metaRequire("./counter.mjs") === graph.imported,
            graphImport: (await graph.load("./counter.mjs")) === graph.imported,
            graphCount: graph.metaRequire("./counter.mjs").count,
            hostReloaded: hostAfter !== hostBefore,
            hostIsNotGraphs: hostAfter !== graph.imported,
            // CommonJS is not the graph's: the graph sees the reloaded module like everyone else.
            commonJSReloaded: graph.metaRequire("./shared.cjs") !== sharedBefore,
            commonJSShared: graph.metaRequire("./shared.cjs") === require(sharedPath),
          }));
        `,
      });
      const { stdout, stderr, exitCode } = await run(dir, "main.mjs");

      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toEqual({
        deleted: [true, true],
        graphRequire: true,
        graphImport: true,
        graphCount: 1,
        hostReloaded: true,
        hostIsNotGraphs: true,
        commonJSReloaded: true,
        commonJSShared: true,
      });
      expect(exitCode).toBe(0);
    });

    test.concurrent(
      "a module the host plants in require.cache[path] is what a graph's require() returns too",
      async () => {
        using dir = tempDir("module-graph-require-cache-assign", {
          "counter.mjs": counter,
          "replacement.cjs": `exports.replacement = true;`,
          "entry.mjs": probe,
          "main.mjs": `
          import { createRequire } from "node:module";
          const require = createRequire(import.meta.url);
          const path = import.meta.dir + "/counter.mjs";

          const graph = await new Bun.unsafe.ModuleGraph().import(import.meta.dir + "/entry.mjs");
          const replacement = require("./replacement.cjs");
          require.cache[path] = require.cache[import.meta.dir + "/replacement.cjs"];
          const required = graph.metaRequire("./counter.mjs");

          const imported = await graph.load("./counter.mjs");
          const result = {
            hostGetsReplacement: require(path) === replacement,
            graphGetsReplacement: required === replacement && graph.metaRequire("./counter.mjs") === replacement,
            graphImportIsUnaffected: typeof imported.increment === "function",
          };
          delete require.cache[path];
          result.afterDelete = graph.metaRequire("./counter.mjs") === imported;
          console.log(JSON.stringify(result));
        `,
        });
        const { stdout, stderr, exitCode } = await run(dir, "main.mjs");

        expect(stderr).toBe("");
        expect(JSON.parse(stdout)).toEqual({
          hostGetsReplacement: true,
          graphGetsReplacement: true,
          graphImportIsUnaffected: true,
          afterDelete: true,
        });
        expect(exitCode).toBe(0);
      },
    );

    test.concurrent("require.main is the entry point's module, from a CommonJS entry point too", async () => {
      using dir = tempDir("module-graph-require-main", {
        "entry.mjs": probe,
        "main.cjs": `
          new Bun.unsafe.ModuleGraph().import(__dirname + "/entry.mjs").then(graph => {
            console.log(JSON.stringify({
              isRequireMain: graph.metaRequire.main === require.main,
              isThisModule: graph.metaRequire.main === module,
              graphMainModule: typeof graph.metaRequire.main.filename,
            }));
          });
        `,
      });
      const { stdout, stderr, exitCode } = await run(dir, "main.cjs");

      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toEqual({ isRequireMain: true, isThisModule: true, graphMainModule: "string" });
      expect(exitCode).toBe(0);
    });
  });
});
