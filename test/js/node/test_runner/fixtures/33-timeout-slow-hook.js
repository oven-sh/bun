// The `timeout` option is for the body of the test. The hooks run around it
// and are not part of it, so the first test passes under `node --test`. Its
// hooks take about 5200 ms together: more than bun:test's built-in 5000 ms,
// and less than the 8000 ms that bun:test's own timer gives this test.
const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert");
const { spawn } = require("node:child_process");

let first = true;
let child;
beforeEach(async () => {
  if (first) await new Promise(resolve => setTimeout(resolve, 2600));
});
afterEach(async () => {
  if (first) await new Promise(resolve => setTimeout(resolve, 2600));
  first = false;
});

test("a test with slow hooks", { timeout: 3000 }, () => {
  child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 30000)"], { stdio: "ignore" });
});

// No timeout ended the first test, so nothing killed its process.
test("the process of the first test still runs", () => {
  assert.deepStrictEqual([child.exitCode, child.signalCode], [null, null]);
  child.kill();
});
