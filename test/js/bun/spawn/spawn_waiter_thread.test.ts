import { spawn } from "bun";
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux } from "harness";
import { join } from "path";

// https://github.com/oven-sh/bun/issues/9404: a process with a live child used a
// full core while waiting on it. The fixture spawns such a child and reports the
// CPU it used over a window spent only waiting: spinning puts cpuUs at ~100% of
// wallUs, while a process that sleeps properly measures ~0.2% on a release build
// and ~5% on a debug build.
async function run(withWaiterThread: boolean) {
  await using proc = spawn({
    cmd: [bunExe(), join(__dirname, "spawn_waiter_thread-fixture.js")],
    env: {
      ...bunEnv,
      ...(withWaiterThread
        ? { BUN_GARBAGE_COLLECTOR_LEVEL: "1", BUN_FEATURE_FLAG_FORCE_WAITER_THREAD: "1" }
        : { WITHOUT_WAITER_THREAD: "1" }),
    },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(stdout).toMatch(/^\{.*\}\n$/);
  const report = JSON.parse(stdout);
  expect(report).toEqual({ cpuUs: expect.any(Number), wallUs: expect.any(Number), childAlive: true });
  const { cpuUs, wallUs } = report;
  expect(wallUs).toBeGreaterThan(400_000);
  const cpuPercent = (cpuUs / wallUs) * 100;
  expect(cpuPercent, `cpuUs=${cpuUs} wallUs=${wallUs}`).toBeLessThan(50);
  expect(exitCode).toBe(0);
}

// One fixture at a time: two spinning fixtures sharing a core would each measure
// ~50% and could both slip under the limit.
test.serial("issue #9404: default process watcher", () => run(false));

// Bun only falls back to the waiter thread on its own on Linux (kernels without pidfd);
// macOS always has EVFILT_PROC. The flag forces the thread there too, but that exercises
// a non-Linux idle loop nothing ships with, so it is only asserted on Linux.
test.serial.skipIf(!isLinux)("issue #9404: waiter thread", () => run(true));
