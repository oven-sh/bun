const test = require("node:test");
const assert = require("node:assert");

// When a test gets its outcome, as its hooks see it. Each failing subtest is
// `todo`, so that it does not fail its parent.
const todo = { todo: true };

test("afterEach sees a test as passed when only its subtest failed", async t => {
  let seen;
  t.afterEach(ctx => {
    if (ctx.name === "child") seen = { passed: ctx.passed, error: ctx.error };
  });
  await t.test("child", todo, async st => {
    await st.test("grandchild", () => {
      throw new Error("from the grandchild");
    });
  });
  // Node counts the failed subtests of a test after its hooks.
  assert.deepStrictEqual(seen, { passed: true, error: null });
});

test("an afterEach hook that throws fails a passing test", async t => {
  const fromHook = new Error("from afterEach");
  const events = [];
  let seen;
  t.afterEach(() => {
    events.push("first afterEach");
    throw fromHook;
  });
  t.afterEach(() => {
    events.push("second afterEach");
  });
  await t.test("child", todo, st => {
    st.after(() => {
      events.push("after");
      seen = { passed: st.passed, error: st.error };
    });
  });
  // The other afterEach hooks do not run. The after hooks of the test run.
  assert.deepStrictEqual(events, ["first afterEach", "after"]);
  assert.strictEqual(seen.passed, false);
  assert.strictEqual(seen.error.failureType, "hookFailed");
  assert.strictEqual(seen.error.message, "failed running afterEach hook");
  assert.strictEqual(seen.error.cause, fromHook);
});

test("an after hook that throws stops the after hooks that follow it", async t => {
  const events = [];
  await t.test("child", todo, st => {
    st.after(() => {
      events.push("first after");
      throw new Error("from after");
    });
    st.after(() => {
      events.push("second after");
    });
  });
  assert.deepStrictEqual(events, ["first after"]);
});

test("a failed beforeEach hook skips the body and keeps the afterEach hooks", async t => {
  const events = [];
  t.beforeEach(() => {
    events.push("beforeEach");
    throw new Error("from beforeEach");
  });
  t.afterEach(ctx => {
    events.push(`afterEach passed=${ctx.passed}`);
  });
  await t.test("child", todo, () => {
    events.push("body");
  });
  assert.deepStrictEqual(events, ["beforeEach", "afterEach passed=false"]);
});
