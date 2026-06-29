const { describe, before, test } = require("node:test");
const assert = require("node:assert");

// A failing before() in a plain (non-todo) suite fails the run. The failure is
// attributed to the hook, not reported as an unhandled error between tests,
// and the suite's tests do not run.
describe("broken setup", () => {
  before(() => {
    console.log("LOG:before");
    assert.fail("setup broke");
  });

  test("never reached", () => {
    console.log("LOG:MUST-NOT-APPEAR-after-broken-setup");
  });
});
