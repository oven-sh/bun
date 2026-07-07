const test = require("node:test");
const assert = require("node:assert");

// t.assert accessed before t.plan(): Node captures plan at first access, so
// later assertions do NOT count (nodejs/node lib/internal/test_runner/test.js:331).
test.describe("plan capture at first t.assert access", () => {
  let planFailure;
  test.afterEach(ctx => {
    if (ctx.name === "assert-before-plan") planFailure = ctx.error;
  });
  test("assert-before-plan", t => {
    t.assert;
    t.plan(2);
    t.assert.ok(1);
    t.assert.ok(1);
    t.todo(); // the plan mismatch is expected
  });
  test("verify assert-before-plan failed with 0/2", () => {
    assert.match(String(planFailure), /plan expected 2 assertions but received 0/);
  });
});

// t.test() after the parent finished must reject with Node's
// parentAlreadyFinished error, not bun:test's internal-phase throw.
test("late subtest after parent finished", async t => {
  let saved;
  await t.test("parent", pt => {
    saved = pt;
  });
  let caught;
  await saved
    .test("late", () => {})
    .catch(e => {
      caught = e;
    });
  assert.strictEqual(caught?.code, "ERR_TEST_FAILURE");
  assert.strictEqual(caught?.failureType, "parentAlreadyFinished");
});
