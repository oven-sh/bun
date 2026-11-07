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
  const counters = (from: string) => `
    import { afterAll, afterEach, beforeEach, describe, expect, test } from "${from}";
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

  describe.each(["bun:test", "vitest"])("tests from %s", from => {
    // The first parameter of a test from "vitest" is its context, so only "bun:test" has the done callback.
    const jest = from === "bun:test";

    test("{ repeats }: the test fails at the first run that breaks a check", async () => {
      const result = await runTests(
        {
          "repeats.test.js": `
            ${counters(from)}
            const options = { repeats: 2 };

            // Each of these tests breaks its check in one run and keeps it in the other runs.
            for (const bad of [1, 2]) {
              test("too few assertions in run " + bad, options, () => {
                expect.assertions(1);
                if (run("few " + bad) !== bad) expect(1).toBe(1);
              });
              test("too many assertions in run " + bad, options, () => {
                expect.assertions(1);
                expect(1).toBe(1);
                if (run("many " + bad) === bad) expect(2).toBe(2);
              });
              test("no assertion in run " + bad, options, () => {
                expect.hasAssertions();
                if (run("none " + bad) !== bad) expect(1).toBe(1);
              });
              test.failing("failing test does not throw in run " + bad, options, () => {
                if (run("failing " + bad) !== bad) throw new Error("expected");
              });
              test.todo("todo test does not throw in run " + bad, options, () => {
                if (run("todo " + bad) !== bad) throw new Error("expected");
              });
            }

            // The body of a failing or todo test that throws still has to make the assertions it planned.
            test.failing("failing test throws before its assertion in run 1", options, () => {
              expect.assertions(1);
              if (run("failing few") !== 1) expect(1).toBe(1);
              throw new Error("expected");
            });
            test.todo("todo test throws before its assertion in run 1", options, () => {
              expect.assertions(1);
              if (run("todo few") !== 1) expect(1).toBe(1);
              throw new Error("expected");
            });

            describe.concurrent("concurrent", () => {
              test.failing("failing test does not throw in run 2", options, async () => {
                const bad = run("concurrent failing") === 2;
                await turn();
                if (!bad) throw new Error("expected");
              });
              test.todo("todo test does not throw in run 2", options, async () => {
                const bad = run("concurrent todo") === 2;
                await turn();
                if (!bad) throw new Error("expected");
              });
            });

            test("no assertion in run 2, after a turn of the event loop", options, async () => {
              expect.hasAssertions();
              const bad = run("turn") === 2;
              await turn();
              if (!bad) expect(1).toBe(1);
            });
            ${
              jest
                ? `test("no assertion in run 2, with a done callback", options, done => {
                     expect.hasAssertions();
                     if (run("done") !== 2) expect(1).toBe(1);
                     setImmediate(done);
                   });`
                : ""
            }

            // This test keeps its check in every run.
            test("one assertion in every run", options, () => {
              expect.assertions(1);
              run("kept");
              expect(1).toBe(1);
            });

            describe("hooks", () => {
              ${
                jest
                  ? // An expect() call of afterEach counts for its test.
                    `beforeEach(() => expect.hasAssertions());
                     afterEach(() => expect(1).toBe(1));
                     test("an assertion in afterEach counts for its run", options, () => {
                       run("afterEach");
                     });`
                  : // As in Vitest, the counts are checked when the body ends. A count that afterEach sets comes too late.
                    `afterEach(() => expect.assertions(1));
                     test("a count that afterEach sets is not checked", options, () => {
                       if (run("afterEach") !== 2) expect(1).toBe(1);
                     });`
              }
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
          ...(jest ? [none, "(fail) no assertion in run 2, with a done callback (run 2)"] : []),
          "(pass) one assertion in every run (run 3)",
          jest
            ? "(pass) hooks > an assertion in afterEach counts for its run (run 3)"
            : "(pass) hooks > a count that afterEach sets is not checked (run 3)",
        ],
        summary: jest ? ["2 pass", "16 fail"] : ["2 pass", "15 fail"],
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
            ...(jest && { "done": 2 }),
            "kept": 3,
            "afterEach": 3,
          }) + "\n",
        exitCode: 1,
      });
    });

    test("{ retry }: an attempt that breaks a check is retried", async () => {
      const result = await runTests(
        {
          "retry.test.js": `
            ${counters(from)}
            const options = { retry: 2 };

            // Each of these tests breaks its check in attempt 1 only.
            test("too few assertions in attempt 1", options, () => {
              expect.assertions(1);
              if (run("few") !== 1) expect(1).toBe(1);
            });
            test("too many assertions in attempt 1", options, () => {
              expect.assertions(1);
              expect(1).toBe(1);
              if (run("many") === 1) expect(2).toBe(2);
            });
            test("no assertion in attempt 1", options, () => {
              expect.hasAssertions();
              if (run("none") !== 1) expect(1).toBe(1);
            });
            test.failing("failing test does not throw in attempt 1", options, () => {
              if (run("failing") !== 1) throw new Error("expected");
            });
            test.failing("failing test throws before its assertion in attempt 1", options, () => {
              expect.assertions(1);
              if (run("failing few") !== 1) expect(1).toBe(1);
              throw new Error("expected");
            });

            test("no assertion in attempt 1, after a turn of the event loop", options, async () => {
              expect.hasAssertions();
              const bad = run("turn") === 1;
              await turn();
              if (!bad) expect(1).toBe(1);
            });
            ${
              jest
                ? `test("no assertion in attempt 1, with a done callback", options, done => {
                     expect.hasAssertions();
                     if (run("done") !== 1) expect(1).toBe(1);
                     setImmediate(done);
                   });`
                : ""
            }
            describe.concurrent("concurrent", () => {
              test.failing("failing test does not throw in attempt 1", options, async () => {
                const bad = run("concurrent failing") === 1;
                await turn();
                if (!bad) throw new Error("expected");
              });
            });

            // As in Vitest and Jest. An expect() call that attempt 1 leaves behind counts for the attempt that runs then.
            const gate = Promise.withResolvers();
            test("attempt 1 does not wait for its assertion", options, async () => {
              expect.assertions(1);
              if (run("late") === 1) {
                gate.promise.then(() => expect(1).toBe(1));
                return;
              }
              gate.resolve();
              await gate.promise;
            });

            // These tests break their check in every attempt.
            test("too few assertions in every attempt", options, () => {
              expect.assertions(1);
              run("few always");
            });
            test.failing("failing test never throws", options, () => {
              run("failing always");
            });

            // --todo runs a todo test to find out if it passes. An attempt that passes is that answer, so it is the
            // last attempt. An attempt that fails for another reason is retried like the attempt of any test.
            test.todo("todo test passes in attempt 1", options, () => {
              if (run("todo passes") !== 1) throw new Error("expected");
            });
            test.todo("todo test does not throw and misses its assertion in attempt 1", options, () => {
              expect.assertions(1);
              if (run("todo quiet") !== 1) {
                expect(1).toBe(1);
                throw new Error("expected");
              }
            });
            test.todo("todo test throws before its assertion in attempt 1", options, () => {
              expect.assertions(1);
              if (run("todo few") !== 1) expect(1).toBe(1);
              throw new Error("expected");
            });
            for (const throws of [true, false]) {
              describe("todo test whose beforeEach throws in attempt 1", () => {
                let attempts = 0;
                beforeEach(() => {
                  if (++attempts === 1) throw new Error("expected");
                });
                test.todo(throws ? "the body throws" : "the body does not throw", options, () => {
                  run("todo hook " + throws);
                  if (throws) throw new Error("expected");
                });
              });
            }
          `,
        },
        "--todo",
      );

      expect(result).toEqual({
        results: [
          "(pass) too few assertions in attempt 1 (attempt 2)",
          "(pass) too many assertions in attempt 1 (attempt 2)",
          "(pass) no assertion in attempt 1 (attempt 2)",
          "(pass) failing test does not throw in attempt 1 (attempt 2)",
          "(pass) failing test throws before its assertion in attempt 1 (attempt 2)",
          "(pass) no assertion in attempt 1, after a turn of the event loop (attempt 2)",
          ...(jest ? ["(pass) no assertion in attempt 1, with a done callback (attempt 2)"] : []),
          "(pass) concurrent > failing test does not throw in attempt 1 (attempt 2)",
          "(pass) attempt 1 does not wait for its assertion (attempt 2)",
          tooFew,
          "(fail) too few assertions in every attempt (attempt 3)",
          "(fail) failing test never throws (attempt 3)",
          failingPassed,
          "(fail) todo test passes in attempt 1",
          todoPassed,
          "(todo) todo test does not throw and misses its assertion in attempt 1 (attempt 2)",
          "(todo) todo test throws before its assertion in attempt 1 (attempt 2)",
          "(todo) todo test whose beforeEach throws in attempt 1 > the body throws (attempt 2)",
          "(fail) todo test whose beforeEach throws in attempt 1 > the body does not throw (attempt 2)",
          todoPassed,
        ],
        summary: jest ? ["9 pass", "3 todo", "4 fail"] : ["8 pass", "3 todo", "4 fail"],
        runs:
          JSON.stringify({
            "few": 2,
            "many": 2,
            "none": 2,
            "failing": 2,
            "failing few": 2,
            "turn": 2,
            ...(jest && { "done": 2 }),
            "concurrent failing": 2,
            "late": 2,
            "few always": 3,
            "failing always": 3,
            "todo passes": 1,
            "todo quiet": 2,
            "todo few": 2,
            "todo hook true": 1,
            "todo hook false": 1,
          }) + "\n",
        exitCode: 1,
      });
    });
  });

  // Only a test from "vitest" can have both options. Each repeat has all the retries.
  test("{ retry, repeats }: a retry follows a run that breaks a check, and then the repeat", async () => {
    const { results, runs, exitCode } = await runTests({
      "both.test.js": `
        ${counters("vitest")}
        const options = { retry: 1, repeats: 1 };
        const throwsIn = (name, ...executions) => () => {
          if (executions.includes(run(name))) throw new Error("expected");
        };
        test.failing("failing test does not throw in executions 1 and 3", options, throwsIn("first and third", 2, 4));
        test.failing("failing test does not throw in execution 1", options, throwsIn("first", 2, 3));
        test.failing("failing test does not throw in execution 2", options, throwsIn("second", 1, 3));
      `,
    });

    expect({ results, runs, exitCode }).toEqual({
      results: [
        "(pass) failing test does not throw in executions 1 and 3 (attempt 2) (run 2)",
        "(pass) failing test does not throw in execution 1 (run 2)",
        "(pass) failing test does not throw in execution 2 (attempt 2) (run 2)",
      ],
      runs: JSON.stringify({ "first and third": 4, "first": 3, "second": 3 }) + "\n",
      exitCode: 0,
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
