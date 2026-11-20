import { spawn, spawnSync } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, nodeExe, tempDir } from "harness";
import { join } from "node:path";

// A fixture that states what Node does is run on Node too. The reference is
// the Node version that bun reports: not any other `node` on PATH, and not
// the `node` shim that `bun run` puts there, which is bun.
const referenceNode = (() => {
  const node = nodeExe();
  if (!node) return null;
  const { stdout, exitCode } = spawnSync({
    cmd: [node, "-p", "process.versions.bun ? '' : process.versions.node"],
    env: bunEnv,
    stderr: "ignore",
  });
  return exitCode === 0 && stdout.toString().trim() === process.versions.node ? node : null;
})();

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
    // The message of the subtestsFailed error. The fixture's own source lines,
    // echoed in the failure context, must not satisfy this.
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

async function runTestsOnNode(filenames: string[]) {
  const testPaths = filenames.map(filename => join(import.meta.dirname, "fixtures", filename));
  await using proc = spawn({
    cmd: [referenceNode!, "--test", ...testPaths],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([proc.exited, proc.stdout.text(), proc.stderr.text()]);
  return { exitCode, stdout, stderr };
}

// The `error:` lines of 37-failure-output.js. `bun test` prints the value that a test threw.
const kFailureOutput = [
  "error: thrown by the test",
  "error: test failed",
  "error: plan expected 2 assertions but received 0",
  "error: test timed out after 5ms",
  "error: 1 subtest failed",
  "error: thrown by the child",
  "error: 1 subtest failed",
  "error: thrown by the hook",
  "error: test was expected to fail but passed",
  "error: cannot set plan more than once",
  "error: callback invoked multiple times",
  "error: 1 subtest failed",
  "error: test timed out after 5ms",
  "error: 1 subtest failed",
  "error: hook failed",
];

// The lines that a fixture prints when the process exits.
function seenLines(stdout: string) {
  return stdout.split("\n").filter(line => line.startsWith("SEEN "));
}

// Each of these tests starts one or two debug+ASAN bun processes, and the tests run at the same time: they get the
// same headroom as the tests of the largest fixtures above.
describe.concurrent("context.error", () => {
  // [fixture, tests that pass on bun, tests and subtests that pass on node]
  const onBothRuntimes: [string, number, number][] = [
    ["35-context-error.js", 10, 12],
    ["35b-failure-without-user-code.js", 3, 3],
    ["38-expect-failure-validator-input.js", 4, 4],
  ];

  test.each([...onBothRuntimes, ["35c-values-node-cannot-report.js", 2, 0]])(
    "%s passes",
    async (fixture, passes) => {
      const { exitCode, stderr } = await runTests([fixture]);
      expect(stderr).toContain(` ${passes} pass`);
      expect({ exitCode, stderr }).toMatchObject({ exitCode: 0, stderr: expect.stringContaining(" 0 fail") });
    },
    30_000,
  );

  test.skipIf(!referenceNode).each(onBothRuntimes)("%s passes on node", async (fixture, _, passes) => {
    const { exitCode, stdout } = await runTestsOnNode([fixture]);
    expect(stdout).toContain(`pass ${passes}`);
    expect({ exitCode, stdout }).toMatchObject({ exitCode: 0, stdout: expect.stringContaining("fail 0") });
  });

  // These two fixtures fail on purpose. Each prints what its hooks or its exit listener saw.
  const kSubtestRollup = [
    `SEEN {"passed":false,"code":"ERR_TEST_FAILURE","failureType":"subtestsFailed","message":"1 subtest failed","cause":"1 subtest failed"}`,
  ];
  const kTopLevelHooks = [
    `SEEN {"where":"suite","name":"throws","passed":false,"code":"ERR_TEST_FAILURE","failureType":"testCodeFailure","message":"boom","cause":"TypeError: boom"}`,
    `SEEN {"where":"file","name":"throws","passed":false,"code":"ERR_TEST_FAILURE","failureType":"testCodeFailure","message":"boom","cause":"TypeError: boom"}`,
    `SEEN {"where":"suite","name":"passes","passed":true}`,
    `SEEN {"where":"file","name":"passes","passed":true}`,
    `SEEN {"where":"suite","name":"fails as expected","passed":true,"code":"ERR_TEST_FAILURE","failureType":"testCodeFailure","message":"expected","cause":"Error: expected"}`,
    `SEEN {"where":"file","name":"fails as expected","passed":true,"code":"ERR_TEST_FAILURE","failureType":"testCodeFailure","message":"expected","cause":"Error: expected"}`,
    `SEEN {"where":"suite","name":"times out","passed":false,"code":"ERR_TEST_FAILURE","failureType":"testTimeoutFailure","message":"test timed out after 5ms","cause":"test timed out after 5ms"}`,
    `SEEN {"where":"file","name":"times out","passed":false,"code":"ERR_TEST_FAILURE","failureType":"testTimeoutFailure","message":"test timed out after 5ms","cause":"test timed out after 5ms"}`,
  ];
  const failingOnPurpose: [string, string[]][] = [
    ["36b-subtest-rollup.js", kSubtestRollup],
    ["36c-top-level-hooks.js", kTopLevelHooks],
  ];

  test.each(failingOnPurpose)(
    "%s: the hooks read node's error",
    async (fixture, seen) => {
      const { exitCode, stdout } = await runTests([fixture]);
      expect({ seen: seenLines(stdout), exitCode }).toEqual({ seen, exitCode: 1 });
    },
    30_000,
  );

  test.skipIf(!referenceNode).each(failingOnPurpose)(
    "%s: the hooks read the same error on node",
    async (fixture, seen) => {
      const { exitCode, stdout } = await runTestsOnNode([fixture]);
      expect({ seen: seenLines(stdout), exitCode }).toEqual({ seen, exitCode: 1 });
    },
  );

  test("bun test prints the thrown value, not the ERR_TEST_FAILURE error", async () => {
    const { exitCode, stderr } = await runTests(["37-failure-output.js"]);
    expect(stderr.match(/^error: .*$/gm)).toEqual(kFailureOutput);
    // The runner throws these two errors into the test. The printed stack has the frame of that call.
    for (const name of ["plan twice", "callback twice"]) {
      const report = stderr.slice(0, stderr.indexOf(`(fail) ${name}`));
      const frames = report.slice(report.lastIndexOf("\nerror: "));
      expect(frames).toMatch(/\n\s+at .*37-failure-output\.js:\d+:\d+/);
    }
    // A hook that times out has the failure type of a hook failure, as context.error has.
    expect(stderr).toContain(`error: test timed out after 5ms\n failureType: "hookFailed"`);
    expect(stderr).toContain(" 0 pass");
    expect({ exitCode, stderr }).toMatchObject({ exitCode: 1, stderr: expect.stringContaining(" 11 fail") });
  }, 30_000);

  test("bun test prints the failure type of a hook for each hook that times out", async () => {
    const { exitCode, stderr } = await runTests(["37b-hook-timeout-output.js"]);
    // The after hook of a suite in a test, then the before hook and the after hook of a top-level suite.
    expect(stderr.match(/^error: test timed out after 5ms\n failureType: "\w+"/gm)).toEqual([
      `error: test timed out after 5ms\n failureType: "hookFailed"`,
      `error: test timed out after 5ms\n failureType: "hookFailed"`,
      `error: test timed out after 5ms\n failureType: "hookFailed"`,
    ]);
    expect(exitCode).toBe(1);
  }, 30_000);

  describe("the error of each test:fail event of run()", () => {
    // One line for each failed test: name | code | failureType | message | has an own cause | cause
    async function failedOn(exe: string, fixtures: string[]) {
      using dir = tempDir("node-test-error-run", {
        "run.js": `
          const { run } = require("node:test");
          const describeValue = value => (value instanceof Error ? value.name + ": " + value.message : value);
          (async () => {
            const failed = [];
            for await (const { type, data } of run({ files: process.argv.slice(2) })) {
              if (type !== "test:fail" || data.details.type !== "test") continue;
              const { error } = data.details;
              const own = Object.prototype.hasOwnProperty.call(error, "cause");
              failed.push([data.name, error.code, error.failureType, error.message, own, describeValue(error.cause)].join(" | "));
            }
            console.log("FAILED " + JSON.stringify(failed.sort()));
          })();
        `,
      });
      await using proc = spawn({
        cmd: [exe, join(String(dir), "run.js"), ...fixtures.map(name => join(import.meta.dirname, "fixtures", name))],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      const line = stdout.split("\n").find(line => line.startsWith("FAILED "));
      const failed: string[] = line === undefined ? [] : JSON.parse(line.slice("FAILED ".length));
      return { failed, stderr, exitCode };
    }

    const comparedWithNode = ["35-context-error.js", "36b-subtest-rollup.js"];
    // run() on bun sends an event as JSON, so a thrown object that is not an Error arrives as an Error.
    const notCompared = ["throws an object", "throws an object that cannot print itself"];
    const compared = (failed: string[]) =>
      failed.filter(row => !notCompared.includes(row.slice(0, row.indexOf(" | "))));

    test("has the code, the failure type and the cause", async () => {
      const { failed, stderr, exitCode } = await failedOn(bunExe(), comparedWithNode);
      expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
      expect(failed).toContain("throws an error | ERR_TEST_FAILURE | testCodeFailure | boom | true | Error: boom");
      expect(failed).toContain("throws a string | ERR_TEST_FAILURE | testCodeFailure | a string | true | a string");
      expect(failed).toContain("throws undefined | ERR_TEST_FAILURE | testCodeFailure | undefined | true | ");
      expect(failed).toContain(
        "timeout | ERR_TEST_FAILURE | testTimeoutFailure | test timed out after 5ms | true | test timed out after 5ms",
      );
      expect(failed).toContain(
        "parent | ERR_TEST_FAILURE | subtestsFailed | 1 subtest failed | true | 1 subtest failed",
      );
    }, 30_000);

    test.skipIf(!referenceNode)(
      "is the same as on node",
      async () => {
        const [bun, node] = await Promise.all([
          failedOn(bunExe(), comparedWithNode),
          failedOn(referenceNode!, comparedWithNode),
        ]);
        expect({ failed: compared(node.failed), exitCode: node.exitCode }).toEqual({
          failed: compared(bun.failed),
          exitCode: 0,
        });
      },
      30_000,
    );

    test("a thrown symbol does not stop the report", async () => {
      const { failed, stderr, exitCode } = await failedOn(bunExe(), ["35c-values-node-cannot-report.js"]);
      expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
      expect(failed).toContain(
        "throws a symbol | ERR_TEST_FAILURE | testCodeFailure | Symbol(a symbol) | true | Error: Symbol(a symbol)",
      );
    }, 30_000);

    // The parent of run() makes the error of a file that exits with a failure, and of a file that it cancels.
    async function fileErrorsOn(exe: string, cases: ("fails" | "cancelled")[]) {
      using dir = tempDir("node-test-error-run-file", {
        "throws-at-load.js": `require("node:test"); throw new Error("thrown at load");`,
        "run.js": `
          const { run } = require("node:test");
          const file = require("node:path").join(__dirname, "throws-at-load.js");
          (async () => {
            const seen = [];
            for (const which of process.argv.slice(2)) {
              const signal = which === "cancelled" ? AbortSignal.abort() : undefined;
              for await (const { type, data } of run({ files: [file], signal })) {
                if (type !== "test:fail") continue;
                const { error } = data.details;
                const ownCause = Object.prototype.hasOwnProperty.call(error, "cause");
                const causeIsMessage = error.cause === error.message;
                seen.push({ code: error.code, failureType: error.failureType, ownCause, causeIsMessage });
              }
            }
            console.log("SEEN " + JSON.stringify(seen));
          })();
        `,
      });
      await using proc = spawn({
        cmd: [exe, join(String(dir), "run.js"), ...cases],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      const line = stdout.split("\n").find(line => line.startsWith("SEEN "));
      return { seen: line === undefined ? [] : JSON.parse(line.slice("SEEN ".length)), stderr, exitCode };
    }

    test("a file that fails or that is cancelled has its message as the cause", async () => {
      const { seen, stderr, exitCode } = await fileErrorsOn(bunExe(), ["fails", "cancelled"]);
      expect({ seen, stderr, exitCode }).toEqual({
        seen: [
          { code: "ERR_TEST_FAILURE", failureType: "testCodeFailure", ownCause: true, causeIsMessage: true },
          { code: "ERR_TEST_FAILURE", failureType: "cancelledByParent", ownCause: true, causeIsMessage: true },
        ],
        stderr: "",
        exitCode: 0,
      });
    }, 30_000);

    test.skipIf(!referenceNode)(
      "a file that fails has its message as the cause on node",
      async () => {
        const { seen, exitCode } = await fileErrorsOn(referenceNode!, ["fails"]);
        expect({ seen, exitCode }).toEqual({
          seen: [{ code: "ERR_TEST_FAILURE", failureType: "testCodeFailure", ownCause: true, causeIsMessage: true }],
          exitCode: 0,
        });
      },
      30_000,
    );
  });
});

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
