import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// Coverage for the WebKit 47f7250137c6 sync. The RegExp case pins a behavior
// that only the new WebKit has; the import attribute cases pin the fork-side
// resolution of upstream's new ScriptFetchParameters::Type::Text (with
// BUN_JSC_ADDITIONS `type: "text"` must stay a host-defined import type, on
// both the JSC ModuleAnalyzer path and the BunTranspiledModule path).

describe.concurrent("WebKit 47f7250137c6 upgrade", () => {
  test("Iterator.prototype.chunks / windows / join and Iterator.zip / zipKeyed are enabled by default (webkit.org/b/321272)", () => {
    expect([1, 2, 3, 4, 5].values().chunks(2).toArray()).toEqual([[1, 2], [3, 4], [5]]);
    expect([1, 2, 3].values().windows(2).toArray()).toEqual([
      [1, 2],
      [2, 3],
    ]);
    expect(["a", undefined, "c"].values().join("-")).toBe("a--c");
    expect(
      Iterator.zip([
        [1, 2],
        ["a", "b"],
      ]).toArray(),
    ).toEqual([
      [1, "a"],
      [2, "b"],
    ]);
    expect(Iterator.zipKeyed({ n: [1, 2], s: ["a", "b"] }).toArray()).toEqual([
      { n: 1, s: "a" },
      { n: 2, s: "b" },
    ]);
    // Spec alignment that came with the flag flip: a non-integral size throws instead of being coerced.
    expect(() => [1].values().chunks("2" as any)).toThrow(TypeError);
  });

  test("intl-era-monthcode: the calendar list is the proposal's fixed set, islamic / islamic-rgsa are gone (webkit.org/b/319855)", () => {
    expect(Intl.supportedValuesOf("calendar")).toEqual([
      "buddhist",
      "chinese",
      "coptic",
      "dangi",
      "ethioaa",
      "ethiopic",
      "gregory",
      "hebrew",
      "indian",
      "islamic-civil",
      "islamic-tbla",
      "islamic-umalqura",
      "iso8601",
      "japanese",
      "persian",
      "roc",
    ]);
    expect(() => Temporal.PlainDate.from({ year: 2024, month: 1, day: 1, calendar: "islamic" })).toThrow(RangeError);
    expect(Temporal.PlainDate.from({ year: 2024, month: 1, day: 1, calendar: "islamic-civil" }).calendarId).toBe(
      "islamic-civil",
    );
  });

  test("NUMBER_OF_PROCESSORS does not change the reported core count", async () => {
    // Upstream WTF::numberOfProcessorCores() started honoring this variable; the fork keeps that out of
    // Bun builds because navigator.hardwareConcurrency / os.availableParallelism() are derived from it.
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-p", `navigator.hardwareConcurrency + " " + require("os").availableParallelism()`],
      env: { ...bunEnv, NUMBER_OF_PROCESSORS: "1234" },
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    const [hardwareConcurrency, availableParallelism] = stdout.trim().split(" ").map(Number);
    expect(hardwareConcurrency).toBeGreaterThan(0);
    expect(hardwareConcurrency).not.toBe(1234);
    expect(availableParallelism).not.toBe(1234);
    expect(exitCode).toBe(0);
  });

  test("v-mode && / -- apply to class strings when the operand is an inverted property escape (webkit.org/b/321252)", () => {
    // The complement has no strings, so an intersection must drop the strings
    // accumulated on the left and a subtraction must keep them.
    expect(/^[\q{ab|c|1}&&\P{L}]$/v.test("ab")).toBe(false);
    expect(/^[\q{ab|c|1}&&\P{L}]$/v.test("c")).toBe(false);
    expect(/^[\q{ab|c|1}&&\P{L}]$/v.test("1")).toBe(true);
    expect(/^[\q{ab|c|1}--\P{L}]$/v.test("ab")).toBe(true);
    expect(/^[\q{ab|c|1}--\P{L}]$/v.test("c")).toBe(true);
    expect(/^[\q{ab|c|1}--\P{L}]$/v.test("1")).toBe(false);
    expect(/^[\p{L}&&\P{Lu}]$/v.test("A")).toBe(false);
    expect(/^[\p{L}&&\P{Lu}]$/v.test("a")).toBe(true);
  });

  test('import ... with { type: "text" } of a .js file still returns its source', async () => {
    using dir = tempDir("wk-text-attr", {
      "mod.js": `export default "evaluated";`,
      "entry.mjs": `
        import source from "./mod.js" with { type: "text" };
        import evaluated from "./mod.js";
        process.stdout.write(JSON.stringify({ source, evaluated }));
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "entry.mjs"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({ source: `export default "evaluated";`, evaluated: "evaluated" });
    expect(exitCode).toBe(0);
  });

  test('import ... with { type: "text" } of a .js file under bun test --isolate', async () => {
    // --isolate takes the BunTranspiledModule path, where Bun's transpiler
    // emits the ScriptFetchParameters::Type ordinal itself (HostDefined moved
    // behind upstream's new Text member). In debug builds a wrong ordinal fails
    // the record comparison with "Imports different"; in release the import
    // would not resolve.
    using dir = tempDir("wk-text-attr-isolate", {
      "mod.js": `export default "evaluated";`,
      "text.test.ts": `
        import source from "./mod.js" with { type: "text" };
        import evaluated from "./mod.js";
        import { test, expect } from "bun:test";
        test("text attribute", () => {
          expect(source).toBe('export default "evaluated";');
          expect(evaluated).toBe("evaluated");
        });
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "--isolate", "text.test.ts"],
      env: { ...bunEnv, BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0" },
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });
    const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toContain("1 pass");
    expect(stderr).not.toContain("Imports different");
    expect(exitCode).toBe(0);
  });
});
