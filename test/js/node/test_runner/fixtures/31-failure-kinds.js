// The first four tests must FAIL and the last two must pass, serially and
// under `bun test --concurrent`. Node v26.3.0 reports the same.
const { test } = require("node:test");
const assert = require("node:assert");

test("a test body that throws", () => {
  throw new Error("thrown error");
});

test("a failed assertion", () => {
  assert.strictEqual(1, 2);
});

test("a rejected promise", async () => {
  await Promise.reject(new Error("rejected promise"));
});

test("an unmet t.plan()", t => {
  t.plan(2);
  t.assert.ok(true);
});

test("a test that passes", () => {});

// After a failure the event loop still runs an unref'd immediate. The interval
// keeps the loop alive meanwhile.
test("a test after the failures that waits for an unref'd immediate", async () => {
  const keepAlive = setInterval(() => {}, 1000);
  try {
    await new Promise(resolve => setImmediate(resolve).unref());
  } finally {
    clearInterval(keepAlive);
  }
});
