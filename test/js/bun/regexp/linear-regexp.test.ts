import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isDebug, tempDir } from "harness";
import path from "node:path";

// --experimental-linear-regexp and BUN_FEATURE_FLAG_EXPERIMENTAL_LINEAR_REGEXP=1 make JavaScriptCore
// run a RegExp on a matcher that does not backtrack, when that matcher accepts its pattern. A
// pattern it refuses is compiled and run as it is without the switch.
//
// No test here reads a clock. The matcher counts the instructions it runs, and
// `jscInternals.regExpMatchStatistics` reports that count and the most the count can be, so
// "linear" is asserted on numbers.

const flag = "--experimental-linear-regexp";
const variable = "BUN_FEATURE_FLAG_EXPERIMENTAL_LINEAR_REGEXP";
// Two fixtures: the reports that read the statistics of a match, and the ones that start a Worker,
// a child process or a build.
const statisticsFixture = path.join(import.meta.dir, "linear-regexp-fixture.ts");
const routesFixture = path.join(import.meta.dir, "linear-regexp-routes-fixture.ts");
const inRoutesFixture = new Set(["routes", "fork", "pluginFilter", "limits", "workerExecArgv"]);

// What the matcher accepts depends on these two JavaScriptCore options. The tests name their
// values, so that a change of a default is not a change of what is tested.
const maximumProgramSize = 65536;
const maximumWorkingMemory = 8 * 1024 * 1024;

type Switch = { flag?: boolean; command?: string[]; env?: Record<string, string> };

async function report(name: string, { flag: withFlag = false, command = [], env = {} }: Switch = {}) {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      ...command,
      ...(withFlag ? [flag] : []),
      inRoutesFixture.has(name) ? routesFixture : statisticsFixture,
      name,
    ],
    env: {
      ...bunEnv,
      [variable]: undefined,
      BUN_OPTIONS: undefined,
      BUN_JSC_maximumRegExpLinearProgramSize: String(maximumProgramSize),
      BUN_JSC_maximumRegExpLinearWorkingMemory: String(maximumWorkingMemory),
      ...env,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
  return JSON.parse(stdout);
}

// Each test starts one or two processes. A debug build takes seconds to start one, so there the
// tests run one at a time, and each has the time of a test to itself.
const concurrent = !isDebug;

