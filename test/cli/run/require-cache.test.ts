import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isBroken, isCI, isIntelMacOS, isMacOS, isWindows, tempDirWithFiles } from "harness";
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
  test("require.cache does not include unevaluated modules", async () => {
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

      const dir = tempDirWithFiles("require-cache-bug-leak-1", {
        "index.js": text,
        "require-cache-bug-leak-fixture.js": `
          const path = require.resolve("./index.js");
          const gc = global.gc || globalThis?.Bun?.gc || (() => {});
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
          const baseline = process.memoryUsage.rss();
          for (let i = 0; i < 500; i++) {
            require(path);
            bust(path);
          }
          gc(true);
          const rss = process.memoryUsage.rss();
          const diff = rss - baseline;
          console.log("RSS diff", (diff / 1024 / 1024) | 0, "MB");
          console.log("RSS", (diff / 1024 / 1024) | 0, "MB");
          if (diff > 100 * 1024 * 1024) {
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

      const dir = tempDirWithFiles("require-cache-bug-leak-3", {
        "index.js": text,
        "require-cache-bug-leak-fixture.js": `
          const path = require.resolve("./index.js");
          const gc = global.gc || globalThis?.Bun?.gc || (() => {});
          function bust() {
            delete require.cache[path];
          }

          for (let i = 0; i < 100; i++) {
            await import(path);
            bust();
          }
          gc(true);
          const baseline = process.memoryUsage.rss();
          for (let i = 0; i < 400; i++) {
            await import(path);
            bust(path);
          }
          gc(true);
          const rss = process.memoryUsage.rss();
          const diff = rss - baseline;
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

      const dir = tempDirWithFiles("require-cache-bug-leak-4", {
        "index.js": text,
        "require-cache-bug-leak-fixture.js": `
          const path = require.resolve("./index.js");
          const gc = global.gc || globalThis?.Bun?.gc || (() => {});
          function bust() {
            delete require.cache[path];
          }

          for (let i = 0; i < 50; i++) {
            await import(path);
            bust();
          }
          gc(true);
          const baseline = process.memoryUsage.rss();
          for (let i = 0; i < 250; i++) {
            await import(path);
            bust(path);
          }
          gc(true);
          const rss = process.memoryUsage.rss();
          const diff = rss - baseline;
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
        env: bunEnv,
        stdio: ["inherit", "inherit", "inherit"],
      });

      const exitCode = await proc.exited;
      expect(exitCode).toBe(0);
    }, 60000);

    test.todoIf(
      // Flaky specifically on macOS CI.
      isBroken && isMacOS && isCI,
    )(
      "via require() with a lot of function calls",
      async () => {
        let text = "function i() { return 1; }\n";
        for (let i = 0; i < 20000; i++) {
          text += `i();\n`;
        }
        text += "exports.forceCommonJS = true;\n";

        console.log("Text length:", text.length);

        const dir = tempDirWithFiles("require-cache-bug-leak-2", {
          "index.js": text,
          "require-cache-bug-leak-fixture.js": `
          const path = require.resolve("./index.js");
          const gc = global.gc || globalThis?.Bun?.gc || (() => {});
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
          const baseline = process.memoryUsage.rss();
          for (let i = 0; i < 400; i++) {
            require(path);
            bust(path);
          }
          gc(true);
          const rss = process.memoryUsage.rss();
          const diff = rss - baseline;
          console.log("RSS diff", (diff / 1024 / 1024) | 0, "MB");
          console.log("RSS", (diff / 1024 / 1024) | 0, "MB");
          if (diff > 64 * 1024 * 1024) {
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
