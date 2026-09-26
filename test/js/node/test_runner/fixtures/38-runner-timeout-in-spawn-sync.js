const { test, after, afterEach } = require("node:test");
const { spawnSync } = require("node:child_process");

// node-test.test.ts runs this file with a short `--timeout`. The child outlives
// it, so bun:test kills the child and reports the timeout from inside the
// spawnSync() call, with the body of S still on the stack. The hooks of S must
// still run before T starts.
const log = [];

afterEach(t => {
  log.push(`afterEach(${t.name})`);
});

test("S", async t => {
  t.after(() => log.push("t.after(S)"));
  await new Promise(resolve => setImmediate(resolve));
  spawnSync(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], { stdio: "ignore" });
  await new Promise(() => {});
});

test("T", { timeout: Infinity }, () => {
  log.push("T");
});

after(() => console.log("ORDER=" + JSON.stringify(log)));
