// A test's own timeout ends it before bun:test's default of 5000 ms. `bun test`
// kills no process then, as `node --test`: the process that the before hook
// started is still there for the next test.
const { test, before, after } = require("node:test");
const assert = require("node:assert");
const { spawn } = require("node:child_process");

let server;
before(() => {
  server = spawn(process.execPath, ["-e", "setTimeout(() => {}, 30000)"], { stdio: "ignore" });
});
after(() => {
  server.kill();
});

test("a todo test that times out", { timeout: 100 }, async t => {
  t.todo();
  await new Promise(() => {});
});

test("a test that needs the process", () => {
  assert.deepStrictEqual([server.exitCode, server.signalCode], [null, null]);
});