describe("--experimental-linear-regexp", () => {
  test.concurrentIf(concurrent).each([
    ["the flag selects the matcher", { flag: true }, "linear", [flag]],
    ["the flag of bun run selects the matcher", { flag: true, command: ["run"] }, "linear", [flag]],
    ["the flag in BUN_OPTIONS selects the matcher", { env: { BUN_OPTIONS: flag } }, "linear", [flag]],
    ["the environment variable selects the matcher", { env: { [variable]: "1" } }, "linear", []],
    ["without the switch the engines backtrack", {}, "backtracking", []],
    ["with the environment variable set to 0 the engines backtrack", { env: { [variable]: "0" } }, "backtracking", []],
    // The switch is not taken away by the JavaScriptCore option it sets.
    [
      "the flag with BUN_JSC_useRegExpLinearEngine=0 selects the matcher",
      { flag: true, env: { BUN_JSC_useRegExpLinearEngine: "0" } },
      "linear",
      [flag],
    ],
  ] as [string, Switch, string, string[]][])("%s", async (_, options, engine, execArgv) => {
    expect(await report("engine", options)).toEqual({
      literal: engine,
      constructed: engine,
      unicodeSets: engine,
      execArgv,
    });
  });

  test.concurrentIf(concurrent)("every way to a RegExp runs the matcher, also in a Worker", async () => {
    // Each is what a match gives. A backtracking engine stops at its limit and reports no match.
    expect(await report("routes", { flag: true })).toEqual({
      results: { test: true, exec: 0, search: 0, replace: 0, match: 1, matchAll: 1, split: 2 },
      worker: true,
    });
  });

  test.concurrentIf(concurrent)("a forked process has the switch of its parent", async () => {
    expect(await report("fork", { flag: true })).toBe(true);
  });

  test.concurrentIf(concurrent)("bun test --parallel gives the switch to its workers", async () => {
    // JavaScriptCore takes the option when it starts, so a worker has the matcher only when its
    // own command line has the flag. The test in each file passes only on the matcher.
    const file = `
      import { expect, test } from "bun:test";
      test("the matcher runs", () => {
        expect(/(a*)*b|a*!/.test(Buffer.alloc(64, "a") + "!")).toBe(true);
      });`;
    using dir = tempDir("linear-regexp-parallel", { "a.test.js": file, "b.test.js": file });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "--parallel=2", flag],
      env: { ...bunEnv, BUN_TEST_PARALLEL_SCALE_MS: "0", [variable]: undefined, BUN_OPTIONS: undefined },
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout).toContain("PARALLEL");
    expect(stderr).toContain("2 pass");
    expect(stderr).toContain("0 fail");
    expect(exitCode).toBe(0);
  });

  test.concurrentIf(concurrent)("the filter of a Bun.build plugin runs on the matcher", async () => {
    // The bundler matches the filter on its own threads, and not through a RegExp object. The
    // filter matches the import only on the matcher. Without the switch it runs to the limit of
    // the backtracking interpreter, which takes seconds, and the import does not resolve.
    expect(await report("pluginFilter", { flag: true })).toEqual({ success: true, resolved: [true], logs: 0 });
  });

  test.concurrentIf(concurrent)(
    "the steps of a match grow linearly with the subject, under the bound of its program",
    async () => {
      const { rows, bounded, globalLoop } = await report("steps", { flag: true });

      const underItsBounds = (statistics: any, positions: number) => ({
        engine: statistics.engine,
        steps: statistics.steps <= statistics.maximumStepsPerPosition * positions,
        // No program costs a position more than four steps per instruction of the largest program.
        stepsPerPosition: statistics.maximumStepsPerPosition <= 4 * maximumProgramSize,
        memory: statistics.scratchBytes <= statistics.maximumScratchBytes,
        memoryOfProgram: statistics.maximumScratchBytes <= maximumWorkingMemory,
      });
      const allTrue = { engine: "linear", steps: true, stepsPerPosition: true, memory: true, memoryOfProgram: true };

      expect(rows.length).toBe(16);
      for (const { pattern, encoding, lengths, statistics } of rows) {
        const [one, two, three] = statistics.map((entry: any) => entry.steps);
        const row = { pattern, encoding, steps: [one, two, three] };
        expect({ ...row, index: statistics.map((entry: any) => entry.index) }).toMatchObject({ index: [-1, -1, -1] });
        // On one line: the same number of steps for every 128 characters more.
        expect({ ...row, growth: three - two }).toMatchObject({ growth: two - one });
        expect(two - one).toBeGreaterThan(0);
        // The memory of the matcher does not depend on the subject.
        expect({ ...row, memory: statistics.map((entry: any) => entry.scratchBytes) }).toMatchObject({
          memory: [statistics[0].scratchBytes, statistics[0].scratchBytes, statistics[0].scratchBytes],
        });
        statistics.forEach((entry: any, index: number) => {
          expect({ ...row, ...underItsBounds(entry, lengths[index] + 1) }).toMatchObject(allTrue);
        });
      }

      expect(
        bounded.map(({ pattern, length, start, statistics }: any) => ({
          pattern,
          length,
          start,
          index: statistics.index,
        })),
      ).toEqual([
        { pattern: "/x{0,100}y/", length: 61, start: 0, index: -1 },
        { pattern: "/x{0,100}y/", length: 301, start: 0, index: -1 },
        { pattern: "/^(?:\\w+\\s?){1,100}$/", length: 270, start: 0, index: 0 },
        { pattern: "/(\\d+)-(\\d+)/", length: 1005, start: 250, index: 500 },
        { pattern: "/b+$/", length: 800, start: 399, index: 799 },
      ]);
      for (const { pattern, length, start, statistics } of bounded)
        expect({ pattern, ...underItsBounds(statistics, length - start + 1) }).toMatchObject(allTrue);

      // The bound is for one match. This loop of n matches takes about 3n² steps, as many as a
      // backtracking engine: four times as many for a subject twice as long.
      const [small, medium, large] = globalLoop;
      expect(medium / small).toBeGreaterThan(3.5);
      expect(large / medium).toBeGreaterThan(3.5);
    },
  );

  test.concurrentIf(concurrent)("matches where the backtracking engines stop at their limits", async () => {
    // Both are matches. A backtracking engine gives up on the first after 100,000,000 steps, and on
    // the second when its 1 MB of contexts is full, and reports "no match" both times.
    const result = await report("limits", { flag: true, env: { BUN_JSC_maxRegExpStackSize: "1048576" } });
    expect(result).toEqual({ matchLimit: true, contextPool: true });
  });

  test.concurrentIf(concurrent)("a pattern the matcher refuses runs as it does without the switch", async () => {
    const [withSwitch, without] = await Promise.all([report("refused", { flag: true }), report("refused")]);
    expect(withSwitch.map((entry: any) => [entry.pattern, entry.engine, entry.refusal])).toEqual([
      ["/(a+)b\\1/", "backtracking", "backreference"],
      ["/(?<quote>['\"]).*?\\k<quote>/", "backtracking", "backreference"],
      ["/(?=.*\\d)(?=.*[a-z])\\w{6,}/", "backtracking", "lookaround of unbounded length"],
      ["/(?<=\\$\\d*)\\d/", "backtracking", "lookaround of unbounded length"],
      ["/(?:a{1,300}){1,300}b/", "backtracking", "program too large"],
      [
        "/(?=a{0,4}(?=a{0,4}(?=a{0,4}(?=a{0,4}(?=a{0,4}(?=a{0,4}(?=a{0,4}b)))))))a/",
        "backtracking",
        "lookaround too costly",
      ],
      ["/.*foo(?=.*bar).*/", "backtracking", "lookaround of unbounded length"],
    ]);
    // The same engine (the code of the JIT, where the JIT has any) and the same match.
    expect(withSwitch.map((entry: any) => ({ ...entry, refusal: "none" }))).toEqual(without);
    expect(without[0]).toEqual({
      pattern: "/(a+)b\\1/",
      engine: "backtracking",
      refusal: "none",
      jit: true,
      index: 0,
      match: [5, 2],
    });
  });

  test.concurrentIf(concurrent)("every RegExp and String method answers as it does without the switch", async () => {
    const [withSwitch, without] = await Promise.all([report("methods", { flag: true }), report("methods")]);
    expect(withSwitch.length).toBe(24);
    expect(withSwitch.map((entry: any) => [entry.pattern, entry.engine])).toEqual(
      without.map((entry: any) => [entry.pattern, "linear"]),
    );
    expect(withSwitch.map((entry: any) => ({ ...entry, engine: "backtracking" }))).toEqual(without);
  });

  // JavaScriptCore takes the switch when it starts. A Worker has what its process has.
  test.concurrentIf(concurrent)("a Worker cannot be given the switch in a process that does not have it", async () => {
    const invalid = {
      name: "Error",
      code: "ERR_WORKER_INVALID_EXEC_ARGV",
      message: "Initiated Worker with invalid execArgv flags: " + flag,
    };
    expect(await report("workerExecArgv")).toEqual({ given: invalid, givenGlobal: invalid });
  });

  test.concurrentIf(concurrent)("in a process that has the switch, a Worker runs the matcher", async () => {
    // true: the matcher ran in the Worker, also in the one whose execArgv is empty.
    expect(await report("workerExecArgv", { flag: true })).toEqual({ given: true, givenGlobal: true, empty: true });
  });
});
