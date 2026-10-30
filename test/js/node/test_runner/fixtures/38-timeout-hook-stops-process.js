// The test's own timeout ends it 5000 ms after it started, where bun:test
// killed the processes of a test that its timer ended. The hooks of the test
// run first, so the after hook here ends the process in its own way, as under
// `node --test`, and `bun test` has nothing left to kill.
const { test } = require("node:test");
const { spawn } = require("node:child_process");
const { once } = require("node:events");

test("a test whose after hook stops its process", { timeout: 5000 }, async t => {
  const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 30000)"], { stdio: "ignore" });
  t.after(async () => {
    child.kill();
    await once(child, "exit");
  });
  await new Promise(() => {});
});
