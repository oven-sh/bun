// node-test.test.ts runs this three times: with DIRECTIVE=skip, with
// DIRECTIVE=todo and without a directive. `node --test` gives the same results.
//
// 5000 ms is bun:test's default per-test timeout. From that value on, bun:test's
// own timer used to end the test before node:test's timeout did.
const { test, beforeEach } = require("node:test");
const assert = require("node:assert");
const { spawn } = require("node:child_process");
const { once } = require("node:events");

const directive = process.env.DIRECTIVE;
const events = [];
let child;

// bun:test starts its clock before this hook and node:test starts its own after
// it, so the two clocks cannot end in the same millisecond.
beforeEach(async () => {
  await new Promise(resolve => setTimeout(resolve, 5));
});

test("a test that times out", { timeout: 5000 }, async t => {
  t.after(() => events.push("after hook of the test that timed out"));
  child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 30000)"], { stdio: "ignore" });
  if (directive) t[directive]();
  await new Promise(() => {});
});

// bun:test's timer killed the process of the first test when it ended that
// test, and `bun test` still kills it. Node does not: this test then waits
// until the process ends on its own.
test("the next test starts after the hooks of the test that timed out", async () => {
  assert.deepStrictEqual(events, ["after hook of the test that timed out"]);
  if (child.exitCode === null && child.signalCode === null) await once(child, "exit");
});
