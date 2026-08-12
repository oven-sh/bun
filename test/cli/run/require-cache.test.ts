import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isArm64, isBroken, isIntelMacOS, isWindows, tempDir } from "harness";
import { join } from "path";

// Shared by the "don't leak the output source code" fixtures below.
//
// The leak they guard against (the transpiled source, or the whole module, kept
// alive once per load) is measured as the bytes mimalloc currently has handed
// out, summed over every heap; in release builds JSC allocates through mimalloc
// as well. RSS is not a usable signal for these loops: each load of index.js
// creates a ~2 MB CodeBlock metadata table that is reported to the GC while
// collection is deferred, so whether a collection actually runs between loads
// depends on concurrent JIT timing, and mimalloc keeps pages mapped for a while
// after the blocks in them are freed. Together those moved RSS by 60-500 MB
// between two gc(true) calls with nothing retained (the alpine and macOS CI
// failures of this file), while liveBytes() stayed within 7 MB.
//
// Leaking one copy of index.js's output per load adds at least ~44 MB in the
// smallest fixture (100 KB x 400 loads; the long-export-name fixtures add
// hundreds of MB). The noise floor is one load's worth of compilation state
// that the concurrent JIT thread has not let go of yet when the second
// measurement is taken (it never shows up with BUN_JSC_useConcurrentJIT=0):
// ~3.5 MB on x64 and up to ~6.5 MB on aarch64 in CI.
//
// Whether JSC's allocations are in the heaps the walk sees is a property of the
// WebKit build (ASAN builds and WebKit built without USE_MIMALLOC, e.g. the
// debug prebuilts, use another allocator), so the prelude checks it with a flat
// JS string of 32 MB, the same kind of allocation as a retained source. Where
// that string is invisible the fixture falls back to comparing RSS, at the
// looser bound those builds were already using.
const leakFixturePrelude = `
          const { heapStats } = require("bun:jsc");
          const gc = global.gc || globalThis?.Bun?.gc || (() => {});
          const rss = process.platform === "darwin" && typeof Bun !== "undefined" && typeof Bun.unsafe.memoryFootprint === "function" ? Bun.unsafe.memoryFootprint : process.memoryUsage.rss;
          const MB = 1024 * 1024;
          const maxLiveGrowth = 24 * MB;
          function liveBytes() {
            let bytes = 0;
            for (const heap of heapStats({ dump: true }).mimallocDump.heaps) {
              for (const page of heap.pages) bytes += page.block_size * page.used;
            }
            return bytes;
          }
          const liveBeforeProbe = liveBytes();
          let probe = "a".repeat(32 * MB);
          const walkSeesJSC = liveBytes() - liveBeforeProbe >= maxLiveGrowth;
          probe = undefined;
          function measure() {
            gc(true);
            return { live: liveBytes(), rss: rss() };
          }
`;

function leakFixtureCheck(fallbackRssMB: number) {
  return `
          const after = measure();
          const liveDiff = after.live - baseline.live;
          const rssDiff = after.rss - baseline.rss;
          console.log(
            "live", (baseline.live / MB).toFixed(1), "->", (after.live / MB).toFixed(1), "MB (diff", (liveDiff / MB).toFixed(1), "MB),",
            "RSS diff", (rssDiff / MB) | 0, "MB,",
            walkSeesJSC ? "checking live bytes" : "allocator walk does not see JSC allocations in this build, checking RSS",
          );
          if (walkSeesJSC ? liveDiff > maxLiveGrowth : rssDiff > ${fallbackRssMB} * MB) {
            throw new Error("Memory leak detected");
          }
`;
}

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
          ${leakFixturePrelude}
          const path = require.resolve("./index.js");
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
          const baseline = measure();
          for (let i = 0; i < 500; i++) {
            require(path);
            bust(path);
          }
          ${leakFixtureCheck(400)}
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
          ${leakFixturePrelude}
          const path = require.resolve("./index.js");
          function bust() {
            delete require.cache[path];
          }

          for (let i = 0; i < 100; i++) {
            await import(path);
            bust();
          }
          const baseline = measure();
          for (let i = 0; i < 400; i++) {
            await import(path);
            bust(path);
          }
          ${leakFixtureCheck(320)}
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
          ${leakFixturePrelude}
          const path = require.resolve("./index.js");
          function bust() {
            delete require.cache[path];
          }

          for (let i = 0; i < 50; i++) {
            await import(path);
            bust();
          }
          const baseline = measure();
          for (let i = 0; i < 250; i++) {
            await import(path);
            bust(path);
          }
          ${leakFixtureCheck(320)}
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

    test("via require() with a lot of function calls", async () => {
      let text = "function i() { return 1; }\n";
      for (let i = 0; i < 20000; i++) {
        text += `i();\n`;
      }
      text += "exports.forceCommonJS = true;\n";

      console.log("Text length:", text.length);

      await using dir = tempDir("require-cache-bug-leak-2", {
        "index.js": text,
        "require-cache-bug-leak-fixture.js": `
          ${leakFixturePrelude}
          const path = require.resolve("./index.js");
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
          const baseline = measure();
          for (let i = 0; i < 400; i++) {
            require(path);
            bust(path);
          }
          ${leakFixtureCheck(320)}
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
    }, 60000); // takes 4s on an M1 in release build
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
      isWindows ? 60000 : 30000,
    );
  });
});
