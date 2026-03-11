import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// Regression test: microtasks must not drain during Bun.spawnSync.
//
// Root cause: tickQueueWithCount (Task.zig) unconditionally calls
// drainMicrotasksWithGlobal after every task. The SpawnSyncEventLoop's
// isolated EventLoop shares the same JSC VM/GlobalObject, so draining
// microtasks on it would drain the global microtask queue, executing
// user JavaScript during spawnSync. The fix uses tickTasksOnly() which
// suppresses microtask draining via suppress_microtask_drain.
//
// The waiter thread (Linux-only, forced via BUN_FEATURE_FLAG_FORCE_WAITER_THREAD)
// uses a shared completion queue. When the async child exits during the busy-wait,
// its ResultTask gets enqueued. Then during spawnSync's isolated event loop tick,
// the microtask drain would run the queueMicrotask callback.

test("microtasks do not drain inside spawnSync with waiter thread", async () => {
  using dir = tempDir("spawnsync-microtask", {
    "repro.js": `
const cp = require('node:child_process')

let inSync = false
let hit = null

const p = cp.spawn('/bin/sh', ['-c', 'echo x'], {
  stdio: ['ignore', 'pipe', 'ignore'],
})

queueMicrotask(() => {
  if (inSync) hit = new Error('microtask drained inside spawnSync').stack
})

// Busy-block main loop so Waitpid thread reaps \`p\` before we enter spawnSync
const end = performance.now() + 150
while (performance.now() < end) {
  /* busy */
}

inSync = true
Bun.spawnSync({ cmd: ['/bin/sh', '-c', 'sleep 0.01'], maxBuffer: 1048576 })
inSync = false

await new Promise(r => p.on('close', r))

if (hit) {
  console.error(hit)
  process.exit(1)
}
console.log('OK: microtask did not drain inside spawnSync')
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "repro.js"],
    cwd: String(dir),
    env: {
      ...bunEnv,
      BUN_FEATURE_FLAG_FORCE_WAITER_THREAD: "1",
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout.trim()).toBe("OK: microtask did not drain inside spawnSync");
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});

test("spawnSync still works correctly with maxBuffer", () => {
  const result = Bun.spawnSync({
    cmd: ["/bin/sh", "-c", "echo hello"],
    maxBuffer: 1048576,
  });

  expect(result.stdout.toString().trim()).toBe("hello");
  expect(result.exitCode).toBe(0);
});

test("spawnSync with timeout still works", () => {
  const result = Bun.spawnSync({
    cmd: ["/bin/sh", "-c", "sleep 10"],
    timeout: 100,
  });

  expect(result.exitCode).toBeNull();
  expect(result.signalCode).toBe("SIGTERM");
});
