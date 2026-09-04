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

  // A module's source text is native memory that is only released by the GC (the
  // SourceProvider dies with the executables that reference it). The loader reports
  // that memory to JSC, so loading modules counts as GC pressure like any other string
  // allocation. The fixtures below check that on a fresh VM, where the only thing
  // that can trigger a collection is the loads themselves.
  describe("module source text is reported to the GC", () => {
    // Every fixture module is one big string literal, so the transpiled output is at
    // least LITERAL_LENGTH bytes while evaluating it allocates a few hundred bytes on
    // the JS heap: without the report, nothing about these loads is visible to the GC.
    const LITERAL_LENGTH = 1024 * 1024;
    const literal = Buffer.alloc(LITERAL_LENGTH, "a").toString();
    const modules = {
      "cjs.js": `const big = "${literal}";\nmodule.exports = big.length;\n`,
      "esm.mjs": `const big = "${literal}";\nexport default big.length;\n`,
      // The same modules as `bun build --target=bun` emits them: the "// @bun" pragma
      // makes the loader hand the file to JSC as-is, which is much cheaper than
      // transpiling 1 MB per iteration of the loop below, and covers that loader path.
      "prebuilt-cjs.js": `// @bun @bun-cjs\n(function(exports, require, module, __filename, __dirname) {const big = "${literal}";\nmodule.exports = big.length;\n})`,
      "prebuilt-esm.mjs": `// @bun\nconst big = "${literal}";\nexport default big.length;\n`,
    };

    async function runFixture(name: string, fixture: string) {
      await using dir = tempDir(name, { ...modules, "report-source-fixture.js": fixture });
      await using proc = Bun.spawn({
        cmd: [bunExe(), "run", join(String(dir), "report-source-fixture.js")],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      expect(exitCode).toBe(0);
      return JSON.parse(stdout);
    }

    // process.memoryUsage().external is JSC's extra memory counter, which is what the
    // loader reports into. It only goes down on a full collection, and one load is far
    // below the budget that would request one, so the growth is what the load reported.
    // The fixtures print the growth per module; this turns it into a per-module verdict.
    function reportedBytes(growthByModule: Record<string, number>) {
      return Object.fromEntries(
        Object.entries(growthByModule).map(([file, growth]) => [
          file,
          growth >= LITERAL_LENGTH ? "reported" : `reported only ${growth} bytes for a ${LITERAL_LENGTH} byte literal`,
        ]),
      );
    }

    test("require() reports the size of the module's source", async () => {
      const growth = await runFixture(
        "require-cache-report-source-cjs",
        `
          const growth = {};
          for (const file of ["./cjs.js", "./prebuilt-cjs.js"]) {
            Bun.gc(true);
            const before = process.memoryUsage().external;
            require(file);
            growth[file] = process.memoryUsage().external - before;
          }
          console.log(JSON.stringify(growth));
        `,
      );
      expect(reportedBytes(growth)).toEqual({ "./cjs.js": "reported", "./prebuilt-cjs.js": "reported" });
    });

    test("import() reports the size of the module's source", async () => {
      const growth = await runFixture(
        "require-cache-report-source-esm",
        `
          (async () => {
            const growth = {};
            for (const file of ["./esm.mjs", "./prebuilt-esm.mjs"]) {
              Bun.gc(true);
              const before = process.memoryUsage().external;
              await import(file);
              growth[file] = process.memoryUsage().external - before;
            }
            console.log(JSON.stringify(growth));
          })();
        `,
      );
      expect(reportedBytes(growth)).toEqual({ "./esm.mjs": "reported", "./prebuilt-esm.mjs": "reported" });
    });

    // The scenario the report exists for: a synchronous loop that loads a module and drops
    // it again. Nothing runs between iterations (no event loop turn, so no GC timer), so a
    // collection during the loop can only be requested by the loads themselves. Without
    // the report none is, and every iteration's Module object (and the source copy behind
    // it) is still alive at the end. With it, JSC collects every few MB of loaded source,
    // so at most the last few iterations are.
    test("a synchronous require() + delete require.cache loop triggers collections", async () => {
      const LOADS = 32;
      const result = await runFixture(
        "require-cache-report-source-loop",
        `
          const { heapStats } = require("bun:jsc");
          const file = require.resolve("./prebuilt-cjs.js");
          const liveModules = () => heapStats().objectTypeCounts.Module;
          function load() {
            require(file);
            delete require.cache[file];
            module.children.length = 0;
          }

          Bun.gc(true);
          const baseline = liveModules();
          load();
          // A single load stays below the GC budget, so the counter must see exactly that module.
          const afterOneLoad = liveModules() - baseline;
          for (let i = 1; i < ${LOADS}; i++) load();
          const afterLoop = liveModules() - baseline;
          console.log(JSON.stringify({ afterOneLoad, afterLoop }));
        `,
      );
      expect(result).toEqual({ afterOneLoad: 1, afterLoop: expect.any(Number) });
      // Collections are requested every ~8 MB of loaded source (the eden budget), so this
      // is around 6 on any build; without the report it is exactly LOADS.
      expect(result.afterLoop).toBeLessThanOrEqual(LOADS / 2);
    });
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
