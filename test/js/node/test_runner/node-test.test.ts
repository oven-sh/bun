import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { join } from "node:path";
import hookOrder from "./fixtures/02-hooks.json";

const fixturesDir = join(import.meta.dirname, "fixtures");

// `report` lines for the two fixtures that more than one test runs.
const harnessReport = [
  "01-harness.js:",
  "(pass) test() is a function",
  "(pass) describe() is a function",
  "(pass) TestContext > <exists>",
  "(pass) TestContext > name",
  "(pass) TestContext > filePath",
  "(pass) TestContext > signal",
  "(pass) TestContext > assert",
  "(pass) TestContext > diagnostic()",
  "(pass) TestContext > before()",
  "(pass) TestContext > after()",
  "(pass) TestContext > beforeEach()",
  "(pass) TestContext > afterEach()",
  "(pass) TestContext > test()",
  "(pass) before() is a function",
  "(pass) after() is a function",
  "(pass) beforeEach() is a function",
  "(pass) afterEach() is a function",
  "(pass) test > test()",
  "(pass) test > it()",
  "(pass) test > skip()",
  "(pass) test > todo()",
  "(pass) test > only()",
  "(pass) test > describe()",
  "(pass) test > suite()",
  "(pass) describe > <exists>",
  "(pass) describe > skip()",
  "(pass) describe > todo()",
  "(pass) describe > only()",
  "(pass) describe 1 > name is correct",
  "(pass) describe 1 > fullName is correct",
  "(pass) describe 1 > describe 2 > name is correct",
  "(pass) describe 1 > describe 2 > fullName is correct",
];
const hooksReport = [
  "02-hooks.js:",
  "(pass) execution order > test 1",
  "(pass) execution order > describe 1 > test 2",
  "(pass) execution order > describe 1 > describe 2 > test 3",
];

