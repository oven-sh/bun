const { describe, before, test } = require("node:test");
const assert = require("node:assert");

// A failing before() in a plain (non-todo) suite fails the run, whether it
// throws synchronously or rejects asynchronously. The failure is attributed to
// the hook, not reported as an unhandled error between tests, and the suite's
// tests do not run.
describe("broken setup", () => {
  before(() => {
    console.log("LOG:before");
    assert.fail("setup broke");
  });

  test("never reached", () => {
    console.log("LOG:MUST-NOT-APPEAR-after-broken-setup");
  });
});

describe("broken async setup", () => {
  before(async () => {
    console.log("LOG:async-before");
    assert.fail("async setup broke");
  });

  test("never reached either", () => {
    console.log("LOG:MUST-NOT-APPEAR-after-broken-async-setup");
  });
});
