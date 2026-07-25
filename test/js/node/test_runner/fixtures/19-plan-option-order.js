// Node applies the `plan` option before the beforeEach hooks run
// (nodejs/node lib/internal/test_runner/test.js:1313-1315). Because `t.assert`
// snapshots the plan at first access, a hook that merely touches `t.assert`
// would otherwise capture a null plan and silently swallow every count.
// This whole file passes on the node v26.3.0 binary.
const assert = require("node:assert");
const { test, beforeEach } = require("node:test");

let planThrew;

beforeEach(t => {
  t.assert;
  // The option's plan already exists here, so a second t.plan() is rejected.
  planThrew = undefined;
  if (t.name === "the plan option is already set inside beforeEach") {
    try {
      t.plan(2);
    } catch (err) {
      planThrew = err.message;
    }
  }
});

test("the plan option survives a beforeEach that touches t.assert", { plan: 1 }, t => {
  t.assert.ok(1);
});

test("the plan option is already set inside beforeEach", { plan: 1 }, t => {
  assert.strictEqual(planThrew, "cannot set plan more than once");
  t.assert.ok(1);
});

// Node only installs the option's plan for a truthy count, so `{ plan: 0 }` is
// not a plan of zero assertions.
test("a zero plan option installs no plan", { plan: 0 }, t => {
  t.assert.ok(1);
});
