// Node installs its own `ok` only when no custom assertion claimed the name
// (nodejs/node lib/internal/test_runner/test.js:345 `if (!map.has('ok'))`), so a
// registered `ok` wins. Registration is file-scoped, hence its own fixture.
// Passes on the node v26.3.0 binary.
const assert = require("node:assert");
const { test, assert: testAssert } = require("node:test");

testAssert.register("ok", function () {
  return "custom";
});

test("a registered ok overrides the built-in one", t => {
  assert.strictEqual(t.assert.ok(false), "custom");
});

test("a registered ok still counts toward the plan", t => {
  t.plan(1);
  t.assert.ok(false);
});
