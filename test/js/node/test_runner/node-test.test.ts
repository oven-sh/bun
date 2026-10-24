import { spawn } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, nodeExeAtLeast, tempDir } from "harness";
import { join } from "node:path";

describe("node:test", () => {
  // These three drive the largest fixtures (01-harness has 32 node:test cases);
  // a debug+ASAN `bun test` child takes several seconds to start, so give them
  // headroom and let them spawn in parallel instead of serially.
  test.concurrent(
    "should run basic tests",
    async () => {
      const { exitCode, stderr } = await runTests(["01-harness.js"]);
      expect({ exitCode, stderr }).toMatchObject({
        exitCode: 0,
        stderr: expect.stringContaining("0 fail"),
      });
    },
    30_000,
  );

  test.concurrent(
    "should run hooks in the right order",
    async () => {
      const { exitCode, stderr } = await runTests(["02-hooks.js"]);
      expect({ exitCode, stderr }).toMatchObject({
        exitCode: 0,
        stderr: expect.stringContaining("0 fail"),
      });
    },
    30_000,
  );

  test("should run tests with different variations", async () => {
    const { exitCode, stderr } = await runTests(["03-test-variations.js"]);
    expect({ exitCode, stderr }).toMatchObject({
      exitCode: 0,
      stderr: expect.stringContaining("0 fail"),
    });
  });

  test("should run async tests", async () => {
    const { exitCode, stderr } = await runTests(["04-async-tests.js"]);
    expect({ exitCode, stderr }).toMatchObject({
      exitCode: 0,
      stderr: expect.stringContaining("0 fail"),
    });
  });

  test.concurrent(
    "should run all tests from multiple files",
    async () => {
      const { exitCode, stderr } = await runTests(["01-harness.js", "02-hooks.js"]);
      expect({ exitCode, stderr }).toMatchObject({
        exitCode: 0,
        // 32 from 01-harness + 3 from 02-hooks
        stderr: expect.stringContaining("35 pass"),
      });
    },
    30_000,
  );

  test("should run test() and describe() called inside another test() as subtests", async () => {
    const { exitCode, stderr } = await runTests(["05-test-in-test.js"]);
    expect({ exitCode, stderr }).toMatchObject({
      exitCode: 0,
      stderr: expect.stringContaining("0 fail"),
    });
  });

  test("should run before hooks created on a running test once and validate hook options", async () => {
    const { exitCode, stderr } = await runTests(["06-hook-semantics.js"]);
    expect(stderr).toContain("4 pass");
    expect({ exitCode, stderr }).toMatchObject({
      exitCode: 0,
      stderr: expect.stringContaining("0 fail"),
    });
  });

  test("should fail tests whose hooks, bodies, or inline suite callbacks fail", async () => {
    const { exitCode, stdout, stderr } = await runTests(["07-failing-hooks.js"]);
    // The subtest after the failing before hook must not run its body (Node).
    expect(stdout).toContain("SUB_BODY_RAN=false");
    expect(stderr).toContain("0 pass");
    expect({ exitCode, stderr }).toMatchObject({
      exitCode: 1,
      stderr: expect.stringContaining("10 fail"),
    });
  });

  test("should support done callbacks in tests and hooks", async () => {
    const { exitCode, stderr } = await runTests(["10-done-callbacks.js"]);
    expect(stderr).toContain("2 pass");
    expect({ exitCode, stderr }).toMatchObject({
      exitCode: 0,
      stderr: expect.stringContaining("0 fail"),
    });
  });

  test("should count runtime t.todo()/t.skip() as todo/skip and keep runner timers real under mock timers", async () => {
    const { exitCode, stderr } = await runTests(["12-runtime-todo-and-mock-timers.js"]);
    expect(stderr).toContain("3 pass");
    expect(stderr).toContain("1 skip");
    expect(stderr).toContain("1 todo");
    expect({ exitCode, stderr }).toMatchObject({
      exitCode: 0,
      stderr: expect.stringContaining("0 fail"),
    });
  });

  test("should count runtime t.todo()/t.skip() as todo/skip under --concurrent too", async () => {
    // markCurrentResult's microtask-drain fallback could not name a sequence
    // inside a concurrent group, so the skip/todo mark was dropped and both
    // tests were reported as pass.
    const { exitCode, stderr } = await runTests(["12-runtime-todo-and-mock-timers.js"], {}, ["--concurrent"]);
    expect(stderr).toContain("3 pass");
    expect(stderr).toContain("1 skip");
    expect(stderr).toContain("1 todo");
    expect({ exitCode, stderr }).toMatchObject({
      exitCode: 0,
      stderr: expect.stringContaining("0 fail"),
    });
  });

  test("should run todo bodies under --todo instead of registering an empty function", async () => {
    const { exitCode, stderr } = await runTests(["13-todo-bodies.js"], {}, ["--todo"]);
    expect(stderr).toContain("2 todo");
    expect(stderr).toContain("1 pass");
    expect({ exitCode, stderr }).toMatchObject({
      exitCode: 0,
      stderr: expect.stringContaining("0 fail"),
    });
  });

  test("should forward Infinity and finite timeouts so they override the runner default", async () => {
    const { exitCode, stderr } = await runTests(["11-timeout-overrides.js"], {}, ["--timeout", "100"]);
    expect(stderr).toContain("2 pass");
    expect({ exitCode, stderr }).toMatchObject({
      exitCode: 0,
      stderr: expect.stringContaining("0 fail"),
    });
  });

  test("should not leak file-level beforeEach hooks across files in one process", async () => {
    const { exitCode, stderr } = await runTests(["14-root-hooks-a.js", "14-root-hooks-b.js"]);
    expect(stderr).toContain("4 pass");
    expect({ exitCode, stderr }).toMatchObject({
      exitCode: 0,
      stderr: expect.stringContaining("0 fail"),
    });
  });

  test("should treat only as a no-op instead of using bun:test's CI-banned only()", async () => {
    // bun:test's only() only throws when CI is set; pin the precondition.
    const { exitCode, stderr } = await runTests(["08-only-no-op.js"], { CI: "1" });
    expect(stderr).toContain("4 pass");
    expect({ exitCode, stderr }).toMatchObject({
      exitCode: 0,
      stderr: expect.stringContaining("0 fail"),
    });
  });

  describe("--test-only", () => {
    const fixture = (name: string) => join(import.meta.dirname, "fixtures", name);
    const upstream = (name: string) =>
      join(import.meta.dirname, "..", "test", "fixtures", "test-runner", "output", name);
    const run = async (cmd: string[], env: Record<string, string> = {}, cwd?: string) => {
      await using proc = spawn({ cmd, env: { ...bunEnv, ...env }, cwd, stderr: "pipe" });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      return { stdout, stderr, exitCode };
    };
    // A fixture asserts its own output. `stderr` is in the result only to show why a run failed.
    const runFixtures = async (args: string[], names: string[], env: Record<string, string> = {}) => {
      const { stderr, exitCode } = await run([bunExe(), "test", ...args, ...names.map(fixture)], env);
      return { counts: counts(stderr), exitCode, stderr: exitCode === 0 ? "" : stderr };
    };
    const all = { NODE_TEST_ONLY_FIXTURE: "all" };

    for (const flag of ["--test-only", "--only"]) {
      test.concurrent(
        `${flag} selects what node selects among the tests that bun:test collects`,
        async () => {
          // bun:test's .only throws when CI is detected. Node has no such rule for --test-only.
          expect(await runFixtures([flag], ["30-only-filter.js"], { CI: "1" })).toEqual({
            counts: { pass: 8, skip: 2, todo: 2, fail: 0 },
            exitCode: 0,
            stderr: "",
          });
        },
        30_000,
      );
    }

    test.concurrent(
      "without the flag, only and { only: false } have no effect",
      async () => {
        expect(await runFixtures([], ["30-only-filter.js"], all)).toEqual({
          counts: { pass: 16, skip: 2, todo: 2, fail: 0 },
          exitCode: 0,
          stderr: "",
        });
      },
      30_000,
    );

    test.concurrent(
      "filters the subtests of a running test: creation order, runOnly(), { only: false }, plan, hooks",
      async () => {
        expect(await runFixtures(["--test-only"], ["31-only-subtests.mjs"])).toEqual({
          counts: { pass: 9, fail: 0 },
          exitCode: 0,
          stderr: "",
        });
      },
      30_000,
    );

    test.concurrent(
      "without the flag, every subtest runs and runOnly() does not throw",
      async () => {
        expect(await runFixtures([], ["31-only-subtests.mjs"], all)).toEqual({
          counts: { pass: 10, fail: 0 },
          exitCode: 0,
          stderr: "",
        });
      },
      30_000,
    );

    const node = nodeExeAtLeast("26.3.0");
    test.skipIf(!node).concurrent(
      "the fixtures pass as they are under node",
      async () => {
        const runs = await Promise.all([
          ...["30-only-filter.js", "31-only-subtests.mjs"].flatMap(name => [
            run([node!, "--test", "--test-only", fixture(name)]),
            run([node!, "--test", fixture(name)], all),
          ]),
          run([node!, "--test", "--test-only", fixture("40-only-replaced-promise.mjs")]),
        ]);
        expect(runs.map(({ exitCode, stdout }) => (exitCode === 0 ? 0 : stdout))).toEqual([0, 0, 0, 0, 0]);
      },
      30_000,
    );

    test.concurrent(
      "BUN_OPTIONS carries the flag",
      async () => {
        expect(await runFixtures([], ["30-only-filter.js"], { BUN_OPTIONS: "--test-only" })).toEqual({
          counts: { pass: 8, skip: 2, todo: 2, fail: 0 },
          exitCode: 0,
          stderr: "",
        });
      },
      30_000,
    );

    test.concurrent(
      "--parallel workers get the flag",
      async () => {
        expect(
          await runFixtures(["--test-only", "--parallel=2"], ["30-only-filter.js", "31-only-subtests.mjs"]),
        ).toEqual({
          counts: { pass: 17, skip: 2, todo: 2, fail: 0 },
          exitCode: 0,
          stderr: "",
        });
      },
      30_000,
    );

    test.concurrent(
      "--rerun-each filters every run",
      async () => {
        expect(await runFixtures(["--test-only", "--rerun-each=2"], ["31-only-subtests.mjs"])).toEqual({
          counts: { pass: 18, fail: 0 },
          exitCode: 0,
          stderr: "",
        });
      },
      30_000,
    );

    test.concurrent(
      "a declaration that registers nothing does not select another test",
      async () => {
        const { stdout, stderr, exitCode } = await run([
          bunExe(),
          "test",
          "--test-only",
          "--rerun-each=2",
          fixture("37-only-late-declaration.mjs"),
        ]);
        expect({
          ran: stdout.split("\n").filter(line => line.startsWith("RAN ")),
          counts: counts(stderr),
          exitCode,
        }).toEqual({
          ran: ["RAN marked", "RAN marked"],
          counts: { pass: 2, fail: 0 },
          exitCode: 0,
        });
      },
      30_000,
    );

    test.concurrent(
      "a Worker cannot declare a test under the flag",
      async () => {
        expect(await runFixtures(["--test-only"], ["36-only-worker.js"])).toEqual({
          counts: { pass: 1, fail: 0 },
          exitCode: 0,
          stderr: "",
        });
      },
      30_000,
    );

    test.concurrent(
      "t.describe() is not filtered",
      async () => {
        expect(await runFixtures(["--test-only"], ["38-only-t-describe.js"])).toEqual({
          counts: { pass: 1, fail: 0 },
          exitCode: 0,
          stderr: "",
        });
      },
      30_000,
    );

    test.concurrent(
      "a filtered declaration does not call a Promise.resolve or a then that the file replaced",
      async () => {
        expect(await runFixtures(["--test-only"], ["40-only-replaced-promise.mjs"])).toEqual({
          counts: { pass: 1, fail: 0 },
          exitCode: 0,
          stderr: "",
        });
      },
      30_000,
    );

    describe("node's own fixtures", () => {
      test.concurrent(
        "only_tests.js",
        async () => {
          const { stderr, exitCode } = await run([bunExe(), "test", "--test-only", upstream("only_tests.js")]);
          expect({ counts: counts(stderr), exitCode, stderr: exitCode === 0 ? "" : stderr }).toEqual({
            counts: { pass: 13, skip: 2, fail: 0 },
            exitCode: 0,
            stderr: "",
          });
        },
        30_000,
      );

      test.concurrent(
        "name_pattern_with_only.js",
        async () => {
          const { stderr, exitCode } = await run([
            bunExe(),
            "test",
            "--test-only",
            "--test-name-pattern=enabled",
            upstream("name_pattern_with_only.js"),
          ]);
          expect({ counts: counts(stderr), exitCode, stderr: exitCode === 0 ? "" : stderr }).toEqual({
            counts: { pass: 1, fail: 0 },
            exitCode: 0,
            stderr: "",
          });
        },
        30_000,
      );

      test.concurrent(
        "filtered-suite-order.mjs",
        async () => {
          const { stdout, exitCode } = await run([
            bunExe(),
            "test",
            "--test-only",
            upstream("filtered-suite-order.mjs"),
          ]);
          const snapshot = await Bun.file(upstream("filtered-suite-order.snapshot")).text();
          const order = (text: string) =>
            text.split("\n").filter(line => /^( \* |Execution order|with global)/.test(line));
          expect({ order: order(stdout), exitCode }).toEqual({
            order: order(snapshot.split("TAP version")[0]),
            exitCode: 0,
          });
        },
        30_000,
      );
    });

    // Prints the events of the tests, and of the suites that have a directive, as `run()` reports them.
    const printRunEvents = `
      const { run } = require("node:test");
      (async () => {
        for await (const { type, data } of run({ files: [process.env.FIXTURE], only: true })) {
          if (type === "test:stdout") console.log("child " + data.message.trimEnd());
          if (type !== "test:pass" && type !== "test:fail") continue;
          const directive = data.skip !== undefined ? " # skip" : data.todo !== undefined ? " # todo" : "";
          if (data.details.type === "test" || directive !== "") console.log(type, data.details.type, data.name + directive);
        }
      })();
    `;
    const runEvents = async (name: string) => {
      const { stdout, stderr, exitCode } = await run([bunExe(), "-e", printRunEvents], { FIXTURE: fixture(name) });
      const lines = stdout.trim().split("\n");
      return {
        tests: lines.filter(line => /^test:(pass|fail) test /.test(line)),
        suites: lines.filter(line => /^test:(pass|fail) suite /.test(line)).sort(),
        stderr,
        exitCode,
      };
    };

    test.concurrent(
      "run({ only: true }) filters the file it runs",
      async () => {
        // Recorded from the same script under node v26.12.1. Node reports the suite after its tests.
        expect(await runEvents("30-only-filter.js")).toEqual({
          tests: [
            "test:pass test only modifier",
            "test:pass test only option",
            "test:pass test it.only alias",
            "test:pass test modifier beats only false",
            "test:pass test only todo # todo",
            "test:pass test only skip # skip",
            "test:pass test inherits",
            "test:pass test inherits",
            "test:pass test narrows",
            "test:pass test focused child",
            "test:pass test marked skip # skip",
            "test:pass test marked todo # todo",
          ],
          suites: ["test:pass suite marked skipped suite # skip"],
          stderr: "",
          exitCode: 0,
        });
      },
      30_000,
    );

    test.concurrent(
      "run({ only: true }) puts the flag in the process.execArgv of the child",
      async () => {
        using dir = tempDir("node-test-only-execargv", {
          "child.test.js": `
            const { test } = require("node:test");
            test.only("child", () => console.log("execArgv " + JSON.stringify(process.execArgv)));
          `,
        });
        const { stdout, stderr, exitCode } = await run([bunExe(), "-e", printRunEvents], {
          FIXTURE: join(String(dir), "child.test.js"),
        });
        const lines = stdout.split("\n").filter(line => /^(child execArgv|test:)/.test(line));
        expect({ lines, stderr, exitCode }).toEqual({
          lines: ['child execArgv ["--test-only"]', "test:pass test child"],
          stderr: "",
          exitCode: 0,
        });
      },
      30_000,
    );

    test.concurrent(
      "the flag is --only, so it also focuses a bun:test file of the same run",
      async () => {
        using dir = tempDir("node-test-only-mixed", {
          "node.test.js": `
            const { test } = require("node:test");
            test.only("node focused", () => {});
            test("node plain", () => {});
          `,
          "bun.test.js": `
            import { test } from "bun:test";
            test("bun plain 1", () => {});
            test("bun plain 2", () => {});
          `,
        });
        const mixed = async (args: string[]) => {
          const { stderr, exitCode } = await run([bunExe(), "test", ...args], {}, String(dir));
          return { counts: counts(stderr), exitCode };
        };
        expect({ flag: await mixed(["--test-only"]), noFlag: await mixed([]) }).toEqual({
          flag: { counts: { pass: 1, fail: 0 }, exitCode: 0 },
          noFlag: { counts: { pass: 4, fail: 0 }, exitCode: 0 },
        });
      },
      30_000,
    );

    // Each fixture below passes as it is under `node --test --test-only` (v26.3.0 and v26.12.1) and fails under Bun.
    test.todo("a suite that a running test declares is filtered", async () => {
      // Bun runs all four tests of the fixture. Node runs one.
      expect((await runFixtures(["--test-only"], ["32-only-inline-suite.mjs"])).exitCode).toBe(0);
    });
    test.todo("a selected suite with no test to run still runs its before and after hooks", async () => {
      // Bun runs none of the four hooks of the fixture: a focused run schedules hooks only where a test runs.
      expect((await runFixtures(["--test-only"], ["33-only-suite-hooks.js"])).exitCode).toBe(0);
    });
    test.todo("runOnly() on the context of the file changes what runs", async () => {
      // Bun runs 0 of the three tests: bun:test focuses the file from the flag before the hook runs.
      expect((await runFixtures(["--test-only"], ["34-only-root-run-only.js"])).exitCode).toBe(0);
    });
    test.todo("without the flag, a file that uses only gets node's diagnostic", async () => {
      // Bun reports no test:diagnostic event.
      expect((await run([bunExe(), fixture("35-only-diagnostic.mjs")])).exitCode).toBe(0);
    });
    test.todo("run({ only: true }) reports no directive for a suite that is not selected", async () => {
      // Bun also reports `todo suite # todo` and `nested skipped suite in a narrowed suite # skip`.
      expect((await runEvents("39-only-directives.js")).suites).toEqual([
        "test:pass suite marked skipped suite # skip",
        "test:pass suite nested skipped suite # skip",
        "test:pass suite nested todo suite # todo",
      ]);
    });
  });

  test("should serialize inline suites and await async describe callbacks like node", async () => {
    const { exitCode, stderr } = await runTests(["09-inline-suites.js"]);
    expect(stderr).toContain("3 pass");
    expect({ exitCode, stderr }).toMatchObject({
      exitCode: 0,
      stderr: expect.stringContaining("0 fail"),
    });
  });

  test("should expose the body outcome to afterEach and workerId to the context", async () => {
    const { exitCode, stderr } = await runTests(["15-outcome-in-hooks.js"]);
    expect(stderr).toContain("3 pass");
    expect({ exitCode, stderr }).toMatchObject({
      exitCode: 0,
      stderr: expect.stringContaining("0 fail"),
    });
  });

  test("should capture plan at first t.assert access and resolve subtests started after their parent finished", async () => {
    const { exitCode, stderr } = await runTests(["16-plan-and-late-subtest.js"]);
    expect(stderr).toContain("2 pass");
    expect(stderr).toContain("1 todo");
    expect({ exitCode, stderr }).toMatchObject({
      exitCode: 0,
      stderr: expect.stringContaining("0 fail"),
    });
  });

  test("should bound plan({wait:true}) by the test's own timeout instead of hanging", async () => {
    const { exitCode, stderr } = await runTests(["16b-plan-wait-timeout.js"]);
    expect(stderr).toContain("test timed out after 100ms");
    expect({ exitCode, stderr }).toMatchObject({
      exitCode: 1,
      stderr: expect.stringContaining("1 fail"),
    });
  });

  test("should fail the parent when a t.test() that fulfills plan({wait}) throws", async () => {
    const { exitCode, stderr } = await runTests(["24-plan-wait-late-subtest.js"]);
    // The error message from makeTestFailure — must not be satisfied by the
    // fixture's own source lines echoed in the failure context.
    expect(stderr).toContain("error: 1 subtest failed");
    expect(stderr).toContain("boom");
    expect({ exitCode, stderr }).toMatchObject({
      exitCode: 1,
      stderr: expect.stringContaining("1 fail"),
    });
  });

  test("should treat a failing expectFailure test as a pass", async () => {
    const { exitCode, stderr } = await runTests(["25-expect-failure.js"]);
    expect({ exitCode, stderr }).toMatchObject({
      exitCode: 0,
      stderr: expect.stringContaining("0 fail"),
    });
  });

  test("should fail an expectFailure test that passes", async () => {
    const { exitCode, stderr } = await runTests(["27-expect-failure-but-passes.js"]);
    expect(stderr).toContain("test was expected to fail but passed");
    expect({ exitCode, stderr }).toMatchObject({
      exitCode: 1,
      stderr: expect.stringContaining("1 fail"),
    });
  });

  test("should fail an expectFailure test whose error does not match the validator", async () => {
    const { exitCode, stderr } = await runTests(["29-expect-failure-mismatch.js"]);
    expect(stderr).toContain("the error did not match the expected validation");
    expect({ exitCode, stderr }).toMatchObject({
      exitCode: 1,
      stderr: expect.stringContaining("1 fail"),
    });
  });

  test("should inherit expectFailure into subtests", async () => {
    // Matches node v26.3.0: the subtest inherits the expectation and passes, so
    // the parent is the one that fails for not failing.
    const { exitCode, stderr } = await runTests(["28-expect-failure-inherited.js"]);
    expect(stderr).toContain("test was expected to fail but passed");
    expect({ exitCode, stderr }).toMatchObject({
      exitCode: 1,
      stderr: expect.stringContaining("1 fail"),
    });
  });

  test("should not run a skipped suite's callback", async () => {
    const { exitCode, stdout, stderr } = await runTests(["26-skipped-suite-body.js"]);
    expect(stdout).not.toContain("[suite body ran: skip-only]");
    // { skip: true, todo: true } is a skip in Node, so this body is skipped too.
    expect(stdout).not.toContain("[suite body ran: both-flags]");
    // A todo suite's callback does run.
    expect(stdout).toContain("[suite body ran: pending-only]");
    expect({ exitCode, stderr }).toMatchObject({
      exitCode: 0,
      stderr: expect.stringContaining("0 fail"),
    });
  });

  test("should reset the module-level mock tracker between --rerun-each iterations", async () => {
    // ESM entry: --rerun-each currently only re-evaluates ESM entry files.
    const { exitCode, stderr } = await runTests(["17-rerun-mock-reset.mjs"], {}, ["--rerun-each=3"]);
    expect(stderr).toContain("3 pass");
    expect({ exitCode, stderr }).toMatchObject({
      exitCode: 0,
      stderr: expect.stringContaining("0 fail"),
    });
  });

  test("should keep node's zero-delay mock interval semantics", async () => {
    const { exitCode, stderr } = await runTests(["18-mock-timers-interval-zero.js"]);
    expect(stderr).toContain("3 pass");
    expect({ exitCode, stderr }).toMatchObject({
      exitCode: 0,
      stderr: expect.stringContaining("0 fail"),
    });
  });

  test("should apply the plan option before beforeEach so a hook cannot snapshot a null plan", async () => {
    const { exitCode, stderr } = await runTests(["19-plan-option-order.js"]);
    expect(stderr).toContain("3 pass");
    expect({ exitCode, stderr }).toMatchObject({
      exitCode: 0,
      stderr: expect.stringContaining("0 fail"),
    });
  });

  test("should enforce a hook-level signal and install t.assert.ok separately", async () => {
    const { exitCode, stderr } = await runTests(["20-hook-signal-and-assert-ok.js"]);
    expect(stderr).toContain("2 pass");
    expect({ exitCode, stderr }).toMatchObject({
      exitCode: 0,
      stderr: expect.stringContaining("0 fail"),
    });
  });

  test("should let a registered ok assertion override the built-in one", async () => {
    const { exitCode, stderr } = await runTests(["21-register-ok.js"]);
    expect(stderr).toContain("2 pass");
    expect({ exitCode, stderr }).toMatchObject({
      exitCode: 0,
      stderr: expect.stringContaining("0 fail"),
    });
  });

  test("should gate a nested inline subtest on every ancestor suite's before hooks", async () => {
    const { exitCode, stderr } = await runTests(["22-nested-suite-before.js"]);
    expect(stderr).toContain("3 pass");
    expect({ exitCode, stderr }).toMatchObject({
      exitCode: 0,
      stderr: expect.stringContaining("0 fail"),
    });
  });

  test("should resolve the promise of a test that a name pattern filters out", async () => {
    const { exitCode, stderr } = await runTests(["23-filtered-test-promise.js"], {}, ["-t", "should resolve"]);
    expect(stderr).not.toContain("timed out");
    expect(stderr).toContain("1 pass");
    expect({ exitCode, stderr }).toMatchObject({
      exitCode: 0,
      stderr: expect.stringContaining("0 fail"),
    });
  });
});

