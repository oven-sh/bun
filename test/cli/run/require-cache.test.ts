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

  // A module that its importer left behind is not loading: the importer's graph
  // load failed, or its link failed, or a sibling threw while it evaluated. The
  // dependency fetched fine and never evaluated. `delete require.cache[dep]`
  // must evict it, or the next import() of the importer keeps linking the
  // stale record for the life of the process (#48004).
  describe("delete require.cache[esm] of a module that its importer left unevaluated", () => {
    // Writes entry.mjs, bad.mjs and dep.mjs, then loads entry three times: good,
    // broken (`breakStep2`), fixed. Step 3 must see the fixed dep.mjs.
    const reloader = (breakStep2: string, load: string) => `
      const { writeFileSync } = require("node:fs");
      const { join } = require("node:path");
      const entry = join(__dirname, "entry.mjs");
      const dep = join(__dirname, "dep.mjs");
      const bad = join(__dirname, "bad.mjs");
      const result = {};
      const load = async step => {
        delete require.cache[entry];
        delete require.cache[dep];
        delete require.cache[bad];
        try {
          result[step] = ${load};
        } catch (err) {
          result[step] = "error: " + err.message;
        }
      };
      const good = 'import "./bad.mjs";\\nimport { value } from "./dep.mjs";\\nexport default value;\\n';
      (async () => {
        writeFileSync(entry, good);
        writeFileSync(bad, "export const ok = 1;\\n");
        writeFileSync(dep, "export const value = 1;\\n");
        await load(1);
        writeFileSync(dep, "export const value = 2;\\n");
        ${breakStep2}
        await load(2);
        writeFileSync(entry, good);
        writeFileSync(bad, "export const ok = 3;\\n");
        writeFileSync(dep, "export const value = 3;\\n");
        await load(3);
        result.depInCache = dep in require.cache;
        console.log(JSON.stringify(result));
      })();
    `;
    const viaImport = "(await import(entry)).default";
    const viaRequire = "require(entry).default";
    const linkFails = `writeFileSync(dep, "export const renamed = 2;\\n");`;
    const loadFails = `writeFileSync(entry, 'import { value } from "./dep.mjs";\\nimport "./missing.mjs";\\nexport default value;\\n');`;
    const siblingThrows = `writeFileSync(bad, "throw new Error('boom');\\n");`;
    const linkError = (dir: string) =>
      "error: Export named 'value' not found in module '" + join(dir, "dep.mjs") + "'.";
    const loadError = (dir: string) =>
      "error: Cannot find module './missing.mjs' imported from " + join(dir, "entry.mjs");

    async function run(dir: string, env = bunEnv) {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "reload.cjs"],
        env,
        cwd: dir,
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      return { stdout, stderr, exitCode };
    }

    test("the importer failed to link", async () => {
      using dir = tempDir("require-cache-delete-unlinked", { "reload.cjs": reloader(linkFails, viaImport) });
      const { stdout, stderr, exitCode } = await run(String(dir));
      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toEqual({ 1: 1, 2: linkError(String(dir)), 3: 3, depInCache: true });
      expect(exitCode).toBe(0);
    });

    test("the importer failed to link, via require()", async () => {
      using dir = tempDir("require-cache-delete-unlinked-require", { "reload.cjs": reloader(linkFails, viaRequire) });
      const { stdout, stderr, exitCode } = await run(String(dir));
      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toEqual({ 1: 1, 2: linkError(String(dir)), 3: 3, depInCache: true });
      expect(exitCode).toBe(0);
    });

    // The failed load leaves dep.mjs's transpile on the thread pool, so dep.mjs
    // is still fetching when step 3 deletes it, and the delete is a no-op. The
    // synchronous transpiler settles the fetch before the load fails.
    test("the importer failed to load its other imports", async () => {
      using dir = tempDir("require-cache-delete-unloaded", { "reload.cjs": reloader(loadFails, viaImport) });
      const { stdout, stderr, exitCode } = await run(String(dir), {
        ...bunEnv,
        BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER: "1",
      });
      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toEqual({ 1: 1, 2: loadError(String(dir)), 3: 3, depInCache: true });
      expect(exitCode).toBe(0);
    });

    test("the importer failed to load its other imports, via require()", async () => {
      using dir = tempDir("require-cache-delete-unloaded-require", { "reload.cjs": reloader(loadFails, viaRequire) });
      const { stdout, stderr, exitCode } = await run(String(dir));
      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toEqual({ 1: 1, 2: loadError(String(dir)), 3: 3, depInCache: true });
      expect(exitCode).toBe(0);
    });

    test("a sibling import threw while it evaluated", async () => {
      using dir = tempDir("require-cache-delete-linked", { "reload.cjs": reloader(siblingThrows, viaImport) });
      const { stdout, stderr, exitCode } = await run(String(dir));
      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toEqual({ 1: 1, 2: "error: boom", 3: 3, depInCache: true });
      expect(exitCode).toBe(0);
    });

    test("a sibling import threw while it evaluated, via require()", async () => {
      using dir = tempDir("require-cache-delete-linked-require", { "reload.cjs": reloader(siblingThrows, viaRequire) });
      const { stdout, stderr, exitCode } = await run(String(dir));
      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toEqual({ 1: 1, 2: "error: boom", 3: 3, depInCache: true });
      expect(exitCode).toBe(0);
    });

    async function runMain(dir: string, env = bunEnv) {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "main.mjs"],
        env,
        cwd: dir,
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      expect(exitCode).toBe(0);
      return JSON.parse(stdout);
    }

    // The dependency has loaded, but the importer's load waits for a sibling.
    // The delete is honoured: the importer keeps the record it loaded, and any
    // later request for the key, from the sibling or from a later import(),
    // loads the file again.
    test("a loaded dependency of a load that is still pending is evicted", async () => {
      using dir = tempDir("require-cache-delete-pending-importer", {
        "main.mjs": `
          import { writeFileSync } from "node:fs";
          import { createRequire } from "node:module";
          import { join } from "node:path";
          const cache = createRequire(import.meta.url).cache;
          globalThis.__result = { evaluated: 0 };
          const { promise: gate, resolve: release } = Promise.withResolvers();
          const { promise: reached, resolve: markReached } = Promise.withResolvers();
          Bun.plugin({
            name: "slow",
            setup(build) {
              build.onLoad({ filter: /slow\\.mjs$/ }, async () => {
                markReached();
                await gate;
                return { contents: 'import { value } from "./dep.mjs";\\nexport const slow = value;', loader: "js" };
              });
            },
          });
          const dep = join(import.meta.dir, "dep.mjs");
          const entry = import("./entry.mjs");
          // dep.mjs was requested before slow.mjs. One turn settles its load.
          await reached;
          await new Promise(resolve => setImmediate(resolve));
          delete cache[dep];
          writeFileSync(dep, "globalThis.__result.evaluated++;\\nexport const value = 2;\\n");
          release();
          const ns = await entry;
          globalThis.__result.entry = ns.default;
          globalThis.__result.slow = ns.slow;
          globalThis.__result.dep = (await import("./dep.mjs")).value;
          console.log(JSON.stringify(globalThis.__result));
        `,
        "entry.mjs": `
          import { value } from "./dep.mjs";
          import { slow } from "./slow.mjs";
          export default value;
          export { slow };
        `,
        "dep.mjs": `
          globalThis.__result.evaluated++;
          export const value = 1;
        `,
        "slow.mjs": ``,
      });
      const result = await runMain(String(dir), { ...bunEnv, BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER: "1" });
      expect(result).toEqual({ evaluated: 2, entry: 1, slow: 2, dep: 2 });
    });

    // entry.mjs is evaluating when deleter.mjs runs, and dep.mjs is linked but
    // has yet to run. The delete is honoured: entry.mjs runs the record it
    // linked, the next import() loads the file again.
    test("a linked sibling deleted while another sibling's top level runs is evicted", async () => {
      using dir = tempDir("require-cache-delete-linked-sibling", {
        "main.mjs": `
          import { writeFileSync } from "node:fs";
          import { join } from "node:path";
          globalThis.__result = { evaluated: 0 };
          globalThis.__result.entry = (await import("./entry.mjs")).default;
          writeFileSync(join(import.meta.dir, "dep.mjs"), "globalThis.__result.evaluated++;\\nexport const value = 2;\\n");
          globalThis.__result.dep = (await import("./dep.mjs")).value;
          console.log(JSON.stringify(globalThis.__result));
        `,
        "entry.mjs": `
          import "./deleter.mjs";
          import { value } from "./dep.mjs";
          export default value;
        `,
        "deleter.mjs": `
          import { createRequire } from "node:module";
          const require = createRequire(import.meta.url);
          delete require.cache[require.resolve("./dep.mjs")];
        `,
        "dep.mjs": `
          globalThis.__result.evaluated++;
          export const value = 1;
        `,
      });
      expect(await runMain(String(dir))).toEqual({ evaluated: 2, entry: 1, dep: 2 });
    });

    // The key is registered twice: evaluated as JavaScript, and fetching as text
    // for importer.mjs. The delete takes both, so it is a no-op while either is
    // in flight: importer2.mjs joins the fetch instead of starting its own.
    test("a key whose other import type is still loading stays", async () => {
      using dir = tempDir("require-cache-delete-typed-variant", {
        "main.mjs": `
          import { createRequire } from "node:module";
          import { join } from "node:path";
          import "./a.mjs";
          const cache = createRequire(import.meta.url).cache;
          const result = { onLoadCalls: 0 };
          const { promise: gate, resolve: release } = Promise.withResolvers();
          const { promise: reached, resolve: markReached } = Promise.withResolvers();
          Bun.plugin({
            name: "slow text",
            setup(build) {
              build.onLoad({ filter: /a\\.mjs$/ }, async () => {
                result.onLoadCalls++;
                markReached();
                await gate;
                return { contents: "text " + result.onLoadCalls, loader: "text" };
              });
            },
          });
          const importer = import("./importer.mjs");
          await reached;
          delete cache[join(import.meta.dir, "a.mjs")];
          const importer2 = import("./importer2.mjs");
          release();
          result.importer = (await importer).default;
          result.importer2 = (await importer2).default;
          console.log(JSON.stringify(result));
        `,
        "a.mjs": `export const a = 1;`,
        "importer.mjs": `import text from "./a.mjs" with { type: "text" }; export default text;`,
        "importer2.mjs": `import text from "./a.mjs" with { type: "text" }; export default text;`,
      });
      expect(await runMain(String(dir))).toEqual({ onLoadCalls: 1, importer: "text 1", importer2: "text 1" });
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
