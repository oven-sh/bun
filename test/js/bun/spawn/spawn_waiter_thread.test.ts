import { spawn } from "bun";
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, isWindows, tempDir } from "harness";
import { join } from "path";

// Bun only falls back to the waiter thread on its own on Linux kernels without pidfd;
// this flag forces it everywhere else (it is only read when BUN_GARBAGE_COLLECTOR_LEVEL
// is also set). The thread itself exists on every unix, so it is tested on every unix.
const waiterThreadEnv = {
  ...bunEnv,
  BUN_GARBAGE_COLLECTOR_LEVEL: "0",
  BUN_FEATURE_FLAG_FORCE_WAITER_THREAD: "1",
};
const defaultWatcherEnv = {
  ...bunEnv,
  BUN_GARBAGE_COLLECTOR_LEVEL: "0",
  BUN_FEATURE_FLAG_FORCE_WAITER_THREAD: undefined,
  WITHOUT_WAITER_THREAD: "1",
};

// https://github.com/oven-sh/bun/issues/9404: a process with a live child used a full
// core while waiting on it. The fixture spawns such a child and reports the CPU this
// process used over a window spent only waiting: a spinning watcher puts cpuUs at
// ~100% of wallUs, while a watcher that sleeps measures ~0.2% on a release build and
// a few percent on a debug build.
async function expectIdleWhileWaitingOnChild(withWaiterThread: boolean) {
  await using proc = spawn({
    cmd: [bunExe(), join(import.meta.dir, "spawn_waiter_thread-fixture.js")],
    env: withWaiterThread ? waiterThreadEnv : defaultWatcherEnv,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  const report = JSON.parse(stdout);
  expect(report).toEqual({
    cpuUs: expect.any(Number),
    wallUs: expect.any(Number),
    waiterThread: isLinux ? withWaiterThread : null,
    exitCode: 0,
  });
  expect(report.wallUs).toBeGreaterThanOrEqual(400_000);
  const cpuPercent = (100 * report.cpuUs) / report.wallUs;
  expect(cpuPercent, `cpuUs=${report.cpuUs} wallUs=${report.wallUs}`).toBeLessThan(50);
  expect(exitCode).toBe(0);
}

// Serial on purpose: a spinning fixture sharing a core with another one would only
// measure ~50% and could slip under the limit.
test.serial("issue #9404: default process watcher is idle while a child runs", () =>
  expectIdleWhileWaitingOnChild(false),
);

test.serial.skipIf(isWindows)("issue #9404: waiter thread is idle while a child runs", () =>
  expectIdleWhileWaitingOnChild(true),
);

test.skipIf(isWindows)("waiter thread is woken up for exits and for newly spawned processes", async () => {
  using dir = tempDir("spawn-waiter-thread-wake", {
    "wake-fixture.js": `
      const cat = () => Bun.spawn({ cmd: ["cat"], stdin: "pipe", stdout: "ignore" });

      // "parked" is handed to the waiter thread first. By the time "settle" has been reported
      // as exited, the thread has also scanned "parked", found it alive and gone back to
      // sleep, so the exit below reaches us through the SIGCHLD wakeup.
      const parked = cat();
      const settle = cat();
      settle.stdin.end();
      await settle.exited;
      parked.stdin.end();
      const parkedExit = await parked.exited;

      // The thread is asleep with nothing left to watch: a newly spawned process has to
      // wake it up to be noticed.
      const later = cat();
      later.stdin.end();
      const laterExit = await later.exited;

      // Many wakeups (spawns and SIGCHLDs) arriving together coalesce in the wake channel.
      const burst = Array.from({ length: 8 }, cat);
      for (const proc of burst) proc.stdin.end();
      const burstExits = await Promise.all(burst.map(proc => proc.exited));

      console.log(JSON.stringify({ parkedExit, laterExit, burstExits }));
    `,
  });

  await using proc = spawn({
    cmd: [bunExe(), "wake-fixture.js"],
    cwd: String(dir),
    env: waiterThreadEnv,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(JSON.parse(stdout)).toEqual({ parkedExit: 0, laterExit: 0, burstExits: new Array(8).fill(0) });
  expect(exitCode).toBe(0);
});
