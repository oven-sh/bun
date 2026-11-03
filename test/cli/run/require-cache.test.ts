import { describe, expect, test } from "bun:test";
import {
  bunEnv,
  bunExe,
  isArm64,
  isASAN,
  isBroken,
  isCI,
  isIntelMacOS,
  isMacOS,
  isMusl,
  isWindows,
  tempDir,
} from "harness";
import { join } from "path";

describe.concurrent("require.cache", () => {
  test("require.cache is not an empty object literal when inspected", () => {
    const inspected = Bun.inspect(require.cache);
    expect(inspected).not.toBe("{}");
    expect(inspected).toContain("Module {");
  });

  // This also tests __dirname and __filename
  test("require.cache", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", join(import.meta.dir, "require-cache-fixture.cjs")],
      env: bunEnv,
      stderr: "inherit",
    });

    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

    expect(stdout.trim()).toEndWith("--pass--");
    expect(exitCode).toBe(0);
  });

  // https://github.com/oven-sh/bun/issues/5188
  // msgpackr-extract has no prebuilt binary for win32-arm64, so it's unavailable there
  test.skipIf(isWindows && isArm64)("require.cache does not include unevaluated modules", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", join(import.meta.dir, "require-cache-bug-5188.js")],
      env: bunEnv,
      stderr: "inherit",
    });

    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

    expect(stdout.trim()).toEndWith("--pass--");
    expect(exitCode).toBe(0);
  });

  // Node prints the same line: its require.cache is an object without a prototype that holds each entry as a data property.
  test("a property descriptor of require.cache holds the entry, and the object has no prototype", async () => {
    using dir = tempDir("require-cache-descriptor", {
      "dep.cjs": `exports.dep = 1;`,
      "index.cjs": `
        const { isDeepStrictEqual, types } = require("node:util");
        require("./dep.cjs");
        const cache = require.cache;
        const keys = Object.keys(cache);
        const key = require.resolve("./dep.cjs");
        const copy = order => {
          const object = Object.create(null);
          for (const k of order) object[k] = cache[k];
          return object;
        };
        const reversed = [...keys].reverse();
        const attempt = fn => {
          try {
            return fn();
          } catch (error) {
            return error.constructor.name;
          }
        };
        const shape = d => d && [d.value === undefined ? "get" in d : d.value, d.writable, d.enumerable, d.configurable];

        const descriptor = Object.getOwnPropertyDescriptor(cache, key);
        const result = {
          entries: keys.length,
          descriptor: [descriptor.value === cache[key], descriptor.writable, descriptor.enumerable, descriptor.configurable],
          descriptorHoldsEntry: keys.every(k => Object.getOwnPropertyDescriptor(cache, k).value === cache[k]),
          reflect: Reflect.getOwnPropertyDescriptor(cache, key).value === cache[key],
          clone: Object.create(null, Object.getOwnPropertyDescriptors(cache))[key] === cache[key],
          sameOrder: [isDeepStrictEqual(copy(keys), cache, true), isDeepStrictEqual(cache, copy(keys), true)],
          otherOrder: [isDeepStrictEqual(copy(reversed), cache, true), isDeepStrictEqual(cache, copy(reversed), true)],
          withPrototypes: [isDeepStrictEqual(copy(keys), cache), isDeepStrictEqual(cache, copy(keys))],
          isProxy: types.isProxy(cache),
          inherited: [typeof cache.constructor, typeof cache.hasOwnProperty, typeof cache.toString, attempt(() => String(cache))],
          missing: [Object.getOwnPropertyDescriptor(cache, "/missing"), "/missing" in cache, cache["/missing"]],
        };

        // A store through Reflect.set() with the cache as the receiver asks for a writable data property.
        result.receiver = [Reflect.set({}, "/receiver", 1, cache), cache["/receiver"], delete cache["/receiver"], "/receiver" in cache];
        const heir = Object.create(cache);
        heir["/heir"] = 1;
        result.heir = [Object.hasOwn(heir, "/heir"), "/heir" in cache, heir[key] === cache[key]];

        cache["/null"] = null;
        cache["/undefined"] = undefined;
        result.falsy = [
          cache["/null"],
          "/null" in cache,
          shape(Object.getOwnPropertyDescriptor(cache, "/null")),
          "/undefined" in cache,
          shape(Object.getOwnPropertyDescriptor(cache, "/undefined")),
        ];
        delete cache["/null"];
        delete cache["/undefined"];

        const entry = { exports: "defined" };
        Object.defineProperty(cache, "/entry", { value: entry, writable: true, enumerable: true, configurable: true });
        result.definedEntry = [cache["/entry"] === entry, Object.keys(cache).includes("/entry"), shape(Object.getOwnPropertyDescriptor(cache, "/entry")).slice(1)];
        Object.defineProperty(cache, "/entry", { value: "again" });
        result.redefinedEntry = shape(Object.getOwnPropertyDescriptor(cache, "/entry"));
        Object.defineProperty(cache, "/entry", { enumerable: false });
        result.hiddenEntry = [shape(Object.getOwnPropertyDescriptor(cache, "/entry")), Object.keys(cache).includes("/entry"), "/entry" in cache, delete cache["/entry"], "/entry" in cache];
        Object.defineProperty(cache, "/getter", { get: () => "got", configurable: true });
        result.getter = [cache["/getter"], shape(Object.getOwnPropertyDescriptor(cache, "/getter")), Object.keys(cache).includes("/getter"), delete cache["/getter"], "/getter" in cache];
        Object.defineProperty(cache, "/fixed", { value: 5 });
        result.fixed = [shape(Object.getOwnPropertyDescriptor(cache, "/fixed")), Reflect.ownKeys(cache).includes("/fixed"), Object.keys(cache).includes("/fixed"), delete cache["/fixed"], Object.keys(cache).length === keys.length];

        const symbol = Symbol("key");
        cache[symbol] = 1;
        result.symbol = [cache[symbol], Object.getOwnPropertySymbols(cache).length, Object.keys(cache).length === keys.length, delete cache[symbol], symbol in cache];

        // What a program puts on Object.prototype is no part of a descriptor.
        Object.prototype.get = function () {};
        Object.prototype.value = "inherited";
        try {
          result.pollutedPrototype = [Object.keys(cache).length === keys.length, Object.getOwnPropertyDescriptor(cache, key).value === cache[key]];
        } finally {
          delete Object.prototype.get;
          delete Object.prototype.value;
        }
        console.log(JSON.stringify(result));
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "index.cjs"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout.trim(), stderr, exitCode }).toEqual({
      stdout: JSON.stringify({
        entries: 2,
        descriptor: [true, true, true, true],
        descriptorHoldsEntry: true,
        reflect: true,
        clone: true,
        sameOrder: [true, true],
        otherOrder: [true, true],
        withPrototypes: [true, true],
        isProxy: false,
        inherited: ["undefined", "undefined", "undefined", "TypeError"],
        missing: [undefined, false, undefined],
        receiver: [true, 1, true, false],
        heir: [true, false, true],
        falsy: [null, true, [null, true, true, true], true, [false, true, true, true]],
        definedEntry: [true, true, [true, true, true]],
        redefinedEntry: ["again", true, true, true],
        hiddenEntry: [["again", true, false, true], false, true, true, false],
        getter: ["got", [true, undefined, false, true], false, true, false],
        fixed: [[5, false, false, false], true, false, false, true],
        symbol: [1, 1, true, true, false],
        pollutedPrototype: [true, true],
      }),
      stderr: "",
      exitCode: 0,
    });
  });

  test("every way to reach require.cache answers with the entry: Module._cache, a created require, a Worker, a Bun.ModuleGraph", async () => {
    using dir = tempDir("require-cache-descriptor-routes", {
      "dep.cjs": `exports.dep = 1;`,
      "describe.cjs": `
        module.exports = (cache, load) => {
          load("./dep.cjs");
          const key = require.resolve("./dep.cjs");
          const { value, ...attributes } = Object.getOwnPropertyDescriptor(cache, key);
          return [value === cache[key], cache[key].exports.dep, JSON.stringify(attributes), Object.getPrototypeOf(cache)];
        };
      `,
      "worker.cjs": `postMessage(require("./describe.cjs")(require.cache, require));`,
      "in-graph.mjs": `
        export const described = require("./describe.cjs")(require.cache, require);
        export const cache = require.cache;
      `,
      "index.mjs": `
        import Module, { createRequire } from "node:module";
        import { join } from "node:path";
        const describe = import.meta.require("./describe.cjs");
        const created = createRequire(import.meta.url);
        const worker = new Worker(new URL("./worker.cjs", import.meta.url).href);
        const inWorker = await new Promise(resolve => {
          worker.onmessage = event => resolve(event.data);
          worker.onerror = event => resolve(event.message);
        });
        await worker.terminate();
        const graph = new Bun.ModuleGraph();
        const { described: inGraph, cache: ofGraph } = await graph.import(join(import.meta.dir, "in-graph.mjs"));
        const dep = join(import.meta.dir, "dep.cjs");
        const listedInGraph = Object.keys(ofGraph).includes(dep);
        graph.dispose();
        ofGraph["/stored"] = 1;
        const ofDisposedGraph = [listedInGraph, Object.keys(ofGraph), dep in ofGraph, typeof ofGraph[dep], ofGraph["/stored"]];
        const refused = [];
        for (const lock of [Object.freeze, Object.seal, Object.preventExtensions]) {
          try {
            lock(require.cache);
          } catch (error) {
            refused.push(error.constructor.name);
          }
        }
        console.log(JSON.stringify({
          same: [Module._cache === require.cache, created.cache === require.cache, import.meta.require.cache === require.cache],
          here: describe(require.cache, created),
          inWorker,
          inGraph,
          ofDisposedGraph,
          // The loader adds keys to the cache whatever the object allows, so the object stays extensible.
          refused,
          stillLists: Object.isExtensible(require.cache) && Object.keys(require.cache).some(key => key.endsWith("dep.cjs")),
        }));
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "index.mjs"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const described = [true, 1, JSON.stringify({ writable: true, enumerable: true, configurable: true }), null];
    expect({ stdout: stdout.trim(), stderr, exitCode }).toEqual({
      stdout: JSON.stringify({
        same: [true, true, true],
        here: described,
        inWorker: described,
        inGraph: described,
        ofDisposedGraph: [true, ["/stored"], false, "undefined", 1],
        refused: ["TypeError", "TypeError", "TypeError"],
        stillLists: true,
      }),
      stderr: "",
      exitCode: 0,
    });
  });

  test("in a test file, Module._cache is the require.cache of the file and answers with the entry", async () => {
    using dir = tempDir("require-cache-descriptor-test-file", {
      "dep.cjs": `exports.dep = 1;`,
      "one.test.js": `
        import { test } from "bun:test";
        import Module from "node:module";
        test("the cache of a test file", () => {
          require("./dep.cjs");
          const key = require.resolve("./dep.cjs");
          const { value, ...attributes } = Object.getOwnPropertyDescriptor(Module._cache, key);
          console.log(JSON.stringify([Module._cache === require.cache, value === require.cache[key], attributes, Object.getPrototypeOf(Module._cache)]));
        });
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "one.test.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toContain("1 pass");
    expect(stdout.split("\n").filter(line => line.startsWith("["))).toEqual([
      JSON.stringify([true, true, { writable: true, enumerable: true, configurable: true }, null]),
    ]);
    expect(exitCode).toBe(0);
  });

  // Node prints the same line. Its loader reads the property that a definition leaves, and Bun's loader reads the require map, which keeps the entry.
  test("a definition that gives an entry another shape leaves the entry with the loader", async () => {
    const counted = `
      globalThis.runs ??= {};
      const name = require("node:path").basename(__filename);
      globalThis.runs[name] = (globalThis.runs[name] ?? 0) + 1;
      exports.run = globalThis.runs[name];
    `;
    using dir = tempDir("require-cache-reshape", {
      "a.cjs": counted,
      "b.cjs": counted,
      "c.cjs": counted,
      "d.cjs": counted,
      "e.cjs": counted,
      "hides-itself.cjs": `${counted}
        Object.defineProperty(require.cache, __filename, { enumerable: false });
      `,
      "throws-once.cjs": `${counted}
        Object.defineProperty(require.cache, __filename, { enumerable: false });
        if (exports.run === 1) throw new Error("the first load fails");
      `,
      "index.cjs": `
        "use strict";
        const { basename } = require("node:path");
        const cache = require.cache;
        const shape = d => d && ("get" in d ? ["accessor", d.enumerable, d.configurable] : [typeof d.value, d.writable, d.enumerable, d.configurable]);
        const attempt = fn => {
          try {
            return fn();
          } catch (error) {
            return error.constructor.name;
          }
        };
        const result = {};
        let setterGot;
        const reshape = (file, descriptorOf) => {
          const key = require.resolve(file);
          const first = require(file);
          const entry = cache[key];
          Object.defineProperty(cache, key, descriptorOf(entry));
          return [
            require(file) === first,
            globalThis.runs[basename(file)],
            shape(Object.getOwnPropertyDescriptor(cache, key)),
            cache[key] === entry,
            Object.keys(cache).includes(key),
            Reflect.ownKeys(cache).includes(key),
            key in cache,
          ];
        };
        result.readOnly = reshape("./a.cjs", () => ({ writable: false }));
        result.hidden = reshape("./b.cjs", () => ({ enumerable: false }));
        result.locked = reshape("./c.cjs", () => ({ configurable: false }));
        result.accessor = reshape("./d.cjs", entry => ({ get: () => entry, set: value => void (setterGot = value), enumerable: true, configurable: true }));

        // What a store and a deletion do to each shape, and what the next require() answers with.
        const [a, b, c, d, e] = ["a", "b", "c", "d", "e"].map(name => require.resolve("./" + name + ".cjs"));
        const replacement = { exports: "replaced", loaded: true };
        result.storeIntoReadOnly = [Reflect.set(cache, a, replacement), attempt(() => (cache[a] = replacement)), require("./a.cjs").run];
        cache[b] = replacement;
        result.storeIntoHidden = [require("./b.cjs"), cache[b] === replacement, shape(Object.getOwnPropertyDescriptor(cache, b)), Object.keys(cache).includes(b)];
        result.deleteLocked = [Reflect.deleteProperty(cache, c), attempt(() => delete cache[c]), c in cache, require("./c.cjs").run];
        cache[d] = replacement;
        result.storeThroughAccessor = [setterGot === replacement, require("./d.cjs").run];
        // An accessor that becomes a data property again holds no value, and the loader has no entry any more.
        Object.defineProperty(cache, d, { writable: true });
        result.accessorToData = [shape(Object.getOwnPropertyDescriptor(cache, d)), require("./d.cjs").run, cache[d].exports.run, shape(Object.getOwnPropertyDescriptor(cache, d))];
        result.deleteHidden = [delete cache[b], b in cache, require("./b.cjs").run, shape(Object.getOwnPropertyDescriptor(cache, b)), Object.keys(cache).includes(b)];

        // A value that a definition names is what require() answers with, whatever the shape.
        Object.defineProperty(cache, e, { value: replacement, configurable: true });
        result.definedBeforeLoad = [
          require("./e.cjs"),
          globalThis.runs["e.cjs"] ?? 0,
          shape(Object.getOwnPropertyDescriptor(cache, e)),
          Object.keys(cache).includes(e),
          delete cache[e],
          require("./e.cjs").run,
        ];

        // A file that hides its own entry runs once.
        const hider = require.resolve("./hides-itself.cjs");
        const answers = new Set();
        for (let i = 0; i < 5; i++) answers.add(require("./hides-itself.cjs"));
        result.hidesItself = [globalThis.runs["hides-itself.cjs"], answers.size, Object.keys(cache).includes(hider), hider in cache];

        // The loader puts a new entry under a key that has a shape already: the property shows that entry.
        const thrower = require.resolve("./throws-once.cjs");
        const threw = attempt(() => require("./throws-once.cjs"));
        const loaded = require("./throws-once.cjs");
        result.loadedAgain = [threw, globalThis.runs["throws-once.cjs"], cache[thrower].exports === loaded, Object.keys(cache).includes(thrower)];

        // A key that looks like an array index is a key like any other.
        const numbered = { exports: "numbered" };
        cache[7] = numbered;
        result.index = [cache["7"] === numbered, 7 in cache, Object.keys(cache).includes("7"), shape(Object.getOwnPropertyDescriptor(cache, 7))];
        Object.defineProperty(cache, 7, { writable: false });
        result.indexReadOnly = [shape(Object.getOwnPropertyDescriptor(cache, "7")), Reflect.set(cache, 7, 1), cache[7] === numbered, delete cache[7], 7 in cache];
        Object.defineProperty(cache, 8, { value: 1, configurable: true });
        result.indexDefined = [shape(Object.getOwnPropertyDescriptor(cache, 8)), cache[8], Object.keys(cache).includes("8"), Reflect.ownKeys(cache).includes("8"), delete cache[8], "8" in cache];
        console.log(JSON.stringify(result));
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "index.cjs"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout.trim(), stderr, exitCode }).toEqual({
      stdout: JSON.stringify({
        readOnly: [true, 1, ["object", false, true, true], true, true, true, true],
        hidden: [true, 1, ["object", true, false, true], true, false, true, true],
        locked: [true, 1, ["object", true, true, false], true, true, true, true],
        accessor: [true, 1, ["accessor", true, true], true, true, true, true],
        storeIntoReadOnly: [false, "TypeError", 1],
        storeIntoHidden: ["replaced", true, ["object", true, false, true], false],
        deleteLocked: [false, "TypeError", true, 1],
        storeThroughAccessor: [true, 1],
        accessorToData: [["undefined", true, true, true], 2, 2, ["object", true, true, true]],
        deleteHidden: [true, false, 2, ["object", true, true, true], true],
        definedBeforeLoad: ["replaced", 0, ["object", false, false, true], false, true, 1],
        hidesItself: [1, 1, false, true],
        loadedAgain: ["Error", 2, true, false],
        index: [true, true, true, ["object", true, true, true]],
        indexReadOnly: [["object", false, true, true], false, true, true, false],
        indexDefined: [["number", false, false, true], 1, false, true, true, false],
      }),
      stderr: "",
      exitCode: 0,
    });
  });

  test("listing require.cache does not create a namespace object for each ES module", async () => {
    using dir = tempDir("require-cache-esm-namespaces", {
      "a.mjs": `export const a = 1;`,
      "b.mjs": `import { a } from "./a.mjs"; export const b = a + 1;`,
      "index.mjs": `
        import { heapStats } from "bun:jsc";
        import { b } from "./b.mjs";
        import { join } from "node:path";
        const namespaces = () => heapStats().objectTypeCounts.ModuleNamespaceObject ?? 0;
        const aPath = join(import.meta.dir, "a.mjs");
        const before = namespaces();
        const keys = Object.keys(require.cache)
          .filter(key => key.startsWith(import.meta.dir))
          .map(key => key.slice(import.meta.dir.length + 1))
          .sort();
        const has = aPath in require.cache;
        const descriptor = Object.getOwnPropertyDescriptor(require.cache, aPath);
        const createdByListing = namespaces() - before;
        const { a } = require.cache[aPath].exports;
        const createdByGet = namespaces() - before - createdByListing;
        // The key is now in both tables; it is still listed once.
        const listedAfterGet = Object.keys(require.cache).filter(key => key === aPath).length;
        console.log(JSON.stringify({ b, keys, has, descriptor, createdByListing, a, createdByGet, listedAfterGet }));
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "index.mjs"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout.trim(), stderr, exitCode }).toEqual({
      stdout: JSON.stringify({
        b: 2,
        keys: ["a.mjs", "b.mjs"],
        has: true,
        descriptor: { writable: false, enumerable: true, configurable: true },
        createdByListing: 0,
        a: 1,
        createdByGet: 1,
        listedAfterGet: 1,
      }),
      stderr: "",
      exitCode: 0,
    });
  });

  test("only a read of the key makes the entry of an ES module: a property descriptor holds no value until then", async () => {
    using dir = tempDir("require-cache-esm-descriptors", {
      "a.mjs": `export const a = 1;`,
      "b.mjs": `export const b = 2;`,
      "c.mjs": `export const c = 3;`,
      "index.mjs": `
        import { heapStats } from "bun:jsc";
        import { join } from "node:path";
        import { isDeepStrictEqual } from "node:util";
        import * as aNamespace from "./a.mjs";
        import "./b.mjs";
        import "./c.mjs";
        const cache = require.cache;
        const [aPath, bPath, cPath] = ["a.mjs", "b.mjs", "c.mjs"].map(name => join(import.meta.dir, name));
        const count = () => {
          const { Module = 0, ModuleNamespaceObject = 0 } = heapStats().objectTypeCounts;
          return Module + ModuleNamespaceObject;
        };
        let seen = count();
        const madeSince = () => {
          const now = count();
          const made = now - seen;
          seen = now;
          return made;
        };
        const shape = d => d && [typeof d.value, d.writable, d.enumerable, d.configurable];
        const result = {};

        // Whoever asks what a key is like makes no entry.
        result.descriptor = [shape(Object.getOwnPropertyDescriptor(cache, bPath)), shape(Reflect.getOwnPropertyDescriptor(cache, cPath)), madeSince()];
        result.descriptors = [shape(Object.getOwnPropertyDescriptors(cache)[bPath]), madeSince()];
        result.isEnumerable = [Object.prototype.propertyIsEnumerable.call(cache, bPath), madeSince()];
        const valueless = Object.create(null);
        for (const key of Object.keys(cache)) valueless[key] = undefined;
        isDeepStrictEqual(valueless, cache);
        result.comparedWith = madeSince();

        // require() answers with the module behind a descriptor read as it does without one.
        result.required = [require("./a.mjs") === aNamespace, cache[aPath].exports === aNamespace, shape(Object.getOwnPropertyDescriptor(cache, aPath))];
        seen = count();

        // Whoever copies the values reads each key, which makes its entry.
        const entries = Object.entries(cache).filter(([key]) => key === bPath);
        result.entries = [entries.length, entries[0][1] === cache[bPath], entries[0][1].exports.b, madeSince() > 0];
        result.copies = [{ ...cache }[cPath] === cache[cPath], Object.assign({}, cache)[cPath] === cache[cPath], Object.values(cache).includes(cache[cPath])];
        result.afterRead = [shape(Object.getOwnPropertyDescriptor(cache, bPath)), Object.getOwnPropertyDescriptor(cache, bPath).value === cache[bPath], madeSince()];
        console.log(JSON.stringify(result));
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "index.mjs"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout.trim(), stderr, exitCode }).toEqual({
      stdout: JSON.stringify({
        descriptor: [["undefined", false, true, true], ["undefined", false, true, true], 0],
        descriptors: [["undefined", false, true, true], 0],
        isEnumerable: [true, 0],
        comparedWith: 0,
        required: [true, true, ["object", true, true, true]],
        entries: [1, true, 2, true],
        copies: [true, true, true],
        afterRead: [["object", true, true, true], true, 0],
      }),
      stderr: "",
      exitCode: 0,
    });
  });

  test("a debugger that looks at require.cache makes no entry", async () => {
    using dir = tempDir("require-cache-debugger-view", {
      "a.mjs": `export const a = 1;`,
      "b.mjs": `export const b = 2;`,
      "index.mjs": `
        import { heapStats } from "bun:jsc";
        import "./a.mjs";
        import "./b.mjs";
        globalThis.cache = require.cache;
        globalThis.entries = () => {
          const { Module = 0, ModuleNamespaceObject = 0 } = heapStats().objectTypeCounts;
          return Module + ModuleNamespaceObject;
        };
        console.log("ready");
        setInterval(() => {}, 1000);
      `,
    });
    await using child = Bun.spawn({
      cmd: [bunExe(), "--inspect=ws://127.0.0.1:0/", "index.mjs"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const decoder = new TextDecoder();
    let stderr = "";
    let url: string | undefined;
    for await (const chunk of child.stderr) {
      stderr += decoder.decode(chunk);
      url = stderr.match(/(ws:\/\/[^\s]+)/)?.[1];
      if (url) break;
    }
    if (!url) throw new Error(`Unable to find the inspector URL in:\n${stderr}`);
    let stdout = "";
    for await (const chunk of child.stdout) {
      stdout += decoder.decode(chunk);
      if (stdout.includes("ready")) break;
    }
    expect(stdout).toContain("ready");

    type Reply = { result?: any; error?: { message: string } };
    const pending = new Map<number, (reply: Reply) => void>();
    // A crash closes the socket. The reply then says so, and the assertions below show it.
    const closed = Promise.withResolvers<Reply>();
    const opened = Promise.withResolvers<Reply>();
    const webSocket = new WebSocket(url);
    webSocket.addEventListener("open", () => opened.resolve({}));
    webSocket.addEventListener("close", () =>
      closed.resolve({ error: { message: "the inspector closed the socket" } }),
    );
    webSocket.addEventListener("error", () => closed.resolve({ error: { message: "the inspector socket failed" } }));
    webSocket.addEventListener("message", ({ data }) => {
      const reply: Reply & { id: number } = JSON.parse(data.toString());
      pending.get(reply.id)?.(reply);
      pending.delete(reply.id);
    });
    let nextId = 1;
    const send = (method: string, params: object = {}): Promise<Reply> => {
      const id = nextId++;
      const { promise, resolve } = Promise.withResolvers<Reply>();
      pending.set(id, resolve);
      webSocket.send(JSON.stringify({ id, method, params }));
      return Promise.race([promise, closed.promise]);
    };
    const valueOf = async (expression: string) => {
      const reply = await send("Runtime.evaluate", { expression, returnByValue: true });
      return reply.error?.message ?? reply.result.result.value;
    };
    expect(await Promise.race([opened.promise, closed.promise])).toEqual({});

    const before = await valueOf("entries()");
    const viewed = await send("Runtime.evaluate", { expression: "cache", generatePreview: true });
    const objectId = viewed.result?.result?.objectId;
    const names = async (method: string) => {
      const reply = await send(method, { objectId, ownProperties: true, generatePreview: true });
      const properties: { name: string }[] = reply.result?.properties ?? reply.result?.result ?? [];
      return reply.error?.message ?? properties.map(({ name }) => name.slice(name.lastIndexOf("/") + 1)).sort();
    };
    expect({
      view: viewed.error?.message ?? viewed.result.result.type,
      properties: await names("Runtime.getProperties"),
      displayed: await names("Runtime.getDisplayableProperties"),
      made: (await valueOf("entries()")) - before,
      // The key reads as it does without a debugger.
      read: await valueOf(`Object.keys(cache).filter(key => key.endsWith("a.mjs")).map(key => cache[key].exports.a)`),
    }).toEqual({
      view: "object",
      properties: ["a.mjs", "b.mjs", "index.mjs"],
      displayed: ["a.mjs", "b.mjs", "index.mjs"],
      made: 0,
      read: [1],
    });
    webSocket.close();
  });

  test("a specifier imported under two import attribute types is one key of require.cache", async () => {
    using dir = tempDir("require-cache-esm-attribute-types", {
      "a.mjs": `export const a = 1;`,
      "data.json": `{"x":1}`,
      // Never imported as JavaScript.
      "only.json": `{"y":2}`,
      "index.mjs": `
        import { join } from "node:path";
        import { a } from "./a.mjs";
        import text from "./a.mjs" with { type: "text" };
        import data from "./data.json";
        import sameData from "./data.json" with { type: "json" };
        import only from "./only.json" with { type: "json" };
        import onlyText from "./only.json" with { type: "text" };
        const keys = Object.keys(require.cache)
          .filter(key => key.startsWith(import.meta.dir))
          .map(key => key.slice(import.meta.dir.length + 1))
          .sort();
        // Every key that is listed is there when asked for by name.
        const present = keys.map(key => join(import.meta.dir, key)).every(key => key in require.cache && require.cache[key]);
        console.log(JSON.stringify({ a, text: text.length > 0, x: data.x + sameData.x, y: only.y, onlyText, keys, present }));
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "index.mjs"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout.trim(), stderr, exitCode }).toEqual({
      stdout: JSON.stringify({
        a: 1,
        text: true,
        x: 2,
        y: 2,
        onlyText: `{"y":2}`,
        keys: ["a.mjs", "data.json", "only.json"],
        present: true,
      }),
      stderr: "",
      exitCode: 0,
    });
  });

  describe.skipIf(isBroken && isIntelMacOS)("files transpiled and loaded don't leak the output source code", () => {
    test("via require() with a lot of long export names", async () => {
      let text = "";
      for (let i = 0; i < 10000; i++) {
        text += `exports.superDuperExtraCrazyLongNameWowSuchNameLongYouveNeverSeenANameThisLongForACommonJSModuleExport${i} = 1;\n`;
      }

      console.log("Text length:", text.length);

      await using dir = tempDir("require-cache-bug-leak-1", {
        "index.js": text,
        "require-cache-bug-leak-fixture.js": `
          const path = require.resolve("./index.js");
          const gc = global.gc || globalThis?.Bun?.gc || (() => {});
          const rss = process.memoryUsage.rss;
          const noChildren = module.children = { indexOf() { return 0; } }; // disable children tracking
          function bust() {
            const mod = require.cache[path];
            if (mod) {
              mod.parent = null;
              mod.children = noChildren;
              delete require.cache[path];
            }
          }

          for (let i = 0; i < 50; i++) {
            require(path);
            bust();
          }
          gc(true);
          const baseline = rss();
          for (let i = 0; i < 500; i++) {
            require(path);
            bust(path);
          }
          gc(true);
          const after = rss();
          const diff = after - baseline;
          console.log("RSS diff", (diff / 1024 / 1024) | 0, "MB");
          console.log("RSS", (diff / 1024 / 1024) | 0, "MB");
          if (diff > ${isASAN ? 400 : 100} * 1024 * 1024) {
            // Bun v1.1.21 reported 844 MB here on macOS arm64.
            throw new Error("Memory leak detected");
          }

          exports.abc = 123;
        `,
      });
      console.log({ dir });
      await using proc = Bun.spawn({
        cmd: [bunExe(), "run", "--smol", join(dir, "require-cache-bug-leak-fixture.js")],
        env: bunEnv,
        stdio: ["inherit", "inherit", "inherit"],
      });

      const exitCode = await proc.exited;
      expect(exitCode).toBe(0);
    }, 60000);

    // The harness turns the transpiler cache off, so each import() parses the module again: ~15ms in release, 115 to
    // 185ms under ASAN, where the full counts are a minute of work. The ASAN counts still leak past the limit with the
    // bug (0.64 and 1.7 MB per import); its quarantine, which holds ~150 MB of what was freed, is off for these two.
    const noQuarantine = {
      ...bunEnv,
      ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "quarantine_size_mb=0", "thread_local_quarantine_size_kb=0"]
        .filter(Boolean)
        .join(":"),
    };

    test("via await import() with a lot of function calls", async () => {
      let text = "function i() { return 1; }\n";
      for (let i = 0; i < 20000; i++) {
        text += `i();\n`;
      }
      text += "exports.forceCommonJS = true;\n";

      console.log("Text length:", text.length);

      await using dir = tempDir("require-cache-bug-leak-3", {
        "index.js": text,
        "require-cache-bug-leak-fixture.js": `
          const path = require.resolve("./index.js");
          const gc = global.gc || globalThis?.Bun?.gc || (() => {});
          const rss = process.memoryUsage.rss;
          function bust() {
            delete require.cache[path];
          }

          for (let i = 0; i < ${isASAN ? 25 : 100}; i++) {
            await import(path);
            bust();
          }
          gc(true);
          const baseline = rss();
          for (let i = 0; i < ${isASAN ? 150 : 400}; i++) {
            await import(path);
            bust(path);
          }
          gc(true);
          const after = rss();
          const diff = after - baseline;
          console.log("RSS diff", (diff / 1024 / 1024) | 0, "MB");
          console.log("RSS", (diff / 1024 / 1024) | 0, "MB");
          if (diff > 64 * 1024 * 1024) {
            // Bun v1.1.22 reported 1 MB here on macoS arm64.
            // Bun v1.1.21 reported 257 MB here on macoS arm64.
            throw new Error("Memory leak detected");
          }

          export default 123;
        `,
      });
      await using proc = Bun.spawn({
        cmd: [bunExe(), "run", "--smol", join(dir, "require-cache-bug-leak-fixture.js")],
        env: noQuarantine,
        stdio: ["inherit", "inherit", "inherit"],
      });

      const exitCode = await proc.exited;
      expect(exitCode).toBe(0);
    }, 60000); // takes 4s on an M1 in release build

    test("via import() with a lot of long export names", async () => {
      let text = "";
      for (let i = 0; i < 10000; i++) {
        text += `export const superDuperExtraCrazyLongNameWowSuchNameLongYouveNeverSeenANameThisLongForACommonJSModuleExport${i} = 1;\n`;
      }

      await using dir = tempDir("require-cache-bug-leak-4", {
        "index.js": text,
        "require-cache-bug-leak-fixture.js": `
          const path = require.resolve("./index.js");
          const gc = global.gc || globalThis?.Bun?.gc || (() => {});
          const rss = process.memoryUsage.rss;
          function bust() {
            delete require.cache[path];
          }

          for (let i = 0; i < ${isASAN ? 40 : 50}; i++) {
            await import(path);
            bust();
          }
          gc(true);
          const baseline = rss();
          for (let i = 0; i < ${isASAN ? 60 : 250}; i++) {
            await import(path);
            bust(path);
          }
          gc(true);
          const after = rss();
          const diff = after - baseline;
          console.log("RSS diff", (diff / 1024 / 1024) | 0, "MB");
          console.log("RSS", (diff / 1024 / 1024) | 0, "MB");
          if (diff > 64 * 1024 * 1024) {
            // Bun v1.1.21 reported 423 MB here on macoS arm64.
            // Bun v1.1.22 reported 4 MB here on macoS arm64.
            throw new Error("Memory leak detected");
          }

          export default 124;
        `,
      });
      console.log({ dir });
      await using proc = Bun.spawn({
        cmd: [bunExe(), "run", "--smol", join(dir, "require-cache-bug-leak-fixture.js")],
        env: noQuarantine,
        stdio: ["inherit", "inherit", "inherit"],
      });

      const exitCode = await proc.exited;
      expect(exitCode).toBe(0);
    }, 60000);

    test.todoIf(
      // Flaky specifically on macOS CI, and on musl-aarch64 under ThinLTO +
      // -Zshare-generics where RSS reports ~280 MB for the same workload
      // that measures under 64 MB elsewhere (intermittent).
      isBroken && isCI && (isMacOS || (isMusl && isArm64)),
    )(
      "via require() with a lot of function calls",
      async () => {
        let text = "function i() { return 1; }\n";
        for (let i = 0; i < 20000; i++) {
          text += `i();\n`;
        }
        text += "exports.forceCommonJS = true;\n";

        console.log("Text length:", text.length);

        await using dir = tempDir("require-cache-bug-leak-2", {
          "index.js": text,
          "require-cache-bug-leak-fixture.js": `
          const path = require.resolve("./index.js");
          const gc = global.gc || globalThis?.Bun?.gc || (() => {});
          const rss = process.memoryUsage.rss;
          function bust() {
            const mod = require.cache[path];
            if (mod) {
              mod.parent = null;
              mod.children = [];
              delete require.cache[path];
            }
          }

          for (let i = 0; i < 100; i++) {
            require(path);
            bust();
          }
          gc(true);
          const baseline = rss();
          for (let i = 0; i < 400; i++) {
            require(path);
            bust(path);
          }
          gc(true);
          const after = rss();
          const diff = after - baseline;
          console.log("RSS diff", (diff / 1024 / 1024) | 0, "MB");
          console.log("RSS", (diff / 1024 / 1024) | 0, "MB");
          if (diff > ${isASAN ? 320 : 64} * 1024 * 1024) {
            // Bun v1.1.22 reported 4 MB here on macoS arm64.
            // Bun v1.1.21 reported 248 MB here on macoS arm64.
            throw new Error("Memory leak detected");
          }

          exports.abc = 123;
        `,
        });
        await using proc = Bun.spawn({
          cmd: [bunExe(), "run", "--smol", join(dir, "require-cache-bug-leak-fixture.js")],
          env: bunEnv,
          stdio: ["inherit", "inherit", "inherit"],
        });

        const exitCode = await proc.exited;
        expect(exitCode).toBe(0);
      },
      60000,
    ); // takes 4s on an M1 in release build
  });

  describe("files transpiled and loaded don't leak the AST", () => {
    test("via require()", async () => {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "run", join(import.meta.dir, "require-cache-bug-leak-fixture.js")],
        env: bunEnv,
        stderr: "inherit",
      });

      const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

      expect(stdout.trim()).toEndWith("--pass--");
      expect(exitCode).toBe(0);
    }, 20000);

    test("via import()", async () => {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "run", join(import.meta.dir, "esm-bug-leak-fixture.mjs")],
        env: bunEnv,
        stderr: "inherit",
      });

      const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

      expect(stdout.trim()).toEndWith("--pass--");
      expect(exitCode).toBe(0);
    }, 20000);
  });

  // `delete require.cache[path]` of an ES module evicts its registry entry. A
  // module that is still loading or evaluating is not in require.cache (`in`
  // says false), so deleting it must be a no-op: evicting it mid-load made the
  // next import() of the same path create a second record for it, which the
  // loader's import cache did not expect (segfault at address 0x10 on the
  // next import(), or the module evaluating twice).
  describe("delete require.cache[esm] of a module that is still loading", () => {
    // Every fixture records into one object and prints it once the event loop
    // drains, so the test compares the whole outcome instead of line order.
    const report = `
      const result = (globalThis.__result ??= { evaluated: 0 });
      process.on("beforeExit", () => console.log(JSON.stringify(result)));
      module.exports = result;
    `;

    async function run(dir: string, entry: string) {
      await using proc = Bun.spawn({
        cmd: [bunExe(), entry],
        env: bunEnv,
        cwd: dir,
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      return { stdout, stderr, exitCode };
    }

    // a.mjs is fetched, then its CommonJS dependency runs before a.mjs evaluates.
    // The dependency evicts a.mjs and imports it again.
    const deleteThenImport = {
      "report.cjs": report,
      "a.mjs": `
        import "./b.cjs";
        export const x = 1;
        globalThis.__result.evaluated++;
      `,
      "b.cjs": `
        const result = require("./report.cjs");
        const key = require("node:path").join(__dirname, "a.mjs");
        result.inCacheBeforeDelete = key in require.cache;
        result.deleted = delete require.cache[key];
        import("./a.mjs").then(
          ns => { result.depImport = ns.x; },
          e => { result.depImport = String(e); },
        );
      `,
      "main.mjs": `
        const ns = await import("./a.mjs");
        globalThis.__result.mainImport = ns.x;
        globalThis.__result.secondImportIsSame = (await import("./a.mjs")) === ns;
      `,
    };

    test("import() of the module from its dependency", async () => {
      using dir = tempDir("require-cache-delete-loading-import", deleteThenImport);
      const { stdout, stderr, exitCode } = await run(String(dir), "main.mjs");
      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toEqual({
        evaluated: 1,
        inCacheBeforeDelete: false,
        deleted: true,
        mainImport: 1,
        secondImportIsSame: true,
        depImport: 1,
      });
      expect(exitCode).toBe(0);
    });

    test("import() of the module from its dependency, module is the entry point", async () => {
      using dir = tempDir("require-cache-delete-loading-entry", deleteThenImport);
      const { stdout, stderr, exitCode } = await run(String(dir), "a.mjs");
      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toEqual({ evaluated: 1, inCacheBeforeDelete: false, deleted: true, depImport: 1 });
      expect(exitCode).toBe(0);
    });

    test("require() of the module from its dependency", async () => {
      using dir = tempDir("require-cache-delete-loading-require", {
        ...deleteThenImport,
        "b.cjs": `
          const result = require("./report.cjs");
          const key = require("node:path").join(__dirname, "a.mjs");
          result.deleted = delete require.cache[key];
          result.depRequire = require("./a.mjs").x;
        `,
      });
      const { stdout, stderr, exitCode } = await run(String(dir), "main.mjs");
      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toEqual({
        evaluated: 1,
        deleted: true,
        depRequire: 1,
        mainImport: 1,
        secondImportIsSame: true,
      });
      expect(exitCode).toBe(0);
    });

    test("while the module's top level is running", async () => {
      using dir = tempDir("require-cache-delete-evaluating", {
        "report.cjs": report,
        "a.mjs": `
          import { createRequire } from "node:module";
          const require = createRequire(import.meta.url);
          require("./c.cjs");
          export const x = 1;
          globalThis.__result.evaluated++;
        `,
        "c.cjs": `
          const result = require("./report.cjs");
          const key = require("node:path").join(__dirname, "a.mjs");
          result.inCacheBeforeDelete = key in require.cache;
          result.deleted = delete require.cache[key];
          import("./a.mjs").then(
            ns => { result.depImport = ns.x; },
            e => { result.depImport = String(e); },
          );
        `,
        "main.mjs": `
          const ns = await import("./a.mjs");
          globalThis.__result.mainImport = ns.x;
        `,
      });
      const { stdout, stderr, exitCode } = await run(String(dir), "main.mjs");
      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toEqual({
        evaluated: 1,
        inCacheBeforeDelete: false,
        deleted: true,
        mainImport: 1,
        depImport: 1,
      });
      expect(exitCode).toBe(0);
    });

    test("an evaluated module is still evicted", async () => {
      using dir = tempDir("require-cache-delete-evaluated", {
        "report.cjs": report,
        "a.mjs": `
          export const x = 1;
          globalThis.__result.evaluated++;
        `,
        "main.mjs": `
          import { createRequire } from "node:module";
          import { join } from "node:path";
          const require = createRequire(import.meta.url);
          const result = require("./report.cjs");
          const key = join(import.meta.dir, "a.mjs");
          const first = await import("./a.mjs");
          result.inCacheBeforeDelete = key in require.cache;
          result.deleted = delete require.cache[key];
          result.inCacheAfterDelete = key in require.cache;
          result.secondImportIsSame = (await import("./a.mjs")) === first;
        `,
      });
      const { stdout, stderr, exitCode } = await run(String(dir), "main.mjs");
      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toEqual({
        evaluated: 2,
        inCacheBeforeDelete: true,
        deleted: true,
        inCacheAfterDelete: false,
        secondImportIsSame: false,
      });
      expect(exitCode).toBe(0);
    });
  });

  // These tests are extra slow in debug builds
  describe("files transpiled and loaded don't leak file paths", () => {
    test("via require()", async () => {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "--smol", "run", join(import.meta.dir, "cjs-fixture-leak-small.js")],
        env: bunEnv,
        stderr: "inherit",
      });

      const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

      expect(stdout.trim()).toEndWith("--pass--");
      expect(exitCode).toBe(0);
    }, 30000);

    test(
      "via import()",
      async () => {
        await using proc = Bun.spawn({
          cmd: [bunExe(), "--smol", "run", join(import.meta.dir, "esm-fixture-leak-small.mjs")],
          env: bunEnv,
          stderr: "inherit",
        });

        const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

        expect(stdout.trim()).toEndWith("--pass--");
        expect(exitCode).toBe(0);
      },
      // TODO: Investigate why this is so slow on Windows
      isWindows || isASAN ? 60000 : 30000,
    );
  });
});
