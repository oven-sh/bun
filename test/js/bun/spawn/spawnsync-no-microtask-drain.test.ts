import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// Regression test: microtasks must not drain during Bun.spawnSync.
//
// Root cause: tickQueueWithCount (Task.zig) unconditionally calls
// drainMicrotasksWithGlobal after every task. The SpawnSyncEventLoop's
// isolated EventLoop shares the same JSC VM/GlobalObject, so draining
// microtasks on it would drain the global microtask queue, executing
// user JavaScript during spawnSync.
//
// On POSIX the trigger is the waiter thread's shared completion queue;
// on Windows it's libuv's uv_run() firing uv_process exit callbacks inline
// during the isolated loop tick.

test("microtasks do not drain inside spawnSync", async () => {
  using dir = tempDir("spawnsync-microtask", {
    "repro.js": `
const cp = require('node:child_process')

let inSync = false
let hit = null

const p = cp.spawn(process.execPath, ['-e', 'console.log("x")'], {
  stdio: ['ignore', 'pipe', 'ignore'],
})

queueMicrotask(() => {
  if (inSync) hit = new Error('microtask drained inside spawnSync').stack
})

// Busy-block main loop so the async child is reaped before we enter spawnSync
const end = performance.now() + 150
while (performance.now() < end) {
  /* busy */
}

inSync = true
Bun.spawnSync({ cmd: [process.execPath, '-e', 'Bun.sleepSync(10)'], maxBuffer: 1048576 })
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
      // Force waiter thread on Linux to trigger the race reliably
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
    cmd: [bunExe(), "-e", "console.log('hello')"],
    maxBuffer: 1048576,
  });

  expect(result.stdout.toString().trim()).toBe("hello");
  expect(result.exitCode).toBe(0);
});

test("spawnSync with timeout still works", () => {
  const result = Bun.spawnSync({
    cmd: [bunExe(), "-e", "Bun.sleepSync(10000)"],
    timeout: 100,
  });

  expect(result.exitCode).toBeNull();
  expect(result.signalCode).toBe("SIGTERM");
});
