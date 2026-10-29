import { spawn } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
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

  // Like the three tests at the top, the tests below spawn in parallel and get
  // the same headroom for a debug+ASAN `bun test` child.
  test.concurrent(
    "should stop the after and afterEach hooks of a test at the first one that fails",
    async () => {
      const { exitCode, stdout, stderr } = await runTests(["43-failing-hook-stops-later-hooks.js"]);
      // The lines that the hooks print under `node --test` (v26.3.0), in the same order.
      expect(stdout.split("\n").filter(line => line.startsWith("ran: "))).toEqual([
        "ran: after 1",
        "ran: inner afterEach 1",
        "ran: after, passed=false",
        "ran: suite after 1",
        "ran: after before todo",
        "ran: subtest after before todo",
        "ran: afterEach before skip",
      ]);
      expect(errorsAndVerdicts(stderr)).toEqual([
        "error: after 1 failed",
        "(fail) an after hook of a test fails",
        "error: inner afterEach 1 failed",
        "(fail) an afterEach hook fails > in a suite below > for a test with an after hook",
        "error: 1 subtest failed",
        "error: suite after 1 failed",
        "(fail) an after hook of an inline suite fails",
        "error: after before todo failed",
        "(fail) an after hook of a test fails, and the next one calls t.todo()",
        "error: 1 subtest failed",
        "error: subtest after before todo failed",
        "(fail) an after hook of a subtest fails, and the next one calls t.todo()",
        "error: afterEach before skip failed",
        "(fail) an afterEach hook fails, and the next one calls t.skip() > fails",
      ]);
      expect(exitCode).toBe(1);
    },
    30_000,
  );

  test.concurrent(
    "should fail a test for a failure that a run-time t.skip() or t.todo() does not cover",
    async () => {
      // Each test of the fixture makes `node --test` (v26.3.0) exit 1 by itself.
      // bun:test has one entry for a test and its subtests, so that entry fails
      // with the failure that Node counts.
      const { exitCode, stderr } = await runTests(["44-runtime-directive-lost-failures.js"]);
      expect(errorsAndVerdicts(stderr)).toEqual([
        "error: subtest",
        "(fail) a subtest fails, then its parent calls t.skip()",
        "error: subtest",
        "(fail) a subtest fails, then its parent calls t.todo()",
        "error: subtest",
        "(fail) a subtest fails, then its parent calls t.skip() and throws",
        "error: subtest",
        "(fail) a subtest calls the t.skip() of its parent and then fails",
        "error: first",
        "(fail) two subtests fail, then their parent calls t.skip()",
        "error: subtest",
        "(fail) a subtest that is not awaited fails after its parent called t.skip()",
        "error: subtest",
        "(fail) in a suite > a subtest fails, then its parent calls t.skip()",
        "error: 1 subtest failed",
        "error: 1 subtest failed",
        "error: sub-subtest",
        "error: sub-subtest",
        "(fail) a subtest fails below a subtest that calls t.skip()",
        "error: sub-subtest",
        "(fail) a subtest fails below a subtest that calls t.todo()",
        "error: sub-subtest",
        "(fail) a subtest fails below a subtest that calls t.todo(), and the top test calls t.skip()",
        "error: own",
        "(fail) a subtest fails below a subtest that calls t.todo(), and the top test throws",
        "error: suite hook",
        "(fail) an inline suite fails in its before hook, then the test calls t.skip()",
        "error: test hook",
        "(fail) a before hook of a test fails, then the test calls t.skip()",
        "error: subtest",
        "(fail) a before hook of a test calls t.skip(), then its subtest fails",
        "error: test hook",
        "(fail) a before hook that is created later fails a subtest that is behind another one",
        "error: test hook",
        "(fail) a before hook that is created later fails the subtest of a test that already has a hook",
        "error: 1 subtest failed",
        "error: subtest",
        "(fail) a subtest calls t.skip() and then throws",
        "error: 1 subtest failed",
        "error: plan expected 2 assertions but received 0",
        "(fail) a subtest calls t.skip() with an unmet plan",
        "error: 1 subtest failed",
        "error: after hook",
        "(fail) a subtest calls t.skip() and its after hook throws",
        "error: suite test",
        "(fail) a test of an inline suite calls t.skip() and then throws, and the top test calls t.skip()",
        "error: 1 subtest failed",
        "error: subtest",
        "(fail) a subtest calls t.skip() and throws, and the after hook of its parent reads t.passed",
        "error: test was expected to fail but passed",
        "(fail) a subtest that expects a failure passes, then its parent calls t.skip()",
        "error: test was expected to fail but passed",
        "(fail) test level expectFailure with subtests",
      ]);
      expect(exitCode).toBe(1);
    },
    30_000,
  );

  test.concurrent.each([
    ["by default", []],
    ["under --concurrent", ["--concurrent"]],
  ])(
    "should not fail a test for a failure that Node does not count, %s",
    async (_, args) => {
      // `node --test` (v26.3.0) exits 0 for the fixture. No error is printed.
      const { exitCode, stderr } = await runTests(["45-runtime-directive-suppressed-failures.js"], {}, args);
      expect(errorsAndVerdicts(stderr).sort()).toEqual(
        [
          "(pass) a subtest calls t.todo() and then throws",
          "(pass) a subtest calls t.todo() with an unmet plan",
          "(pass) a subtest calls t.todo() and its after hook throws",
          "(pass) an after hook of a subtest calls t.todo(), and the next one throws",
          "(todo) an after hook of a test calls t.todo(), and the next one throws",
          "(todo) an afterEach hook throws > and an after hook of the test calls t.todo()",
          "(pass) a subtest calls t.todo(), then its own subtest fails",
          "(pass) a test of an inline suite calls t.todo() and then throws",
          "(pass) an inline todo suite fails in its before hook",
          "(pass) a test of an inline describe.todo() suite fails",
          "(pass) test.todo() fails inside a test",
          "(pass) it.todo() fails inside an inline suite",
          "(todo) a test calls t.todo(), then its subtest fails",
          "(todo) a before hook of a test calls t.todo(), then its subtest fails",
          "(todo) a before hook of a test calls t.todo(), then a subtest of its subtest fails",
          "(todo) a before hook of a test calls t.todo(), then a subtest that is not awaited fails",
          "(pass) a before hook of a subtest calls t.todo(), then its own subtest fails",
          "(pass) a before hook of a test reads what the test has set at the call",
          "(todo) a before hook that a test creates after its subtest calls t.todo() and throws",
          "(skip) a before hook that a test creates after its subtest throws, then the test calls t.skip()",
          "(todo) a before hook that is created on the test above calls t.todo() and throws",
          "(skip) a test calls t.skip() and throws after its subtest called t.skip() and threw",
          "(skip) a todo subtest fails, then its parent calls t.skip()",
          "(skip) a subtest that expects a failure throws, then its parent calls t.skip()",
          "(skip) an inline suite that expects a failure throws, then the test calls t.skip()",
          "(pass) a test that expects a failure throws after its inline suite threw",
          "(pass) a skipped subtest expects a failure, and its own subtest calls t.skip() and throws",
          "(pass) a test throws its expected failure after its subtest called t.skip() and threw",
          "(pass) a subtest calls t.skip() and throws, then its parent calls todo() on it",
          "(todo) a subtest calls t.skip() and throws, and the after hook of its parent calls t.todo()",
          "(todo) a test calls t.todo() and throws while its subtest never settles",
          "(skip) a test calls t.skip() and throws while its todo subtest never settles",
          "(skip) a test calls t.skip() and throws while a test of its inline todo suite never settles",
          "(skip) a test with a timeout calls t.skip() and throws while its subtest never settles",
          "(skip) a test that called t.skip() times out while its subtest never settles",
          "(skip) a test with a timeout throws, and its after hook calls t.skip(), while its subtest never settles",
          "(skip) a test with a timeout throws, and its subtest calls the t.skip() of the test and never settles",
          "(todo) a test calls t.todo() and throws, and its after hook closes what its subtest reads",
          "(skip) a suite > whose test calls t.todo() and t.skip() and then throws",
          "(todo) a suite > whose test calls t.todo() and then throws",
        ].sort(),
      );
      expect(exitCode).toBe(0);
    },
    30_000,
  );

  test.concurrent(
    "should not need the global performance to run a test file",
    async () => {
      // `node --test` (v26.3.0) exits 0 for the fixture.
      const { exitCode, stderr } = await runTests(["51-without-global-performance.js"]);
      expect(errorsAndVerdicts(stderr)).toEqual([
        "(pass) a test with a timeout",
        "(pass) a subtest with a timeout",
        "(skip) a test with a timeout calls t.skip() and throws while its subtest never settles",
        "(pass) a before hook of a test fails, so its subtest never runs",
      ]);
      expect(exitCode).toBe(0);
    },
    30_000,
  );

  test.concurrent(
    "should report a todo test as todo under --todo for any failure below it",
    async () => {
      const { exitCode, stderr } = await runTests(["46-todo-scope-failures.js"], {}, ["--todo"]);
      expect(errorsAndVerdicts(stderr)).toEqual([
        "error: subtest",
        "(todo) a todo test whose subtest fails",
        "error: sub-subtest",
        "(todo) a test.todo() whose sub-subtest fails",
        "(skip) a test.todo() that calls t.skip() after its subtest failed",
        "error: subtest",
        "(todo) a todo test whose todo subtest fails",
        "error: subtest",
        "(todo) a todo test whose subtest calls t.todo() and throws",
        "error: subtest",
        "(todo) a todo test whose subtest calls t.skip() and throws",
        "error: subtest",
        "(todo) a todo suite > whose test has a failing subtest",
        "error: own",
        "(todo) a test.todo() that throws while its subtest never settles",
        // bun:test fails a todo test that has nothing left to fix.
        "(fail) a todo test whose subtests all pass",
      ]);
      expect(exitCode).toBe(1);
    },
    30_000,
  );

  test.concurrent(
    "should keep a failed subtest, and a pass on the second attempt, under --retry",
    async () => {
      const { exitCode, stderr } = await runTests(["47-retry-subtest-failures.js"], {}, ["--retry=1"]);
      // bun:test prints the error of each attempt.
      expect(errorsAndVerdicts(stderr)).toEqual([
        "error: subtest",
        "error: subtest",
        "(fail) a subtest fails, then its parent calls t.skip() (attempt 2)",
        "error: 1 subtest failed",
        "error: subtest",
        "error: 1 subtest failed",
        "error: subtest",
        "(fail) a subtest calls t.skip() and then throws (attempt 2)",
        "error: first attempt",
        "(pass) a test with a passing subtest throws on its first attempt only (attempt 2)",
      ]);
      expect(exitCode).toBe(1);
    },
    30_000,
  );

  test.concurrent(
    "should count a subtest that was not awaited when its parent hides its own failure",
    async () => {
      // Each test of the fixture makes `node --test` (v26.3.0) exit 1 by itself.
      const { exitCode, stderr } = await runTests(["48-queued-subtests.js"]);
      expect(errorsAndVerdicts(stderr)).toEqual([
        "error: subtest",
        "(fail) a test starts a failing subtest, calls t.skip() and throws",
        "error: subtest",
        "(fail) a test starts a failing subtest, calls t.todo() and throws",
        "error: sub-subtest",
        "(fail) a subtest starts a failing subtest, calls t.todo() and throws",
        "error: test was expected to fail but passed",
        "(fail) a test that expects a failure starts a subtest and throws",
        "error: subtest",
        "(fail) a test starts a subtest that fails on a later turn, calls t.skip() and throws",
        "error: sub-subtest",
        "(fail) a subtest starts a subtest that fails on a later turn, calls t.todo() and throws",
        "error: sub-subtest",
        "(fail) a subtest starts a subtest that fails on a later turn and throws, and its after hook calls t.todo()",
        "error: subtest",
        "(fail) a test throws, and the subtest that it started calls the t.skip() of the test and fails",
        "error: subtest",
        "(fail) an async test throws, and the subtest that it started calls the t.todo() of the test and fails",
        "error: third subtest",
        "(fail) subtests that were not awaited start more subtests on their parent, and the last one fails",
        "error: own",
        "(fail) a test throws while its subtest never settles",
      ]);
      expect(exitCode).toBe(1);
    },
    30_000,
  );

  test.concurrent(
    "should report each subtest and inline suite through run() as Node does",
    async () => {
      const { events, counts, success } = await runEvents("49-run-events.js");
      // The same events, in the same order, that node v26.3.0 reports for this fixture.
      // `rollup` marks a failure that is "N subtests failed" and not the test's own.
      const rows = events.map(({ type, name, kind, skip, todo, failureType }) => {
        return { type, name, kind, skip, todo, rollup: failureType === "subtestsFailed" || undefined };
      });
      expect(rows).toEqual([
        { type: "test:fail", name: "fails", kind: "test" },
        {
          type: "test:fail",
          name: "a subtest fails, then its parent calls t.skip()",
          kind: "test",
          skip: true,
          rollup: true,
        },
        { type: "test:fail", name: "skips then throws", kind: "test", skip: true },
        { type: "test:fail", name: "a subtest calls t.skip() and then throws", kind: "test", rollup: true },
        { type: "test:fail", name: "todo then throws", kind: "test", todo: true },
        { type: "test:pass", name: "a subtest calls t.todo() and then throws", kind: "test" },
        { type: "test:fail", name: "fails below", kind: "test" },
        { type: "test:fail", name: "marks itself todo", kind: "test", todo: true, rollup: true },
        { type: "test:pass", name: "a subtest fails below a subtest that calls t.todo()", kind: "test" },
        { type: "test:fail", name: "never runs", kind: "test" },
        { type: "test:pass", name: "never runs, expects a failure", kind: "test" },
        { type: "test:fail", name: "a before hook of a test fails", kind: "test" },
        { type: "test:fail", name: "member fails", kind: "test" },
        { type: "test:fail", name: "inline, member", kind: "suite", rollup: true },
        { type: "test:fail", name: "a test of an inline suite fails", kind: "test", rollup: true },
        { type: "test:pass", name: "member passes", kind: "test" },
        { type: "test:fail", name: "inline, after hook", kind: "suite" },
        { type: "test:fail", name: "an inline suite fails in its after hook", kind: "test", rollup: true },
        { type: "test:fail", name: "member fails first", kind: "test" },
        { type: "test:fail", name: "inline, after hook and member", kind: "suite" },
        {
          type: "test:fail",
          name: "an inline suite fails in its after hook and has a failing member",
          kind: "test",
          rollup: true,
        },
        { type: "test:fail", name: "todo member fails", kind: "test", todo: true },
        { type: "test:pass", name: "inline todo", kind: "suite", todo: true },
        {
          type: "test:pass",
          name: "an inline todo suite has a failing member, and the test calls t.skip()",
          kind: "test",
          skip: true,
        },
        { type: "test:fail", name: "inherits todo and fails", kind: "test", todo: true },
        { type: "test:pass", name: "a todo test whose subtest fails", kind: "test", todo: true },
        { type: "test:fail", name: "inherits todo and fails too", kind: "test", todo: true },
        { type: "test:pass", name: "a test.todo() whose subtest fails", kind: "test", todo: true },
        { type: "test:fail", name: "queued, fails", kind: "test" },
        {
          type: "test:fail",
          name: "a test starts a failing subtest, calls t.skip() and throws",
          kind: "test",
          skip: true,
        },
      ]);
      // The counts of node v26.3.0 too.
      const { tests, suites, passed, failed, cancelled, skipped, todo } = counts;
      expect({ tests, suites, passed, failed, cancelled, skipped, todo, success }).toEqual({
        tests: 26,
        suites: 4,
        passed: 4,
        failed: 11,
        cancelled: 0,
        skipped: 4,
        todo: 7,
        success: false,
      });
    },
    30_000,
  );

  test.concurrent.each(["46-todo-scope-failures.js", "45-runtime-directive-suppressed-failures.js"])(
    "should report a passing run() for failures that Node does not count, %s",
    async fixture => {
      // A run() child has no bun:test todo scope, and a todo suite or a suite that expects its failure fails no run.
      const { counts, success } = await runEvents(fixture);
      expect({ reported: counts.tests > 0, failed: counts.failed, cancelled: counts.cancelled, success }).toEqual({
        reported: true,
        failed: 0,
        cancelled: 0,
        success: true,
      });
    },
    30_000,
  );

  test.concurrent(
    "should not report a failed file through run() when a failed inline suite explains the exit code",
    async () => {
      const { events, counts, success } = await runEvents("50-run-suite-failure.js");
      // The events and the verdict of node v26.3.0: no event for the file, no failed test, and no success.
      expect(events.map(({ type, name, kind, skip }) => ({ type, name, kind, skip }))).toEqual([
        { type: "test:fail", name: "skips then throws", kind: "test", skip: true },
        { type: "test:fail", name: "inline", kind: "suite" },
        { type: "test:fail", name: "an inline suite fails below a test that calls t.skip()", kind: "test", skip: true },
      ]);
      const { tests, failed, skipped, suites } = counts;
      expect({ tests, failed, skipped, suites, success }).toEqual({
        tests: 2,
        failed: 0,
        skipped: 2,
        suites: 1,
        success: false,
      });
    },
    30_000,
  );
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

type RunEvent = { type: string; name: string; kind: string; failureType?: string; skip?: unknown; todo?: unknown };

// Runs one fixture through node:test's run() (fixtures/run-events.js) and
// returns its pass/fail events and the run-level summary.
async function runEvents(filename: string) {
  const fixture = (name: string) => join(import.meta.dirname, "fixtures", name);
  await using proc = Bun.spawn({
    cmd: [bunExe(), fixture("run-events.js"), fixture(filename)],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
  return JSON.parse(stdout.trim()) as { events: RunEvent[]; counts: Record<string, number>; success: boolean };
}

// The `error: ...` lines and the per-test verdict lines of a `bun test` report, in order.
function errorsAndVerdicts(stderr: string) {
  return stderr
    .split("\n")
    .filter(line => /^(error: |\((pass|fail|skip|todo)\) )/.test(line))
    .map(line => line.replace(/ \[[\d.]+ms\]$/, ""));
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
