const test = require("node:test");
const assert = require("node:assert");
const { spawnSync } = require("node:child_process");

// The runner gives the file its worker id before the file loads. It is 1 for a
// file that runs alone, also when the runner itself inherited another value.
const atImport = process.env.NODE_TEST_WORKER_ID;

test("the variable is set when the file loads", () => {
  assert.strictEqual(atImport, "1");
});

test("t.workerId is the variable as a number", t => {
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

test("a child process inherits the variable", () => {
  const { stdout } = spawnSync(process.execPath, ["-p", "process.env.NODE_TEST_WORKER_ID"], { encoding: "utf8" });
  assert.strictEqual(stdout.trim(), "1");
});
