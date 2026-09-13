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

// t.test() after the parent finished: Node fails the late subtest with
// parentAlreadyFinished but resolves the returned promise (undefined); it must
// not reject or fall through to bun:test's internal-phase throw.
test("late subtest after parent finished", async t => {
  let saved;
  await t.test("parent", pt => {
    saved = pt;
  });
  let outcome;
  await saved
    .test("late", () => {})
    .then(
      v => (outcome = { resolved: true, value: v }),
      e => (outcome = { rejected: true, code: e?.code }),
    );
  assert.deepStrictEqual(outcome, { resolved: true, value: undefined });
});