// Every test in here spawns its own `bun test` child over read-only fixtures.
describe.concurrent("node:test", () => {
  test("should run basic tests", async () => {
    const { report, summary, exitCode, stderr } = await runTests(["01-harness.js"]);
    expect(report).toEqual(harnessReport);
    expect(summary).toEqual({ pass: 32, fail: 0, tests: 32, files: 1 });
    expect(exitCode, stderr).toBe(0);
  });

  test("should run hooks in the right order", async () => {
    const { stdoutLines, report, summary, exitCode, stderr } = await runTests(["02-hooks.js"]);
    // The fixture's last after() prints every hook and test it recorded, in order.
    expect(stdoutLines).toEqual(hookOrder.node);
    expect(report).toEqual(hooksReport);
    expect(summary).toEqual({ pass: 3, fail: 0, tests: 3, files: 1 });
    expect(exitCode, stderr).toBe(0);
  });

  test("should run tests with different variations", async () => {
    const { report, summary, exitCode, stderr } = await runTests(["03-test-variations.js"]);
    expect(report).toEqual([
      "03-test-variations.js:",
      "(pass) <anonymous>",
      "(pass) test with name and callback",
      "(pass) test with name, options, and callback",
      "(pass) <anonymous>",
      "(pass) testWithFunctionName",
      "(pass) <anonymous>",
      "(pass) describe with name and callback > nested test",
      "(pass) describe with name, options, and callback > nested test",
      "(skip) skipped test",
      "(skip) skipped test with options",
      "(todo) todo test",
      "(todo) todo test with options",
    ]);
    expect(summary).toEqual({ pass: 8, skip: 2, todo: 2, fail: 0, tests: 12, files: 1 });
    expect(exitCode, stderr).toBe(0);
  });

  test("should run async tests", async () => {
    const { report, summary, exitCode, stderr } = await runTests(["04-async-tests.js"]);
    expect(report).toEqual([
      "04-async-tests.js:",
      "(pass) test with an async function",
      "(pass) test with an async function that delays",
      "(pass) nested tests > nested test with an async function",
      "(pass) nested tests > nested test with an async function that delays",
    ]);
    expect(summary).toEqual({ pass: 4, fail: 0, tests: 4, files: 1 });
    expect(exitCode, stderr).toBe(0);
  });

  test("should run all tests from multiple files", async () => {
    const { stdoutLines, report, summary, exitCode, stderr } = await runTests(["01-harness.js", "02-hooks.js"]);
    expect(stdoutLines).toEqual(hookOrder.node);
    expect(report).toEqual([...harnessReport, ...hooksReport]);
    expect(summary).toEqual({ pass: 35, fail: 0, tests: 35, files: 2 });
    expect(exitCode, stderr).toBe(0);
  });

  test("should run test() and describe() called inside another test() as subtests", async () => {
    const { stdoutLines, report, summary, exitCode, stderr } = await runTests(["05-test-in-test.js"]);
    // Printed from a t.after() hook, so this also proves the hook ran.
    expect(stdoutLines).toEqual(["subtest order: awaited, unawaited, inner"]);
    expect(report).toEqual([
      "05-test-in-test.js:",
      "(pass) t.test() runs subtests inline and returns a promise",
      "(pass) test() and describe() called inside a running test become subtests",
    ]);
    expect(summary).toEqual({ pass: 2, fail: 0, tests: 2, files: 1 });
    expect(exitCode, stderr).toBe(0);
  });

  test("should run before hooks created on a running test once and validate hook options", async () => {
    const { report, summary, exitCode, stderr } = await runTests(["06-hook-semantics.js"]);
    expect(report).toEqual([
      "06-hook-semantics.js:",
      "(pass) t.before() registered on a running test runs exactly once",
      "(pass) before() registered inside a running test runs exactly once",
      "(pass) hook options are validated",
      "(pass) mock once registries never call user-patched Map.prototype methods",
    ]);
    expect(summary).toEqual({ pass: 4, fail: 0, tests: 4, files: 1 });
    expect(exitCode, stderr).toBe(0);
  });

  test("should fail tests whose hooks, bodies, or inline suite callbacks fail", async () => {
    const { stdoutLines, report, summary, exitCode, stderr } = await runTests(["07-failing-hooks.js"]);
    // The subtest after the failing before hook must not run its body (Node).
    expect(stdoutLines).toEqual(["SUB_BODY_RAN=false"]);
    // Each (fail) line is preceded by the error(s) that failed it.
    expect(report).toEqual([
      "07-failing-hooks.js:",
      "error: test failed",
      "(fail) a test body that rejects with undefined fails",
      "error: passed a callback but also returned a Promise",
      "(fail) an async function with a done callback fails",
      "error: callback invoked multiple times",
      "(fail) a done callback invoked twice fails",
      "error: passed a callback but also returned a Promise",
      "(fail) a done callback called from a returned promise still fails",
      "error: 1 subtest failed",
      "error: after hook boom",
      "(fail) an inline suite whose after hook fails fails the test",
      "error: passed a callback but also returned a Promise",
      "(fail) an async before hook with a done callback fails the test",
      "error: 1 subtest failed",
      "error: async describe boom",
      "(fail) an async inline describe callback rejection fails the test",
      "error: 1 subtest failed",
      "error: inline suite before hook failed",
      "(fail) an inline suite whose before hook fails fails the test",
      "error: test timed out after 1ms",
      "(fail) a before hook that exceeds its timeout fails the test",
      "error: boom",
      "(fail) a subtest created after its parent before hook failed does not run",
    ]);
    expect(summary).toEqual({ pass: 0, fail: 10, tests: 10, files: 1 });
    expect(exitCode, stderr).toBe(1);
  });

  test("should support done callbacks in tests and hooks", async () => {
    const { report, summary, exitCode, stderr } = await runTests(["10-done-callbacks.js"]);
    expect(report).toEqual([
      "10-done-callbacks.js:",
      "(pass) file-level hooks with done callbacks ran first",
      "(pass) t.beforeEach with a done callback applies to subtests",
    ]);
    expect(summary).toEqual({ pass: 2, fail: 0, tests: 2, files: 1 });
    expect(exitCode, stderr).toBe(0);
  });

  const runtimeTodoReport = [
    "12-runtime-todo-and-mock-timers.js:",
    "(todo) a runtime t.todo() suppresses a later failure",
    "(skip) a runtime t.skip() suppresses a later failure",
    "(pass) an inline describe.todo() with a failing child does not fail the test",
    "(pass) an inline describe with todo: true and a failing child does not fail the test",
    "(pass) t.waitFor uses real timers while mock timers are enabled",
  ];

  test("should count runtime t.todo()/t.skip() as todo/skip and keep runner timers real under mock timers", async () => {
    const { report, summary, exitCode, stderr } = await runTests(["12-runtime-todo-and-mock-timers.js"]);
    expect(report).toEqual(runtimeTodoReport);
    expect(summary).toEqual({ pass: 3, skip: 1, todo: 1, fail: 0, tests: 5, files: 1 });
    expect(exitCode, stderr).toBe(0);
  });

  test("should count runtime t.todo()/t.skip() as todo/skip under --concurrent too", async () => {
    // markCurrentResult's microtask-drain fallback could not name a sequence
    // inside a concurrent group, so the skip/todo mark was dropped and both
    // tests were reported as pass.
    const { report, summary, exitCode, stderr } = await runTests(["12-runtime-todo-and-mock-timers.js"], {}, [
      "--concurrent",
    ]);
    // --concurrent reports tests in completion order.
    expect(report.toSorted()).toEqual(runtimeTodoReport.toSorted());
    expect(summary).toEqual({ pass: 3, skip: 1, todo: 1, fail: 0, tests: 5, files: 1 });
    expect(exitCode, stderr).toBe(0);
  });

  test("should run todo bodies under --todo instead of registering an empty function", async () => {
    const { report, summary, exitCode, stderr } = await runTests(["13-todo-bodies.js"], {}, ["--todo"]);
    // The errors prove that both todo bodies ran.
    expect(report).toEqual([
      "13-todo-bodies.js:",
      "error: expected todo failure",
      "(todo) a todo body runs and may fail",
      "error: expected todo failure too",
      "(todo) a todo option body runs and may fail",
      "(pass) sibling test still passes",
    ]);
    expect(summary).toEqual({ pass: 1, todo: 2, fail: 0, tests: 3, files: 1 });
    expect(exitCode, stderr).toBe(0);
  });

  test("should forward Infinity and finite timeouts so they override the runner default", async () => {
    const { report, summary, exitCode, stderr } = await runTests(["11-timeout-overrides.js"], {}, ["--timeout", "100"]);
    expect(report).toEqual([
      "11-timeout-overrides.js:",
      "(pass) an Infinity timeout overrides the runner default",
      "(pass) a finite timeout larger than the runner default is honored",
    ]);
    expect(summary).toEqual({ pass: 2, fail: 0, tests: 2, files: 1 });
    expect(exitCode, stderr).toBe(0);
  });

  test("should not leak file-level beforeEach hooks across files in one process", async () => {
    const { report, summary, exitCode, stderr } = await runTests(["14-root-hooks-a.js", "14-root-hooks-b.js"]);
    expect(report).toEqual([
      "14-root-hooks-a.js:",
      "(pass) file A runs its own file-level beforeEach and sees its own registrations",
      "14-root-hooks-b.js:",
      "(pass) first test in file B",
      "(pass) file A's file-level beforeEach and custom assertion did not leak into file B",
      "(pass) module-scope registrations from this file survive and capture the true original",
    ]);
    expect(summary).toEqual({ pass: 4, fail: 0, tests: 4, files: 2 });
    expect(exitCode, stderr).toBe(0);
  });

  test("should treat only as a no-op instead of using bun:test's CI-banned only()", async () => {
    // bun:test's only() only throws when CI is set; pin the precondition.
    const { report, summary, exitCode, stderr } = await runTests(["08-only-no-op.js"], { CI: "1" });
    expect(report).toEqual([
      "08-only-no-op.js:",
      "(pass) only-marked test runs",
      "(pass) sibling of an only-marked test also runs",
      "(pass) only-marked suite runs > test inside an only-marked suite",
      "(pass) only is a no-op without --test-only",
    ]);
    expect(summary).toEqual({ pass: 4, fail: 0, tests: 4, files: 1 });
    expect(exitCode, stderr).toBe(0);
  });

  test("should serialize inline suites and await async describe callbacks like node", async () => {
    const { report, summary, exitCode, stderr } = await runTests(["09-inline-suites.js"]);
    expect(report).toEqual([
      "09-inline-suites.js:",
      "(pass) inline suite children run after previously scheduled subtests",
      "(pass) an async inline describe callback is awaited before the suite finishes",
      "(pass) early inline-suite child waits for the async describe callback to settle",
    ]);
    expect(summary).toEqual({ pass: 3, fail: 0, tests: 3, files: 1 });
    expect(exitCode, stderr).toBe(0);
  });

  test("should expose the body outcome to afterEach and workerId to the context", async () => {
    const { report, summary, exitCode, stderr } = await runTests(["15-outcome-in-hooks.js"]);
    expect(report).toEqual([
      "15-outcome-in-hooks.js:",
      "(pass) afterEach sees passed=true, error=null for a passing subtest",
      "(pass) afterEach sees passed=false and the thrown error for a failing subtest",
      "(pass) workerId reads NODE_TEST_WORKER_ID",
    ]);
    expect(summary).toEqual({ pass: 3, fail: 0, tests: 3, files: 1 });
    expect(exitCode, stderr).toBe(0);
  });

  test("should capture plan at first t.assert access and resolve subtests started after their parent finished", async () => {
    const { report, summary, exitCode, stderr } = await runTests(["16-plan-and-late-subtest.js"]);
    expect(report).toEqual([
      "16-plan-and-late-subtest.js:",
      "(todo) plan capture at first t.assert access > assert-before-plan",
      "(pass) plan capture at first t.assert access > verify assert-before-plan failed with 0/2",
      "(pass) late subtest after parent finished",
    ]);
    expect(summary).toEqual({ pass: 2, todo: 1, fail: 0, tests: 3, files: 1 });
    expect(exitCode, stderr).toBe(0);
  });

  test("should bound plan({wait:true}) by the test's own timeout instead of hanging", async () => {
    const { report, summary, exitCode, stderr } = await runTests(["16b-plan-wait-timeout.js"]);
    expect(report).toEqual([
      "16b-plan-wait-timeout.js:",
      "error: test timed out after 100ms",
      "(fail) wait:true bounded by test timeout",
    ]);
    expect(summary).toEqual({ pass: 0, fail: 1, tests: 1, files: 1 });
    expect(exitCode, stderr).toBe(1);
  });

  test("should fail the parent when a t.test() that fulfills plan({wait}) throws", async () => {
    const { report, summary, exitCode, stderr } = await runTests(["24-plan-wait-late-subtest.js"]);
    // "1 subtest failed" is makeTestFailure's message for the parent, "boom"
    // is the subtest's own error.
    expect(report).toEqual(["24-plan-wait-late-subtest.js:", "error: 1 subtest failed", "error: boom", "(fail) p"]);
    expect(summary).toEqual({ pass: 0, fail: 1, tests: 1, files: 1 });
    expect(exitCode, stderr).toBe(1);
  });

  test("should treat a failing expectFailure test as a pass", async () => {
    const { report, summary, exitCode, stderr } = await runTests(["25-expect-failure.js"]);
    expect(report).toEqual([
      "25-expect-failure.js:",
      "(pass) a failing body is the expected outcome",
      "(pass) a label is allowed in place of true",
      "(pass) a RegExp validates the error",
      "(pass) an object may carry both label and match",
    ]);
    expect(summary).toEqual({ pass: 4, fail: 0, tests: 4, files: 1 });
    expect(exitCode, stderr).toBe(0);
  });

  test("should fail an expectFailure test that passes", async () => {
    const { report, summary, exitCode, stderr } = await runTests(["27-expect-failure-but-passes.js"]);
    expect(report).toEqual([
      "27-expect-failure-but-passes.js:",
      "error: test was expected to fail but passed",
      "(fail) passes unexpectedly",
    ]);
    expect(summary).toEqual({ pass: 0, fail: 1, tests: 1, files: 1 });
    expect(exitCode, stderr).toBe(1);
  });

  test("should fail an expectFailure test whose error does not match the validator", async () => {
    const { report, summary, exitCode, stderr } = await runTests(["29-expect-failure-mismatch.js"]);
    // The validator's AssertionError follows, and its `actual` echoes the
    // thrown error.
    expect(report).toEqual([
      "29-expect-failure-mismatch.js:",
      "error: The test failed, but the error did not match the expected validation",
      "AssertionError: The input did not match the regular expression /expected message/. Input:",
      "error: a different message entirely",
      "(fail) the thrown error does not satisfy the validator",
    ]);
    expect(summary).toEqual({ pass: 0, fail: 1, tests: 1, files: 1 });
    expect(exitCode, stderr).toBe(1);
  });

  test("should inherit expectFailure into subtests", async () => {
    // Matches node v26.3.0: the subtest inherits the expectation and passes, so
    // the parent is the one that fails for not failing.
    const { report, summary, exitCode, stderr } = await runTests(["28-expect-failure-inherited.js"]);
    expect(report).toEqual([
      "28-expect-failure-inherited.js:",
      "error: test was expected to fail but passed",
      "(fail) expectFailure is inherited by subtests",
    ]);
    expect(summary).toEqual({ pass: 0, fail: 1, tests: 1, files: 1 });
    expect(exitCode, stderr).toBe(1);
  });

  test("should not run a skipped suite's callback", async () => {
    const { stdoutLines, report, summary, exitCode, stderr } = await runTests(["26-skipped-suite-body.js"]);
    // Neither the { skip: true } body nor the { skip: true, todo: true } body
    // may print ({ skip, todo } is a skip in Node). A todo suite's callback does run.
    expect(stdoutLines).toEqual(["[suite body ran: pending-only]"]);
    expect(report).toEqual(["26-skipped-suite-body.js:", "(pass) sanity"]);
    expect(summary).toEqual({ pass: 1, fail: 0, tests: 1, files: 1 });
    expect(exitCode, stderr).toBe(0);
  });

  test("should reset the module-level mock tracker between --rerun-each iterations", async () => {
    // ESM entry: --rerun-each currently only re-evaluates ESM entry files.
    const { report, summary, exitCode, stderr } = await runTests(["17-rerun-mock-reset.mjs"], {}, ["--rerun-each=3"]);
    expect(report).toEqual([
      "17-rerun-mock-reset.mjs: (run #1)",
      "(pass) module-scope mock.method captured the real original across reruns",
      "17-rerun-mock-reset.mjs: (run #2)",
      "(pass) module-scope mock.method captured the real original across reruns",
      "17-rerun-mock-reset.mjs: (run #3)",
      "(pass) module-scope mock.method captured the real original across reruns",
    ]);
    expect(summary).toEqual({ pass: 3, fail: 0, tests: 3, files: 1 });
    expect(exitCode, stderr).toBe(0);
  });

  test("should keep node's zero-delay mock interval semantics", async () => {
    const { report, summary, exitCode, stderr } = await runTests(["18-mock-timers-interval-zero.js"]);
    expect(report).toEqual([
      "18-mock-timers-interval-zero.js:",
      "(pass) setInterval(fn, 0) re-fires within one tick until cleared",
      "(pass) runAll() drains a zero-delay interval that clears itself",
      "(pass) setTimeout(fn, 0) still fires once on tick(0)",
    ]);
    expect(summary).toEqual({ pass: 3, fail: 0, tests: 3, files: 1 });
    expect(exitCode, stderr).toBe(0);
  });

  test("should apply the plan option before beforeEach so a hook cannot snapshot a null plan", async () => {
    const { report, summary, exitCode, stderr } = await runTests(["19-plan-option-order.js"]);
    expect(report).toEqual([
      "19-plan-option-order.js:",
      "(pass) the plan option survives a beforeEach that touches t.assert",
      "(pass) the plan option is already set inside beforeEach",
      "(pass) a zero plan option installs no plan",
    ]);
    expect(summary).toEqual({ pass: 3, fail: 0, tests: 3, files: 1 });
    expect(exitCode, stderr).toBe(0);
  });

  test("should enforce a hook-level signal and install t.assert.ok separately", async () => {
    const { report, summary, exitCode, stderr } = await runTests(["20-hook-signal-and-assert-ok.js"]);
    expect(report).toEqual([
      "20-hook-signal-and-assert-ok.js:",
      "(pass) a hook-level signal aborts the hook and fails the owning subtest",
      "(pass) t.assert.ok is installed separately and still counts toward the plan",
    ]);
    expect(summary).toEqual({ pass: 2, fail: 0, tests: 2, files: 1 });
    expect(exitCode, stderr).toBe(0);
  });

  test("should let a registered ok assertion override the built-in one", async () => {
    const { report, summary, exitCode, stderr } = await runTests(["21-register-ok.js"]);
    expect(report).toEqual([
      "21-register-ok.js:",
      "(pass) a registered ok overrides the built-in one",
      "(pass) a registered ok still counts toward the plan",
    ]);
    expect(summary).toEqual({ pass: 2, fail: 0, tests: 2, files: 1 });
    expect(exitCode, stderr).toBe(0);
  });

  test("should gate a nested inline subtest on every ancestor suite's before hooks", async () => {
    const { report, summary, exitCode, stderr } = await runTests(["22-nested-suite-before.js"]);
    expect(report).toEqual([
      "22-nested-suite-before.js:",
      "(pass) a nested test is gated on the outer suite's async before hook",
      "(pass) a nested test is gated on the owning test's before hook too",
      "(pass) an outer suite's throwing before hook fails the test without running x",
    ]);
    expect(summary).toEqual({ pass: 3, fail: 0, tests: 3, files: 1 });
    expect(exitCode, stderr).toBe(0);
  });

  test("should resolve the promise of a test that a name pattern filters out", async () => {
    const { report, summary, exitCode, stderr } = await runTests(["23-filtered-test-promise.js"], {}, [
      "-t",
      "should resolve",
    ]);
    // If that promise never settled, the awaiting test would time out and
    // `report` would carry the timeout error and a (fail) line instead.
    expect(report).toEqual([
      "23-filtered-test-promise.js:",
      "(pass) should resolve the promise of a name-pattern-filtered test",
    ]);
    expect(summary).toEqual({ pass: 1, "filtered out": 1, fail: 0, tests: 1, files: 1 });
    expect(exitCode, stderr).toBe(0);
  });
});

