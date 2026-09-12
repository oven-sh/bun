// A test that times out cancels the subtests it stopped waiting for, like
// Node v26.3.0's postRun(): the running one has its t.signal aborted and is
// failed as cancelled without waiting for its body (which never settles here),
// and the queued subtest and suites never start. The first test fails on
// purpose (the timeout); the second checks what it left behind.
// node-test.test.ts also runs this file through run(), which must report every
// cancelled node (the empty suite included) as a failure.
const { test, describe, it, before, after } = require("node:test");
const assert = require("node:assert");

const state = {
  running: undefined,
  runningSignalAborted: false,
  runningAbortedInAfterHook: undefined,
  afterEachSeen: [],
  queuedBodyRan: false,
  suiteHooksRan: [],
  suiteChildRan: false,
};

test("parent times out while a subtest is still running", { timeout: 20 }, async t => {
  t.afterEach(child =>
    state.afterEachSeen.push({ name: child.name, passed: child.passed, message: child.error.message }),
  );
  state.running = t.test("running", async child => {
    child.signal.addEventListener("abort", () => {
      state.runningSignalAborted = true;
    });
    child.after(() => {
      state.runningAbortedInAfterHook = child.signal.aborted;
    });
    // Ignores its signal on purpose: the runner must not need the body's
    // cooperation to finish a cancelled subtest and move on to its siblings.
    await new Promise(() => {});
  });
  t.test("queued", () => {
    state.queuedBodyRan = true;
  });
  describe("queued suite", () => {
    before(() => state.suiteHooksRan.push("before"));
    after(() => state.suiteHooksRan.push("after"));
    it("suite child", () => {
      state.suiteChildRan = true;
    });
  });
  describe("queued empty suite", () => {});
  await state.running;
});

test("the subtests the parent stopped waiting for were cancelled", async () => {
  // Aborted synchronously as the parent finished, before anything it left
  // behind has had a chance to settle.
  assert.strictEqual(state.runningSignalAborted, true);
  await state.running;
  // Node never starts the queued subtest and suite, so nothing of theirs can be
  // awaited; here their turns on the parent's chain come right behind the
  // running one's, entirely in microtasks, so one macrotask hop flushes them.
  await new Promise(resolve => setImmediate(resolve));
  assert.strictEqual(state.runningAbortedInAfterHook, true);
  assert.deepStrictEqual(state.afterEachSeen, [
    { name: "running", passed: false, message: "test did not finish before its parent and was cancelled" },
  ]);
  assert.strictEqual(state.queuedBodyRan, false);
  assert.deepStrictEqual(state.suiteHooksRan, []);
  assert.strictEqual(state.suiteChildRan, false);
});
