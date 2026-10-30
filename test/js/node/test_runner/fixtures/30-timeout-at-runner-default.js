// node-test.test.ts runs this three times: with DIRECTIVE=skip, with
// DIRECTIVE=todo and without a directive. `node --test` gives the same results.
//
// 5000 ms is bun:test's default per-test timeout. From that value on, bun:test's
// own timer used to end the test before node:test's timeout did.
const { test, beforeEach } = require("node:test");
const assert = require("node:assert");

const directive = process.env.DIRECTIVE;
const events = [];

// bun:test starts its clock before this hook and node:test starts its own after
// it, so the two clocks cannot end in the same millisecond.
beforeEach(async () => {
  await new Promise(resolve => setTimeout(resolve, 5));
});

test("a test that times out", { timeout: 5000 }, async t => {
  t.after(() => events.push("after hook of the test that timed out"));
  if (directive) t[directive]();
  await new Promise(() => {});
});

test("the next test starts after the hooks of the test that timed out", () => {
  assert.deepStrictEqual(events, ["after hook of the test that timed out"]);
});
