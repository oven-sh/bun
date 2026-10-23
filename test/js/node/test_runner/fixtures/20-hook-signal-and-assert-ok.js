const assert = require("node:assert");
const { test } = require("node:test");

// Hook-level `signal` is enforced (test-level `signal` is validated only).
// The error of the child is 'failed running beforeEach hook', and its cause
// is the reason of the abort.
test("a hook-level signal aborts the hook and fails the owning subtest", async t => {
  const controller = new AbortController();
  const reason = new Error("stop the hook");
  let hookRan = false;
  t.beforeEach(
    async () => {
      hookRan = true;
      controller.abort(reason);
      // The abort listener rejects before this resolves. If the signal is ever
      // ignored the hook resolves instead of hanging, and `seen` fails below.
      await new Promise(resolve => setImmediate(resolve));
    },
    { signal: controller.signal },
  );
  const seen = [];
  t.afterEach(child => seen.push({ passed: child.passed, error: child.error }));
  // `todo` keeps the deliberate hook failure from failing this test.
  await t.test("child", { todo: true }, () => {});
  assert.ok(hookRan);
  assert.strictEqual(seen.length, 1);
  assert.strictEqual(seen[0].passed, false);
  assert.strictEqual(seen[0].error.failureType, "hookFailed");
  assert.strictEqual(seen[0].error.message, "failed running beforeEach hook");
  assert.strictEqual(seen[0].error.cause, reason);
});

test("t.assert.ok is installed separately and still counts toward the plan", t => {
  t.plan(1);
  assert.strictEqual(t.assert.ok.name, "ok");
  t.assert.ok(true);
});
