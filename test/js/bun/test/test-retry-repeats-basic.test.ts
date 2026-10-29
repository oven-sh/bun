// Runs the retry/repeats hook-ordering checks in a subprocess so the
// intentional intermediate retry failures don't leak into this run's
// reporter output (JUnit, GitHub Actions annotations).
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot, tempDir } from "harness";
import { join } from "node:path";

test("retry and repeats hook ordering", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", join(import.meta.dir, "test-retry-repeats-basic-fixture.ts")],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toContain("12 pass");
  expect(stderr).toContain("0 fail");
  expect(stderr).toContain("(attempt 3)");
  expect(exitCode).toBe(0);
});

// Bun makes some checks only when a run of a test ends: the expect.assertions() and expect.hasAssertions()
// counts, and that the body of a test.failing or (with --todo) test.todo test threw.
describe.concurrent("each run is held to the checks made when it ends", () => {
  // `run(name)` counts the runs of a test body. The counts go to stdout when the file ends.
  const counters = `
    import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
    const runs = {};
    const run = name => (runs[name] = (runs[name] ?? 0) + 1);
    afterAll(() => console.log(JSON.stringify(runs)));
    // After a turn of the event loop the run completes from a task and not from the call of its body.
    const turn = () => new Promise(resolve => setImmediate(resolve));
  `;

  async function runTests(files: Record<string, string>, ...args: string[]) {
    using dir = tempDir("test-retry-repeats", files);
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", ...args],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return {
      // The result line of each test, with the lines that give the reason of a failure.
      results: normalizeBunSnapshot(stderr)
        .split("\n")
        .filter(line => /^(?:\((?:pass|fail|todo|skip)\)|AssertionError:|  \^) /.test(line)),
      summary: stderr.match(/^ *\d+ (?:pass|todo|fail)$/gm)?.map(line => line.trim()),
      // The first line of stdout is the version of bun.
      runs: stdout.split("\n").slice(1).join("\n"),
      exitCode,
    };
  }

  const tooFew = "AssertionError: expected 1 assertion, but test ended with 0 assertions";
  const tooMany = "AssertionError: expected 1 assertion, but test ended with 2 assertions";
  const none = "AssertionError: received 0 assertions, but expected at least one assertion to be called";
  const failingPassed =
    "  ^ this test is marked as failing but it passed. Remove `.failing` if tested behavior now works";
  const todoPassed = "  ^ this test is marked as todo but passes. Remove `.todo` if tested behavior now works";

  test("{ repeats }: the test fails at the first run that breaks a check", async () => {
    const result = await runTests(
      {
        "repeats.test.js": `
          ${counters}
          const options = { repeats: 2 };

          // Each of these tests breaks its check in one run and keeps it in the other runs.
          for (const bad of [1, 2]) {
            test("too few assertions in run " + bad, () => {
              expect.assertions(1);
              if (run("few " + bad) !== bad) expect(1).toBe(1);
            }, options);
            test("too many assertions in run " + bad, () => {
              expect.assertions(1);
              expect(1).toBe(1);
              if (run("many " + bad) === bad) expect(2).toBe(2);
            }, options);
            test("no assertion in run " + bad, () => {
              expect.hasAssertions();
              if (run("none " + bad) !== bad) expect(1).toBe(1);
            }, options);
            test.failing("failing test does not throw in run " + bad, () => {
              if (run("failing " + bad) !== bad) throw new Error("expected");
            }, options);
            test.todo("todo test does not throw in run " + bad, () => {
              if (run("todo " + bad) !== bad) throw new Error("expected");
            }, options);
          }

          // The body of a failing or todo test that throws still has to make the assertions it planned.
          test.failing("failing test throws before its assertion in run 1", () => {
            expect.assertions(1);
            if (run("failing few") !== 1) expect(1).toBe(1);
            throw new Error("expected");
          }, options);
          test.todo("todo test throws before its assertion in run 1", () => {
            expect.assertions(1);
            if (run("todo few") !== 1) expect(1).toBe(1);
            throw new Error("expected");
          }, options);

          describe.concurrent("concurrent", () => {
            test.failing("failing test does not throw in run 2", async () => {
              const bad = run("concurrent failing") === 2;
              await turn();
              if (!bad) throw new Error("expected");
            }, options);
            test.todo("todo test does not throw in run 2", async () => {
              const bad = run("concurrent todo") === 2;
              await turn();
              if (!bad) throw new Error("expected");
            }, options);
          });

          test("no assertion in run 2, after a turn of the event loop", async () => {
            expect.hasAssertions();
            const bad = run("turn") === 2;
            await turn();
            if (!bad) expect(1).toBe(1);
          }, options);
          test("no assertion in run 2, with a done callback", done => {
            expect.hasAssertions();
            if (run("done") !== 2) expect(1).toBe(1);
            setImmediate(done);
          }, options);

          // These tests keep their checks in every run.
          test("one assertion in every run", () => {
            expect.assertions(1);
            run("kept");
            expect(1).toBe(1);
          }, options);
          describe("hooks", () => {
            beforeEach(() => expect.hasAssertions());
            afterEach(() => expect(1).toBe(1));
            test("an assertion in afterEach counts for its run", () => {
              run("afterEach");
            }, options);
          });
        `,
      },
      "--todo",
    );

    expect(result).toEqual({
      results: [
        tooFew,
        "(fail) too few assertions in run 1",
        tooMany,
        "(fail) too many assertions in run 1",
        none,
        "(fail) no assertion in run 1",
        "(fail) failing test does not throw in run 1",
        failingPassed,
        "(fail) todo test does not throw in run 1",
        todoPassed,
        tooFew,
        "(fail) too few assertions in run 2 (run 2)",
        tooMany,
        "(fail) too many assertions in run 2 (run 2)",
        none,
        "(fail) no assertion in run 2 (run 2)",
        "(fail) failing test does not throw in run 2 (run 2)",
        failingPassed,
        "(fail) todo test does not throw in run 2 (run 2)",
        todoPassed,
        tooFew,
        "(fail) failing test throws before its assertion in run 1",
        tooFew,
        "(fail) todo test throws before its assertion in run 1",
        "(fail) concurrent > failing test does not throw in run 2 (run 2)",
        failingPassed,
        "(fail) concurrent > todo test does not throw in run 2 (run 2)",
        todoPassed,
        none,
        "(fail) no assertion in run 2, after a turn of the event loop (run 2)",
        none,
        "(fail) no assertion in run 2, with a done callback (run 2)",
        "(pass) one assertion in every run (run 3)",
        "(pass) hooks > an assertion in afterEach counts for its run (run 3)",
      ],
      summary: ["2 pass", "16 fail"],
      // No run follows the run that failed.
      runs:
        JSON.stringify({
          "few 1": 1,
          "many 1": 1,
          "none 1": 1,
          "failing 1": 1,
          "todo 1": 1,
          "few 2": 2,
          "many 2": 2,
          "none 2": 2,
          "failing 2": 2,
          "todo 2": 2,
          "failing few": 1,
          "todo few": 1,
          "concurrent failing": 2,
          "concurrent todo": 2,
          "turn": 2,
          "done": 2,
          "kept": 3,
          "afterEach": 3,
        }) + "\n",
      exitCode: 1,
    });
  });

  test("{ retry }: an attempt that breaks a check is retried", async () => {
    const result = await runTests({
      "retry.test.js": `
          ${counters}
          const options = { retry: 2 };

          // Each of these tests breaks its check in attempt 1 only.
          test("too few assertions in attempt 1", () => {
            expect.assertions(1);
            if (run("few") !== 1) expect(1).toBe(1);
          }, options);
          test("too many assertions in attempt 1", () => {
            expect.assertions(1);
            expect(1).toBe(1);
            if (run("many") === 1) expect(2).toBe(2);
          }, options);
          test("no assertion in attempt 1", () => {
            expect.hasAssertions();
            if (run("none") !== 1) expect(1).toBe(1);
          }, options);
          test.failing("failing test does not throw in attempt 1", () => {
            if (run("failing") !== 1) throw new Error("expected");
          }, options);
          test.failing("failing test throws before its assertion in attempt 1", () => {
            expect.assertions(1);
            if (run("failing few") !== 1) expect(1).toBe(1);
            throw new Error("expected");
          }, options);

          test("no assertion in attempt 1, after a turn of the event loop", async () => {
            expect.hasAssertions();
            const bad = run("turn") === 1;
            await turn();
            if (!bad) expect(1).toBe(1);
          }, options);
          test("no assertion in attempt 1, with a done callback", done => {
            expect.hasAssertions();
            if (run("done") !== 1) expect(1).toBe(1);
            setImmediate(done);
          }, options);
          describe.concurrent("concurrent", () => {
            test.failing("failing test does not throw in attempt 1", async () => {
              const bad = run("concurrent failing") === 1;
              await turn();
              if (!bad) throw new Error("expected");
            }, options);
          });

          // These tests break their check in every attempt.
          test("too few assertions in every attempt", () => {
            expect.assertions(1);
            run("few always");
          }, options);
          test.failing("failing test never throws", () => {
            run("failing always");
          }, options);
        `,
    });

    expect(result).toEqual({
      results: [
        "(pass) too few assertions in attempt 1 (attempt 2)",
        "(pass) too many assertions in attempt 1 (attempt 2)",
        "(pass) no assertion in attempt 1 (attempt 2)",
        "(pass) failing test does not throw in attempt 1 (attempt 2)",
        "(pass) failing test throws before its assertion in attempt 1 (attempt 2)",
        "(pass) no assertion in attempt 1, after a turn of the event loop (attempt 2)",
        "(pass) no assertion in attempt 1, with a done callback (attempt 2)",
        "(pass) concurrent > failing test does not throw in attempt 1 (attempt 2)",
        tooFew,
        "(fail) too few assertions in every attempt (attempt 3)",
        "(fail) failing test never throws (attempt 3)",
        failingPassed,
      ],
      summary: ["8 pass", "2 fail"],
      runs:
        JSON.stringify({
          "few": 2,
          "many": 2,
          "none": 2,
          "failing": 2,
          "failing few": 2,
          "turn": 2,
          "done": 2,
          "concurrent failing": 2,
          "few always": 3,
          "failing always": 3,
        }) + "\n",
      exitCode: 1,
    });
  });

  // Each file has one test that fails at run 2 of 3 and one test that passes at attempt 2.
  const file = (name: string) => `
    import { expect, test } from "bun:test";
    let runs = 0;
    test("${name}: too few assertions in run 2", () => {
      expect.assertions(1);
      if (++runs !== 2) expect(1).toBe(1);
    }, { repeats: 2 });
    let attempts = 0;
    test("${name}: too few assertions in attempt 1", () => {
      expect.assertions(1);
      if (++attempts !== 1) expect(1).toBe(1);
    }, { retry: 2 });
  `;
  test.each(["--isolate", "--parallel=2"])("with %s", async flag => {
    const { results, summary, exitCode } = await runTests(
      { "a.test.js": file("a"), "b.test.js": file("b") },
      flag,
      "a.test.js",
      "b.test.js",
    );

    // The workers of --parallel report in the order in which they finish.
    expect({ results: results.sort(), summary, exitCode }).toEqual({
      results: [
        "(fail) a: too few assertions in run 2 (run 2)",
        "(fail) b: too few assertions in run 2 (run 2)",
        "(pass) a: too few assertions in attempt 1 (attempt 2)",
        "(pass) b: too few assertions in attempt 1 (attempt 2)",
        tooFew,
        tooFew,
      ],
      summary: ["2 pass", "2 fail"],
      exitCode: 1,
    });
  });
});
