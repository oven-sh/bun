// Runs under `bun test --timeout <small>` and `node --test --test-timeout=<small>`: Node keeps the process from before() too.
import assert from "node:assert";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { after, before, test } from "node:test";

// Echoes stdin to stdout until it is killed.
const echo = () =>
  spawn(process.execPath, ["-e", "process.stdin.pipe(process.stdout)"], {
    stdio: ["pipe", "pipe", "inherit"],
    env: { ...process.env, BUN_DEBUG_QUIET_LOGS: "1" },
  });

let server;
let own;

before(() => {
  server = echo();
});

after(() => {
  server.kill();
  own?.kill();
});

// This test has no `timeout` of its own.
test("test timeout kills the processes this test spawned", async () => {
  own = echo();
  await new Promise(() => {});
});

// Its own `timeout` keeps the small default from failing it while the process from before() starts up on a slow machine.
test("process spawned in before survives the timeout", { timeout: 30_000 }, async () => {
  assert.deepStrictEqual([server.exitCode, server.signalCode], [null, null]);
  const stop = new AbortController();
  const exited = once(server, "exit", { signal: stop.signal }).then(
    ([code, signal]) => assert.fail(`process from before() exited: ${signal ?? code}`),
    () => {},
  );
  const data = once(server.stdout, "data");
  server.stdin.write("ping\n");
  try {
    const [chunk] = await Promise.race([data, exited]);
    assert.strictEqual(chunk.toString(), "ping\n");
  } finally {
    stop.abort();
  }
});
