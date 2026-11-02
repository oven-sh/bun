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
      "in-graph.mjs": `export const described = require("./describe.cjs")(require.cache, require);`,
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
        const inGraph = (await graph.import(join(import.meta.dir, "in-graph.mjs"))).described;
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
        refused: ["TypeError", "TypeError", "TypeError"],
        stillLists: true,
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
        const bPath = join(import.meta.dir, "b.mjs");
        let seen = namespaces();
        const createdSince = () => {
          const now = namespaces();
          const created = now - seen;
          seen = now;
          return created;
        };
        const keys = Object.keys(require.cache)
          .filter(key => key.startsWith(import.meta.dir))
          .map(key => key.slice(import.meta.dir.length + 1))
          .sort();
        const has = aPath in require.cache;
        const hasOwn = Object.hasOwn(require.cache, aPath);
        let walked = 0;
        for (const key in require.cache) if (key === aPath) walked++;
        const createdByListing = createdSince();
        // A descriptor holds the entry, so asking for one makes the entry, as reading the key does.
        const { value, ...attributes } = Object.getOwnPropertyDescriptor(require.cache, aPath);
        const createdByDescriptor = createdSince();
        const descriptorHoldsEntry = value === Object.getOwnPropertyDescriptor(require.cache, aPath).value && value === require.cache[aPath];
        const createdByReadingAgain = createdSince();
        const { a } = require.cache[aPath].exports;
        const sameB = require.cache[bPath].exports.b === b;
        const createdByGet = createdSince();
        // The key is now in both tables; it is still listed once.
        const listedAfterGet = Object.keys(require.cache).filter(key => key === aPath).length;
        console.log(JSON.stringify({ b, keys, has, hasOwn, walked, createdByListing, attributes, createdByDescriptor, descriptorHoldsEntry, createdByReadingAgain, a, sameB, createdByGet, listedAfterGet }));
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
        hasOwn: true,
        walked: 1,
        createdByListing: 0,
        attributes: { writable: true, enumerable: true, configurable: true },
        createdByDescriptor: 1,
        descriptorHoldsEntry: true,
        createdByReadingAgain: 0,
        a: 1,
        sameB: true,
        createdByGet: 1,
        listedAfterGet: 1,
      }),
      stderr: "",
      exitCode: 0,
    });
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
