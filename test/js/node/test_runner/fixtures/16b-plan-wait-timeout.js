const test = require("node:test");

// plan({wait:true}) with a missing assertion must be bounded by the test's
// own timeout, not hang. Node races plan.check() against stopPromise.
test("wait:true bounded by test timeout", { timeout: 100 }, async t => {
  t.plan(2, { wait: true });
  t.assert.ok(1);
});