/**
 * Runs `bun test` over the given fixtures in one child process. Next to the raw
 * `stdout`/`stderr` it returns the parts of them that do not depend on timings
 * or source locations:
 *
 * - `stdoutLines`: what the fixtures themselves printed.
 * - `report`: each file header, `error: ...` / `SomeError: ...` message,
 *   unhandled-error banner and `(pass|fail|skip|todo)` result line from stderr,
 *   in order. An error precedes the result it failed.
 * - `summary`: the pass/skip/todo/fail/error counters bun printed at the end,
 *   keyed by their label, plus the totals from `Ran N tests across M files`.
 */
async function runTests(filenames: string[], env: Record<string, string> = {}, args: string[] = []) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", ...args, ...filenames.map(filename => join(fixturesDir, filename))],
    // Keeps the file headers bun prints down to the bare fixture name, and
    // keeps the repo's bunfig.toml preload out of the child.
    cwd: fixturesDir,
    env: { ...bunEnv, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const stdoutLines = stdout.split(/\r?\n/).filter(line => line !== "" && !line.startsWith("bun test v"));

  const report: string[] = [];
  for (const line of stderr.split(/\r?\n/)) {
    if (
      /^[\w.-]+\.m?js:( \(run #\d+\))?$/.test(line) ||
      /^([A-Z]\w*)?[Ee]rror: /.test(line) ||
      line.startsWith("# Unhandled error")
    ) {
      report.push(line);
    } else if (/^\((pass|fail|skip|todo)\) /.test(line)) {
      report.push(line.replace(/\s\[[\d.]+\s?m?s\]$/, ""));
    }
  }

  const summary: Record<string, number> = {};
  for (const [, count, label] of stderr.matchAll(/^ +(\d+) (pass|skip|todo|fail|filtered out|errors?)\r?$/gm)) {
    summary[label] = Number(count);
  }
  const ran = stderr.match(/^Ran (\d+) tests? across (\d+) files?\. /m);
  if (ran) {
    summary.tests = Number(ran[1]);
    summary.files = Number(ran[2]);
  }

  return { exitCode, stdout, stderr, stdoutLines, report, summary };
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
