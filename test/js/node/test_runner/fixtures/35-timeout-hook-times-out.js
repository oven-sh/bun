// The `timeout` of the afterEach hook ends the first test 5500 ms after it
// started. That is later than 5000 ms, where bun:test's timer ended such a
// test and killed its process, and before the 6000 ms that the timer has now.
// `bun test` still kills the process. Node does not: the next test then waits
// until the process ends on its own.
const { test, afterEach } = require("node:test");
const { spawn } = require("node:child_process");
const { once } = require("node:events");

let calls = 0;
let child;
afterEach(
  () => {
    if (calls++ === 0) return new Promise(() => {});
  },
  { timeout: 5500 },
);

test("a test whose afterEach hook times out", { timeout: 1000 }, () => {
  child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 30000)"], { stdio: "ignore" });
});

test("the next test", async () => {
  if (child.exitCode === null && child.signalCode === null) await once(child, "exit");
});
