// A `plan` option with an invalid count, on tests that are not subtests. Node
// v26.3.0 validates the count when a test starts, before the `try` of
// Test.run(). For these tests the error leaves run(), the test never reports,
// and `node --test` does not finish: node cannot run this file. Bun raises the
// same error, fails that one test with it, and goes on.
// 43-invalid-subtest-plan.js has the subtests, where node does finish.
const assert = require("node:assert");
const { test, beforeEach, afterEach } = require("node:test");

const events = [];
const outcome = t => (t.passed ? "passed" : t.error.code);

beforeEach(t => {
  events.push(`beforeEach: ${t.name}`);
});
afterEach(t => {
  events.push(`afterEach: ${t.name}: ${outcome(t)}`);
});

test("a test before the invalid plans", () => {});

test("a plan that is not a number", { plan: "x" }, () => {
  events.push("the body ran");
});

test("a plan that is out of range", { plan: -1 }, () => {
  events.push("the body ran");
});

// The invalid plan is the failure this test expects, so it passes without its body.
test("an invalid plan on a test that expects a failure", { plan: "x", expectFailure: true }, () => {
  events.push("the body ran");
});

// Node also hangs when a test keeps the rejection of such a subtest from its
// own body. Bun fails that test: its subtest did not run.
test("a test that catches the rejection of a subtest with an invalid plan", async t => {
  const subtest = t.test("the subtest", { plan: "x" }, () => {
    events.push("the body ran");
  });
  await subtest.catch(() => {});
});

test("the tests after the invalid plans still run", t => {
  assert.deepStrictEqual(events, [
    "beforeEach: a test before the invalid plans",
    "afterEach: a test before the invalid plans: passed",
    // The plan is applied before the beforeEach hooks, so they do not run. The
    // afterEach hooks run as they do after any failure.
    "afterEach: a plan that is not a number: ERR_INVALID_ARG_TYPE",
    "afterEach: a plan that is out of range: ERR_OUT_OF_RANGE",
    "afterEach: an invalid plan on a test that expects a failure: passed",
    "beforeEach: a test that catches the rejection of a subtest with an invalid plan",
    "afterEach: a test that catches the rejection of a subtest with an invalid plan: ERR_TEST_FAILURE",
    `beforeEach: ${t.name}`,
  ]);
});
