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

test("process spawned in before survives the timeout", async () => {
  assert.strictEqual(server.signalCode, null);
  const data = once(server.stdout, "data");
  server.stdin.write("ping\n");
  const [chunk] = await data;
  assert.strictEqual(chunk.toString(), "ping\n");
});
