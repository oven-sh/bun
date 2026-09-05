// t.signal and the test-level `signal` option, as in Node v26.3.0. The first
// six tests pass; the three at the bottom fail on purpose, and
// node-test.test.ts asserts the exact counts plus the OBS markers on stdout.
const { test, describe } = require("node:test");
const assert = require("node:assert");

// Settles only once the runner aborts the test's own signal. A runner that
// never aborts it leaves the body pending, which the timeout/abort being
// tested turns into an observable failure instead of a hang.
const untilAborted = t => new Promise(resolve => t.signal.addEventListener("abort", resolve));

test("t.signal aborts when the test times out, before its after hooks run", async t => {
  let abortEvents = 0;
  let abortedInAfterHook;
  let seen;
  t.afterEach(child => {
    seen = { passed: child.passed, message: child.error.message };
  });
  // todo keeps the deliberate timeout from failing this test.
  await t.test("times out", { todo: true, timeout: 10 }, async child => {
    child.signal.addEventListener("abort", () => abortEvents++);
    child.after(() => {
      abortedInAfterHook = child.signal.aborted;
    });
    await untilAborted(child);
  });
  assert.strictEqual(abortEvents, 1);
  assert.strictEqual(abortedInAfterHook, true);
  assert.deepStrictEqual(seen, { passed: false, message: "test timed out after 10ms" });
});

test("t.signal aborts once a test is over, but only after its after hooks", async t => {
  let signal;
  let abortedInAfterHook;
  await t.test("passes", child => {
    signal = child.signal;
    assert.strictEqual(child.signal, signal);
    assert.strictEqual(signal.aborted, false);
    child.after(() => {
      abortedInAfterHook = signal.aborted;
    });
  });
  assert.strictEqual(abortedInAfterHook, false);
  assert.strictEqual(signal.aborted, true);
});

test("t.signal read for the first time after the test is over is already aborted", async t => {
  let childContext;
  t.afterEach(child => {
    childContext = child;
  });
  await t.test("never looks at its signal", () => {});
  assert.strictEqual(childContext.signal.aborted, true);
});

test("the signal option fails a running test with the reason and aborts t.signal", async t => {
  const controller = new AbortController();
  const reason = new Error("stop right there");
  let abortedInAfterHook;
  let seen;
  t.afterEach(child => {
    seen = { passed: child.passed, error: child.error };
  });
  await t.test("aborted while running", { todo: true, signal: controller.signal }, async child => {
    child.after(() => {
      abortedInAfterHook = child.signal.aborted;
    });
    controller.abort(reason);
    // Settles on its own: a runner that ignores the option reports a pass
    // here instead of hanging, and `seen` fails below.
    await new Promise(resolve => setImmediate(resolve));
  });
  assert.strictEqual(abortedInAfterHook, true);
  assert.strictEqual(seen.passed, false);
  assert.strictEqual(seen.error, reason);
});

test("a falsy abort reason is reported as Node's own AbortError", async t => {
  const controller = new AbortController();
  let seen;
  t.afterEach(child => {
    seen = { passed: child.passed, name: child.error.name, code: child.error.code, message: child.error.message };
  });
  await t.test("aborted with reason 0", { todo: true, signal: controller.signal }, async () => {
    controller.abort(0);
    await new Promise(resolve => setImmediate(resolve));
  });
  assert.deepStrictEqual(seen, {
    passed: false,
    name: "AbortError",
    code: "ABORT_ERR",
    message: "The test was aborted",
  });
});

test("a test whose signal is already aborted runs neither its body nor any hooks", async t => {
  const hooks = [];
  const bodies = [];
  t.beforeEach(() => hooks.push("beforeEach"));
  t.afterEach(() => hooks.push("afterEach"));
  await t.test("promise style", { todo: true, signal: AbortSignal.abort() }, () => {
    bodies.push("promise style");
  });
  await t.test("callback style", { todo: true, signal: AbortSignal.abort() }, (child, done) => {
    bodies.push("callback style");
    done();
  });
  let suiteSignal;
  describe("an inline suite has a signal of its own", suite => {
    suiteSignal = suite.signal;
  });
  assert.deepStrictEqual(bodies, []);
  assert.deepStrictEqual(hooks, []);
  assert.ok(suiteSignal instanceof AbortSignal);
  assert.strictEqual(suiteSignal.aborted, false);
});

// The remaining tests fail on purpose.

test("top-level test that times out", { timeout: 10 }, async t => {
  await untilAborted(t);
  console.log("OBS top-level timeout aborted t.signal");
});

const topLevelController = new AbortController();
test("top-level test aborted while running", { signal: topLevelController.signal }, async () => {
  topLevelController.abort(new Error("top-level abort reason"));
  await new Promise(resolve => setImmediate(resolve));
});

test(
  "top-level test whose signal is already aborted",
  { signal: AbortSignal.abort(new Error("aborted before start")) },
  () => {
    console.log("OBS pre-aborted top-level body ran");
  },
);
