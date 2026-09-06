const assert = require("node:assert");
const { test } = require("node:test");

// Hook-level `signal` is enforced (test-level `signal` is validated only).
// Node reports the child's error as its own 'failed running beforeEach hook'
// wrapper while bun surfaces the thrown error, so assert on the outcome.
test("a hook-level signal aborts the hook and fails the owning subtest", async t => {
  const controller = new AbortController();
  let hookRan = false;
  t.beforeEach(
    async () => {
      hookRan = true;
      controller.abort(new Error("stop the hook"));
      // The abort listener rejects before this resolves. If the signal is ever
      // ignored the hook resolves instead of hanging, and `seen` fails below.
      await new Promise(resolve => setImmediate(resolve));
    },
    { signal: controller.signal },
  );
  const seen = [];
  t.afterEach(child => seen.push(child.passed));
  // `todo` keeps the deliberate hook failure from failing this test.
  await t.test("child", { todo: true }, () => {});
  assert.ok(hookRan);
  assert.deepStrictEqual(seen, [false]);
});

test("t.assert.ok is installed separately and still counts toward the plan", t => {
  t.plan(1);
  assert.strictEqual(t.assert.ok.name, "ok");
  t.assert.ok(true);
});
