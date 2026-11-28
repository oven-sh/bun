// Run with `--timeout 1000`, which also gives before() time to spawn on a slow machine.
const assert = require("node:assert");
const { test, before, after } = require("node:test");
const { bunEnv, bunExe } = require("harness");

// Echoes stdin to stdout until it is killed.
const echo = () =>
  Bun.spawn({
    cmd: [bunExe(), "-e", "process.stdin.pipe(process.stdout)"],
    stdin: "pipe",
    stdout: "pipe",
    stderr: "inherit",
    env: bunEnv,
  });

let server;
let own;

before(() => {
  server = echo();
});

after(() => {
  server.kill();
});

test("test timeout kills the processes this test spawned", async () => {
  own = echo();
  await new Promise(() => {});
});

// Its own `timeout` keeps `--timeout` from failing it while the process from before() starts up.
test("process spawned in before survives the timeout", { timeout: 30_000 }, async () => {
  // Only the timeout's kill ends this process.
  await own.exited;

  const reader = server.stdout.getReader();
  server.stdin.write("ping\n");
  server.stdin.flush();
  const { value } = await reader.read();
  assert.strictEqual(new TextDecoder().decode(value), "ping\n");
  reader.releaseLock();
});
