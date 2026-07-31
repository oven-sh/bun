const test = require("node:test");
const assert = require("node:assert");

// afterEach must observe the body's outcome via ctx.passed / ctx.error, like
// Node (nodejs/node test/fixtures/test-runner/output/hooks.js:217-233).
test("afterEach sees passed=true, error=null for a passing subtest", async t => {
  let seen;
  t.afterEach(ctx => {
    seen = { passed: ctx.passed, error: ctx.error };
  });
  await t.test("child", () => {});
  assert.deepStrictEqual(seen, { passed: true, error: null });
});

test("afterEach sees passed=false and the thrown error for a failing subtest", async t => {
  const boom = new Error("boom");
  let seen;
  t.afterEach(ctx => {
    seen = { passed: ctx.passed, error: ctx.error };
  });
  // todo on the child so its failure does not roll up into this outer test.
  await t.test("child", { todo: true }, () => {
    throw boom;
  });
  assert.strictEqual(seen.passed, false);
  assert.strictEqual(seen.error, boom);
});

test("workerId reads NODE_TEST_WORKER_ID", t => {
  assert.strictEqual(t.workerId, undefined);
  process.env.NODE_TEST_WORKER_ID = "3";
  try {
    assert.strictEqual(t.workerId, 3);
  } finally {
    delete process.env.NODE_TEST_WORKER_ID;
  }
});
