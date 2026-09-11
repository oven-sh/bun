// The `signal` option of a top-level suite, as in Node v26.3.0. A suite whose
// signal has aborted by the time its turn comes (before it was declared, or by
// an earlier test) fails with the reason and runs nothing: no hooks, no
// children, although its describe callback does run. A signal that aborts
// while the suite runs cancels the running child and the queued one, still
// runs the after hooks, and fails the suite with the reason; one aborted by
// the suite's own before hook still runs the remaining before hooks and the
// after hooks, and cancels every child without starting it; a falsy reason is
// reported as Node's own "The test was aborted". Five suites here fail on
// purpose; node-test.test.ts asserts the exact counts and the OBS markers.
// Differences from `node --test` with this file: a suite's own failure shows up
// as a failed hook of its describe block, the children of a suite that never
// started are skipped rather than listed one by one, and the running child is
// cancelled before the after hooks run rather than after.
const { describe, it, before, after, test } = require("node:test");

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
// A cancelled test's t.signal aborts; the sleep only bounds a runner that never
// cancels, so that such a runner reports the wrong outcome instead of hanging.
const untilCancelled = t =>
  Promise.race([new Promise(resolve => t.signal.addEventListener("abort", resolve)), sleep(200)]);

describe(
  "suite aborted before it was declared",
  { signal: AbortSignal.abort(new Error("aborted before declaration")) },
  () => {
    console.log("OBS pre-aborted suite callback ran");
    before(() => console.log("OBS pre-aborted suite before ran"));
    after(() => console.log("OBS pre-aborted suite after ran"));
    it("child of the pre-aborted suite", () => console.log("OBS pre-aborted suite child ran"));
  },
);

const abortedByEarlierTest = new AbortController();

test("aborts the next suite's signal before that suite runs", () => {
  abortedByEarlierTest.abort(new Error("aborted by an earlier test"));
});

describe("suite aborted before it ran", { signal: abortedByEarlierTest.signal }, () => {
  it("child of the suite aborted before it ran", () => console.log("OBS aborted-before-run suite child ran"));
});

const abortedWhileRunning = new AbortController();

describe("suite aborted while running", { signal: abortedWhileRunning.signal }, () => {
  after(suite => console.log("OBS after ran, suite signal aborted: " + suite.signal.aborted));

  it("finished before the abort", () => console.log("OBS first child ran"));

  it("running when the signal aborts", async t => {
    abortedWhileRunning.abort(new Error("aborted while running"));
    await untilCancelled(t);
    console.log("OBS running child settled, signal aborted: " + t.signal.aborted);
  });

  it("queued when the signal aborts", () => console.log("OBS queued child ran"));
});

const abortedByBeforeHook = new AbortController();

describe("suite aborted by its own before hook", { signal: abortedByBeforeHook.signal }, () => {
  before(() => {
    abortedByBeforeHook.abort(new Error("aborted by a before hook"));
    console.log("OBS before hook aborted the suite");
  });
  before(() => console.log("OBS second before hook still ran"));
  after(suite =>
    console.log("OBS after of the suite aborted by its hook ran, suite signal aborted: " + suite.signal.aborted),
  );

  it("child of the suite aborted by its hook", () => console.log("OBS child of the suite aborted by its hook ran"));
});

describe("suite aborted with a falsy reason", { signal: AbortSignal.abort(0) }, () => {
  it("child of the suite aborted with a falsy reason", () => console.log("OBS falsy-reason suite child ran"));
});

// The listener is removed once the suite is done; aborting afterwards changes
// nothing (node-test.test.ts only checks that this suite passes).
const neverAbortedInTime = new AbortController();

describe("suite whose signal does not abort while it runs", { signal: neverAbortedInTime.signal }, () => {
  it("passes", () => {});
});

test("aborting a finished suite's signal is a no-op", () => {
  neverAbortedInTime.abort(new Error("too late to matter"));
});
