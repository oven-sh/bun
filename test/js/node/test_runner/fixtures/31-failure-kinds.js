// The first four tests must FAIL and the last one must pass, serially and
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
