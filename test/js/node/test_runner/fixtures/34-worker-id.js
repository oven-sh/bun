const test = require("node:test");
const assert = require("node:assert");

// context.workerId is 1 for a file that runs alone, for every context of the file.
test("t.workerId is 1", t => {
  assert.strictEqual(t.workerId, 1);
});

test("a hook and a subtest see the same id", async t => {
  const seen = [];
  t.beforeEach(ctx => {
    seen.push(ctx.workerId);
  });
  await t.test("child", child => {
    seen.push(child.workerId);
  });
  assert.deepStrictEqual(seen, [1, 1]);
});

test.describe("a suite", () => {
  test("sees the same id", t => {
    assert.strictEqual(t.workerId, 1);
  });
});

process.on("exit", () => console.log("ENV " + process.env.NODE_TEST_WORKER_ID));
