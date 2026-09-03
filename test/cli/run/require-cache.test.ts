import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isArm64, isASAN, isDebug, isWindows, tempDir } from "harness";
import { basename, join } from "path";

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

  // The leak fixtures measure retained bytes through leak-metric.cjs.
  // ASAN builds read them from the sanitizer allocator, which sees JSC memory
  // only when bmalloc uses system malloc. bmalloc does that by itself when
  // dlsym() finds __asan_init, but src/linker.lds keeps that symbol local, so
  // the fixtures set Malloc=1. Leak detection stays off: with Malloc=1, LSan
  // misreports process-lifetime WTF allocations.
  const leakFixtureEnv = isASAN
    ? { ...bunEnv, Malloc: "1", ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "detect_leaks=0"].filter(Boolean).join(":") }
    : bunEnv;
  const leakMetric = join(import.meta.dir, "leak-metric.cjs");

  // On a build where neither allocator metric sees JSC memory, the helper
  // falls back to RSS. Fail instead, so that no lane goes back to RSS unseen.
  test("the leak fixtures measure live bytes, not RSS", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", `console.log(require(${JSON.stringify(leakMetric)}).metric)`],
      env: leakFixtureEnv,
      stderr: "inherit",
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    expect(stdout.trim()).toBe(isASAN ? "sanitizer allocator" : "mimalloc heaps");
    expect(exitCode).toBe(0);
  });

  // One line per fixture in the log, so that each lane's margin stays visible.
  function logReport(name: string, stdout: string) {
    const lines = stdout.split("\n").filter(line => line.startsWith("cells ") || line.startsWith("leaked "));
    console.log(`${name}: ${lines.join(", ")}`);
  }

  // Every JSC cell type that is created once per module load and owns the
  // module's transpiled source through its SourceCode. After the module is
  // evicted from the cache and collected, none of them may survive per load.
  // A cell that survives means that JS still holds the module. The native
  // leaks that #6790 and #12997 fixed leave no cell. The byte metric checks
  // those.
  const MODULE_CELL_TYPES = [
    "Module", // JSCommonJSModule
    "ModuleRecord",
    "JSSourceCode",
    "ProgramExecutable",
    "ModuleProgramExecutable",
    "FunctionExecutable",
    "UnlinkedProgramCodeBlock",
    "UnlinkedModuleProgramCodeBlock",
  ];

  // Workload per build. bun 1.1.21 retained 0.6 to 1.6 MB per load here, and
  // the allocator metrics are exact to a few MB, so 50 loads stand out. ASAN
  // builds run about 3x slower than release. Debug builds are 10x slower
  // still and only need to run the code.
  const workload = isDebug
    ? { exports: 2000, calls: 5000, warmup: 3, loads: 10 }
    : isASAN
      ? { exports: 10000, calls: 20000, warmup: 5, loads: 50 }
      : { exports: 10000, calls: 20000, warmup: 10, loads: 100 };

  // A fixture that loads ./index.js with `load`, evicting it each time, and
  // reports the live cells of each type in MODULE_CELL_TYPES and the bytes
  // retained per load. Pass esm: true for a top-level-await fixture.
  function leakFixture({ load, esm, limitBytesPerLoad }: { load: string; esm: boolean; limitBytesPerLoad: number }) {
    return `
      const memory = require(${JSON.stringify(leakMetric)});
      const { heapStats } = require("bun:jsc");
      const path = require.resolve("./index.js");
      const types = ${JSON.stringify(MODULE_CELL_TYPES)};
      ${
        esm
          ? ""
          : // require() appends every new Module to the parent's children list, as
            // in Node. That list is not the leak under test.
            "module.children = { indexOf: () => 0 };"
      }

      function liveCells() {
        Bun.gc(true);
        const { objectTypeCounts } = heapStats();
        return Object.fromEntries(types.map(type => [type, objectTypeCounts[type] ?? 0]));
      }

      ${esm ? "async " : ""}function load() {
        ${load}
        delete require.cache[path];
      }

      for (let i = 0; i < ${workload.warmup}; i++) ${esm ? "await " : ""}load();
      const cellsBefore = liveCells();
      const bytesBefore = memory.measure();
      for (let i = 0; i < ${workload.loads}; i++) ${esm ? "await " : ""}load();
      const cellsAfter = liveCells();
      const bytesAfter = memory.measure();

      console.log("cells", JSON.stringify(Object.fromEntries(types.map(type => [type, cellsAfter[type] - cellsBefore[type]]))));
      memory.report(bytesAfter - bytesBefore, { count: ${workload.loads}, limitBytesPerIteration: ${limitBytesPerLoad} });
      ${esm ? "export {};" : ""}
    `;
  }

  async function expectNoLeak(dir: string) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", "--smol", join(dir, "leak-fixture.js")],
      env: leakFixtureEnv,
      stderr: "inherit",
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    logReport(basename(dir), stdout);
    expect(stdout.trim()).toEndWith("--pass--");
    const cells = stdout.split("\n").find(line => line.startsWith("cells "))!;
    const survived: Record<string, number> = JSON.parse(cells.slice("cells ".length));
    expect(Object.keys(survived).sort()).toEqual([...MODULE_CELL_TYPES].sort());
    // A leak is one or more cells per load. A couple of cells of slack covers
    // a lazily created executable that was not there at the baseline.
    const leaked = Object.fromEntries(Object.entries(survived).filter(([, count]) => count > 2));
    expect(leaked).toEqual({});
    expect(exitCode).toBe(0);
  }

  describe("files transpiled and loaded don't leak the output source code", () => {
    test("via require() with a lot of long export names", async () => {
      let text = "";
      for (let i = 0; i < workload.exports; i++) {
        text += `exports.superDuperExtraCrazyLongNameWowSuchNameLongYouveNeverSeenANameThisLongForACommonJSModuleExport${i} = 1;\n`;
      }

      using dir = tempDir("require-cache-bug-leak-1", {
        "index.js": text,
        "leak-fixture.js": leakFixture({ load: "require(path);", esm: false, limitBytesPerLoad: 200 * 1024 }),
      });
      await expectNoLeak(String(dir));
    }, 60000);

    test("via await import() with a lot of function calls", async () => {
      let text = "function i() { return 1; }\n";
      for (let i = 0; i < workload.calls; i++) {
        text += `i();\n`;
      }
      text += "exports.forceCommonJS = true;\n";

      using dir = tempDir("require-cache-bug-leak-3", {
        "index.js": text,
        "leak-fixture.js": leakFixture({ load: "await import(path);", esm: true, limitBytesPerLoad: 160 * 1024 }),
      });
      await expectNoLeak(String(dir));
    }, 60000);

    test("via import() with a lot of long export names", async () => {
      let text = "";
      for (let i = 0; i < workload.exports; i++) {
        text += `export const superDuperExtraCrazyLongNameWowSuchNameLongYouveNeverSeenANameThisLongForACommonJSModuleExport${i} = 1;\n`;
      }

      using dir = tempDir("require-cache-bug-leak-4", {
        "index.js": text,
        "leak-fixture.js": leakFixture({ load: "await import(path);", esm: true, limitBytesPerLoad: 256 * 1024 }),
      });
      await expectNoLeak(String(dir));
    }, 60000);

    test("via require() with a lot of function calls", async () => {
      let text = "function i() { return 1; }\n";
      for (let i = 0; i < workload.calls; i++) {
        text += `i();\n`;
      }
      text += "exports.forceCommonJS = true;\n";

      using dir = tempDir("require-cache-bug-leak-2", {
        "index.js": text,
        "leak-fixture.js": leakFixture({ load: "require(path);", esm: false, limitBytesPerLoad: 160 * 1024 }),
      });
      await expectNoLeak(String(dir));
    }, 60000);
  });

  async function expectFixtureToPass(fixture: string, ...flags: string[]) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), ...flags, "run", join(import.meta.dir, fixture)],
      env: leakFixtureEnv,
      stderr: "inherit",
    });

    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    logReport(fixture, stdout);

    expect(stdout.trim()).toEndWith("--pass--");
    expect(exitCode).toBe(0);
  }

  describe("files transpiled and loaded don't leak the AST", () => {
    test("via require()", async () => {
      await expectFixtureToPass("require-cache-bug-leak-fixture.js");
    }, 20000);

    test("via import()", async () => {
      await expectFixtureToPass("esm-bug-leak-fixture.mjs");
    }, 20000);
  });

  describe("files transpiled and loaded don't leak file paths", () => {
    test("via require()", async () => {
      await expectFixtureToPass("cjs-fixture-leak-small.js", "--smol");
    }, 30000);

    test(
      "via import()",
      async () => {
        await expectFixtureToPass("esm-fixture-leak-small.mjs", "--smol");
      },
      // Windows and ASAN builds run the 40k imports more slowly.
      isWindows || isASAN ? 60000 : 30000,
    );
  });
});