function counts(stderr: string) {
  const result: Record<string, number> = {};
  for (const [, count, kind] of stderr.matchAll(/^ *(\d+) (pass|skip|todo|fail)$/gm)) result[kind] = Number(count);
  return result;
}

async function runTests(filenames: string[], env: Record<string, string> = {}, args: string[] = []) {
  const testPaths = filenames.map(filename => join(import.meta.dirname, "fixtures", filename));
  const {
    exited,
    stdout: stdoutStream,
    stderr: stderrStream,
  } = spawn({
    cmd: [bunExe(), "test", ...args, ...testPaths],
    env: { ...bunEnv, ...env },
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    exited,
    new Response(stdoutStream).text(),
    new Response(stderrStream).text(),
  ]);
  return { exitCode, stdout, stderr };
}

describe("node:test mock", () => {
  const { mock } = require("node:test");

  test("mock.getter accepts the (object, methodName, options) overload", () => {
    const obj = {
      get prop() {
        return "original";
      },
    };
    // Passing an options object in the implementation slot must not clobber
    // the getter flag.
    const getter = mock.getter(obj, "prop", {});
    expect(obj.prop).toBe("original");
    expect(getter.mock.callCount()).toBe(1);
    mock.restoreAll();
  });

  test("mock.setter accepts the (object, methodName, options) overload", () => {
    let stored = "";
    const obj = {
      set prop(v: string) {
        stored = v;
      },
    };
    const setter = mock.setter(obj, "prop", {});
    obj.prop = "x";
    expect(stored).toBe("x");
    expect(setter.mock.callCount()).toBe(1);
    mock.restoreAll();
  });

  test("mock.getter rejects getter: false", () => {
    const obj = {
      get prop() {
        return 1;
      },
    };
    expect(() => mock.getter(obj, "prop", { getter: false })).toThrow(
      expect.objectContaining({ code: "ERR_INVALID_ARG_VALUE" }),
    );
  });

  test("mock.method rejects getter and setter together", () => {
    const obj = {
      get prop() {
        return 1;
      },
      set prop(_v) {},
    };
    expect(() => mock.method(obj, "prop", { getter: true, setter: true })).toThrow(
      expect.objectContaining({ code: "ERR_INVALID_ARG_VALUE" }),
    );
  });

  test("mock.fn options.times reverts to the original after N calls", () => {
    const original = () => "original";
    const impl = () => "mocked";
    const fn = mock.fn(original, impl, { times: 2 });
    expect(fn()).toBe("mocked");
    expect(fn()).toBe("mocked");
    expect(fn()).toBe("original");
    expect(fn.mock.callCount()).toBe(3);
    mock.restoreAll();
  });

  test("mock.method options.times restores the method after N calls", () => {
    const obj = {
      value: 5,
      addOne() {
        return this.value + 1;
      },
    };
    mock.method(obj, "addOne", () => 100, { times: 1 });
    expect(obj.addOne()).toBe(100);
    expect(obj.addOne()).toBe(6);
    mock.restoreAll();
  });

  test("mock.fn options.times is validated", () => {
    expect(() => mock.fn(() => {}, { times: 0 })).toThrow(expect.objectContaining({ code: "ERR_OUT_OF_RANGE" }));
    expect(() => mock.fn(() => {}, { times: 1.5 })).toThrow(expect.objectContaining({ code: "ERR_OUT_OF_RANGE" }));
  });

  test("mock.restoreAll makes bare mock.fn mocks call their original again", () => {
    const fn = mock.fn(
      () => "original",
      () => "mocked",
    );
    expect(fn()).toBe("mocked");
    mock.restoreAll();
    expect(fn()).toBe("original");
  });
});

