import { spawn } from "bun";
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";
import { join } from "path";

async function run(withWaiterThread: boolean) {
  const proc = spawn({
    env: {
      ...bunEnv,
      ...(withWaiterThread
        ? { BUN_GARBAGE_COLLECTOR_LEVEL: "1", BUN_FEATURE_FLAG_FORCE_WAITER_THREAD: "1" }
        : { WITHOUT_WAITER_THREAD: "1" }),
    },
    stderr: "inherit",
    stdout: "inherit",
    stdin: "ignore",
    // The fixture leads a process group of its own, so that the child it
    // spawns can be killed below.
    detached: !isWindows,
    cmd: [bunExe(), join(__dirname, "spawn_waiter_thread-fixture.js")],
  });

  setTimeout(
    () => {
      proc.kill(process.platform !== "win32" ? "SIGKILL" : undefined);
    },
    isWindows ? 5000 : 1000,
  ).unref();

  await proc.exited;

  // SIGKILL gave the fixture no chance to stop the child that it spawned, and
  // that child sleeps for days. It is what is left of the fixture's process
  // group. On Windows it dies with the fixture: libuv puts it in a
  // kill-on-close job.
  if (!isWindows) {
    try {
      process.kill(-proc.pid, "SIGKILL");
    } catch {}
  }

  const resourceUsage = proc.resourceUsage();

  // Assert we didn't use 100% of CPU time
  console.log(resourceUsage.cpuTime);
  expect(resourceUsage?.cpuTime.total).toBeLessThan(750_000n * (isWindows ? 5n : 1n));
}

test(
  "issue #9404",
  async () => {
    const promises = [run(false)];
    if (process.platform === "linux") {
      promises.push(run(true));
    }

    await Promise.all(promises);
  },
  isWindows ? 6_000 : 5_000,
);
