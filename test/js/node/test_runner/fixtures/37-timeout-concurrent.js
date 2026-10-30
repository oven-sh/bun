// node-test.test.ts runs this with `--concurrent`. bun:test kills no process
// when a test of a concurrent group times out: the processes of the other
// tests of the group would go too. The same holds when a test's own timeout
// ends it.
const { test } = require("node:test");
const { spawn } = require("node:child_process");

const firstEnded = Promise.withResolvers();
const sleeper = () => spawn(process.execPath, ["-e", "setTimeout(() => {}, 30000)"], { stdio: "ignore" });

test("a test that times out", { timeout: 5000 }, async t => {
  const child = sleeper();
  t.after(() => {
    child.kill();
    firstEnded.resolve();
  });
  await new Promise(() => {});
});

test("a test that runs at the same time", { timeout: 10000 }, async () => {
  const child = sleeper();
  await firstEnded.promise;
  await new Promise(resolve => setImmediate(resolve));
  child.kill();
});