describe("node:test mock tracker semantics", () => {
  const { mock } = require("node:test");

  test("restoreAll keeps mocks associated; reset disassociates", () => {
    // mirrors observed node behavior exactly
    const f = mock.fn(
      () => "orig",
      () => "mocked",
    );
    expect(f()).toBe("mocked");
    mock.restoreAll();
    expect(f()).toBe("orig");
    // still tracked after restoreAll: reset() reverts a re-installed
    // implementation again
    f.mock.mockImplementation(() => "again");
    expect(f()).toBe("again");
    mock.reset();
    expect(f()).toBe("orig");
    // after reset() the context is disassociated: restoreAll no longer
    // touches it
    f.mock.mockImplementation(() => "post-reset");
    mock.restoreAll();
    expect(f()).toBe("post-reset");
    mock.reset();
  });

  test("queued once-implementations survive restoreAll like node", () => {
    const g = mock.fn(
      () => "g-orig",
      () => "g-mocked",
    );
    g.mock.mockImplementationOnce(() => "g-once", 1);
    mock.restoreAll();
    expect([g(), g(), g()]).toEqual(["g-orig", "g-once", "g-orig"]);
    mock.reset();
  });

  test("mock.method validates a non-object options argument", () => {
    const obj = {
      foo() {},
    };
    expect(() => mock.method(obj, "foo", () => {}, 5)).toThrow(
      expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" }),
    );
  });
});

test("the call record is pushed after the implementation runs, like node", () => {
  const { mock } = require("node:test");
  let inside = -1;
  const f = mock.fn(function () {
    inside = f.mock.callCount();
    return 1;
  });
  f();
  expect(inside).toBe(0);
  expect(f.mock.callCount()).toBe(1);
  mock.reset();
});

test("mock.property/mock.method survive a polluted Object.prototype", async () => {
  // The defineProperty descriptors must carry __proto__:null so an inherited
  // `value` on Object.prototype does not turn the accessor descriptor into a
  // TypeError (nodejs/node lib/internal/test_runner/mock/mock.js does this).
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        Object.prototype.value = 1;
        const { mock } = require("node:test");
        const obj = { x: 1, get p() { return 5; } };
        mock.property(obj, "x");
        mock.getter(obj, "p");
        console.log("ok");
      `,
    ],
    env: bunEnv,
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout: stdout.trim(), stderr, exitCode }).toMatchObject({ stdout: "ok", exitCode: 0 });
});
