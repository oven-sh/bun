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
          const rss = process.platform === "darwin" && typeof Bun !== "undefined" && typeof Bun.unsafe.memoryFootprint === "function" ? Bun.unsafe.memoryFootprint : process.memoryUsage.rss;
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
          const rss = process.platform === "darwin" && typeof Bun !== "undefined" && typeof Bun.unsafe.memoryFootprint === "function" ? Bun.unsafe.memoryFootprint : process.memoryUsage.rss;
          function bust() {
            delete require.cache[path];
          }

          for (let i = 0; i < 100; i++) {
            await import(path);
            bust();
          }
          gc(true);
          const baseline = rss();
          for (let i = 0; i < 400; i++) {
            await import(path);
            bust(path);
          }
          gc(true);
          const after = rss();
          const diff = after - baseline;
          console.log("RSS diff", (diff / 1024 / 1024) | 0, "MB");
          console.log("RSS", (diff / 1024 / 1024) | 0, "MB");
          if (diff > ${isASAN ? 320 : 64} * 1024 * 1024) {
            // Bun v1.1.22 reported 1 MB here on macoS arm64.
            // Bun v1.1.21 reported 257 MB here on macoS arm64.
            throw new Error("Memory leak detected");
          }

          export default 123;
        `,
      });
      await using proc = Bun.spawn({
        cmd: [bunExe(), "run", "--smol", join(dir, "require-cache-bug-leak-fixture.js")],
        env: bunEnv,
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
          const rss = process.platform === "darwin" && typeof Bun !== "undefined" && typeof Bun.unsafe.memoryFootprint === "function" ? Bun.unsafe.memoryFootprint : process.memoryUsage.rss;
          function bust() {
            delete require.cache[path];
          }

          for (let i = 0; i < 50; i++) {
            await import(path);
            bust();
          }
          gc(true);
          const baseline = rss();
          for (let i = 0; i < 250; i++) {
            await import(path);
            bust(path);
          }
          gc(true);
          const after = rss();
          const diff = after - baseline;
          console.log("RSS diff", (diff / 1024 / 1024) | 0, "MB");
          console.log("RSS", (diff / 1024 / 1024) | 0, "MB");
          if (diff > ${isASAN ? 320 : 64} * 1024 * 1024) {
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
        env: bunEnv,
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
          const rss = process.platform === "darwin" && typeof Bun !== "undefined" && typeof Bun.unsafe.memoryFootprint === "function" ? Bun.unsafe.memoryFootprint : process.memoryUsage.rss;
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
