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

  // `delete require.cache[path]` removes the module's ES module registry entry.
  // It can run while an import() of that module is still loading: here the
  // module's dependency is held back by an async onLoad plugin until the test
  // opens a gate. The in-flight load must finish with the module it started to
  // load, and must not put that module back into the loader's import cache, or
  // the next import() of the path answers from a record whose registry entry is
  // gone (null loadPromise, crash in JSModuleLoader::loadModule).
  describe("delete require.cache[esm] while an import() of it is in flight", () => {
    // Every load of entry.mjs gets its own `load` number. Only the first load
    // imports dep.mjs, whose onLoad waits for the gate.
    const fixture = (scenario: string) => ({
      "entry.mjs": "",
      "dep.mjs": "",
      "main.mjs": `
        const gate = Promise.withResolvers();
        const depLoadStarted = Promise.withResolvers();
        let loads = 0;
        Bun.plugin({
          name: "gate",
          setup(build) {
            build.onLoad({ filter: /entry\\.mjs$/ }, () => {
              const load = ++loads;
              return {
                loader: "js",
                contents: load === 1 ? 'import "./dep.mjs"; export const load = 1;' : \`export const load = \${load};\`,
              };
            });
            build.onLoad({ filter: /dep\\.mjs$/ }, async () => {
              depLoadStarted.resolve();
              await gate.promise;
              return { loader: "js", contents: "" };
            });
          },
        });
        const entryPath = require.resolve("./entry.mjs");
        const result = {};

        const first = import("./entry.mjs");
        await depLoadStarted.promise;
        delete require.cache[entryPath];
        ${scenario}

        console.log(JSON.stringify(result));
      `,
    });

    async function run(dir: string) {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "run", "main.mjs"],
        env: bunEnv,
        cwd: dir,
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      return { stdout: stdout.trim(), stderr, exitCode };
    }

    test("the next import() loads the file again", async () => {
      using dir = tempDir(
        "require-cache-delete-in-flight",
        fixture(`
          gate.resolve();
          const firstNamespace = await first;
          const secondNamespace = await import("./entry.mjs");
          result.loads = [firstNamespace.load, secondNamespace.load];
        `),
      );

      expect(await run(String(dir))).toEqual({ stdout: JSON.stringify({ loads: [1, 2] }), stderr: "", exitCode: 0 });
    });

    test("a load that finishes after the replacement load does not replace it", async () => {
      using dir = tempDir(
        "require-cache-delete-in-flight-replaced",
        fixture(`
          const secondNamespace = await import("./entry.mjs");
          gate.resolve();
          const firstNamespace = await first;
          const thirdNamespace = await import("./entry.mjs");
          result.loads = [firstNamespace.load, secondNamespace.load, thirdNamespace.load];
          result.thirdIsSecond = thirdNamespace === secondNamespace;
        `),
      );

      expect(await run(String(dir))).toEqual({
        stdout: JSON.stringify({ loads: [1, 2, 2], thirdIsSecond: true }),
        stderr: "",
        exitCode: 0,
      });
    });
  });

  // The loader's import cache is keyed by the specifier import() was resolved
  // to, and the registry by what that key resolves to once more. An onResolve
  // plugin that redirects a.mjs -> b.mjs -> c.mjs -> d.mjs makes those differ,
  // so `delete require.cache[d]` removes the registry entry but leaves the
  // cache line for a.mjs behind. The next import("./a.mjs") must notice that
  // the line no longer matches the registry and load again, instead of using
  // the registry entry the line points at (missing: crash at address 0x38, or
  // a different module: the stale instance).
  describe("delete require.cache[esm] whose import() was resolved through a chain", () => {
    const fixture = (scenario: string) => ({
      "a.mjs": `export const name = "a";`,
      "b.mjs": `export const name = "b";`,
      "c.mjs": `export const name = "c";`,
      "d.mjs": `export const name = "d";`,
      "main.mjs": `
        import { basename, join } from "node:path";
        const next = { "a.mjs": "b.mjs", "b.mjs": "c.mjs", "c.mjs": "d.mjs" };
        Bun.plugin({
          name: "chain",
          setup(build) {
            build.onResolve({ filter: /\\.mjs$/ }, ({ path }) => {
              const to = next[basename(path)];
              return to && { path: join(import.meta.dir, to) };
            });
          },
        });
        const result = {};

        const first = await import("./a.mjs");
        result.first = first.name;
        delete require.cache[join(import.meta.dir, "d.mjs")];
        ${scenario}

        console.log(JSON.stringify(result));
      `,
    });

    async function run(dir: string) {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "run", "main.mjs"],
        env: bunEnv,
        cwd: dir,
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      return { stdout: stdout.trim(), stderr, exitCode };
    }

    test("the next import() loads the file again", async () => {
      using dir = tempDir(
        "require-cache-delete-resolve-chain",
        fixture(`
          const second = await import("./a.mjs");
          result.second = second.name;
          result.secondIsFirst = second === first;
        `),
      );

      expect(await run(String(dir))).toEqual({
        stdout: JSON.stringify({ first: "d", second: "d", secondIsFirst: false }),
        stderr: "",
        exitCode: 0,
      });
    });

    test("the next import() returns the module that replaced it", async () => {
      using dir = tempDir(
        "require-cache-delete-resolve-chain-replaced",
        fixture(`
          const replacement = await import("./d.mjs");
          result.replacementIsFirst = replacement === first;
          const second = await import("./a.mjs");
          result.secondIsReplacement = second === replacement;
        `),
      );

      expect(await run(String(dir))).toEqual({
        stdout: JSON.stringify({ first: "d", replacementIsFirst: false, secondIsReplacement: true }),
        stderr: "",
        exitCode: 0,
      });
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
      isWindows ? 60000 : 30000,
    );
  });
});
