// The `timeout` and `signal` options of inline suites (describe() inside a
// running test), as in Node v26.3.0: a suite that times out is failed by the
// timeout, its running child is cancelled, the children and nested suites
// queued behind it never run, and its after hooks still run (with the suite's
// own signal left alone: a timeout fails a suite, it does not abort it); a
// suite whose signal has already aborted is failed by the reason and runs
// nothing; one whose own before hook aborts the signal still runs its other
// hooks but starts no child. All three fail the test that owns them, so the
// first test fails on purpose ("3 subtests failed"); the last test checks what
// the suites left behind, and passes verbatim under `node --test` too.
// node-test.test.ts also runs this file through run(), which reports each
// suite's own error. One difference from Node there: Node drops the children
// of an aborted suite without reporting them, while here they report as
// cancelled.
const assert = require("node:assert");
const { test, describe, it, before, after } = require("node:test");

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
// A cancelled test's t.signal aborts; the sleep only bounds a runner that never
// cancels, so that such a runner reports the wrong outcome instead of hanging.
const untilCancelled = t =>
  Promise.race([new Promise(resolve => t.signal.addEventListener("abort", resolve)), sleep(200)]);

const seen = {
  hooks: [],
  runningChildSignalAborted: undefined,
  queuedChildRan: false,
  nestedChildRan: false,
  abortedSuiteChildRan: false,
  childOfSuiteAbortedByHookRan: false,
  childWithinTimeoutRan: false,
  childAfterSlowBeforeHookRan: false,
};

test("inline suites are stopped by their timeout or an aborted signal", () => {
  describe("times out", { timeout: 20 }, () => {
    before(() => seen.hooks.push("before"));
    after(suite => seen.hooks.push("after, suite signal aborted: " + suite.signal.aborted));
    it("running when the suite times out", async t => {
      await untilCancelled(t);
      seen.runningChildSignalAborted = t.signal.aborted;
    });
    it("queued when the suite times out", () => {
      seen.queuedChildRan = true;
    });
    describe("nested suite queued when the suite times out", () => {
      before(() => seen.hooks.push("nested before"));
      after(() => seen.hooks.push("nested after"));
      it("nested child", () => {
        seen.nestedChildRan = true;
      });
    });
  });

  describe("already aborted", { signal: AbortSignal.abort(new Error("inline abort reason")) }, () => {
    before(() => seen.hooks.push("aborted suite before"));
    after(() => seen.hooks.push("aborted suite after"));
    it("child of the aborted suite", () => {
      seen.abortedSuiteChildRan = true;
    });
  });

  const abortedByBeforeHook = new AbortController();
  describe("aborted by its own before hook", { signal: abortedByBeforeHook.signal }, () => {
    before(() => {
      abortedByBeforeHook.abort(new Error("inline suite aborted by a before hook"));
      seen.hooks.push("aborting before");
    });
    before(() => seen.hooks.push("second before after the abort"));
    after(suite => seen.hooks.push("after the abort, suite signal aborted: " + suite.signal.aborted));
    it("child of the suite aborted by its hook", () => {
      seen.childOfSuiteAbortedByHookRan = true;
    });
  });

  describe("within its timeout", { timeout: 30_000 }, () => {
    it("passes", () => {
      seen.childWithinTimeoutRan = true;
    });
  });
});

// Node arms the suite's stop after its before hooks, so they do not count
// against the timeout. Had the stop been armed before the hook, its shorter
// timer would have fired during the hook and the child would have been
// cancelled without ever starting, failing this test as well.
test("an inline suite's before hooks do not count against its timeout", () => {
  describe("before hook outlasts the timeout", { timeout: 1000 }, () => {
    before(() => sleep(1100));
    it("runs after the slow before hook", () => {
      seen.childAfterSlowBeforeHookRan = true;
    });
  });
});

test("what the stopped inline suites left behind", () => {
  // Each test above waited for its suites before it finished.
  assert.deepStrictEqual(seen, {
    hooks: [
      "before",
      "after, suite signal aborted: false",
      "aborting before",
      "second before after the abort",
      "after the abort, suite signal aborted: true",
    ],
    runningChildSignalAborted: true,
    queuedChildRan: false,
    nestedChildRan: false,
    abortedSuiteChildRan: false,
    childOfSuiteAbortedByHookRan: false,
    childWithinTimeoutRan: true,
    childAfterSlowBeforeHookRan: true,
  });
});
