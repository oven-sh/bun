import { spawn } from "bun";
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, isWindows, libcPathForDlopen } from "harness";
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
    cmd: [bunExe(), join(__dirname, "spawn_waiter_thread-fixture.js")],
  });

  setTimeout(
    () => {
      proc.kill(process.platform !== "win32" ? "SIGKILL" : undefined);
    },
    isWindows ? 5000 : 1000,
  ).unref();

  await proc.exited;

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

// The handler only wakes the waiter thread, so it must not make blocking syscalls on
// the thread it runs on fail with EINTR (LeakSanitizer's exit-time wait4 does not retry).
test.skipIf(!isLinux)("the waiter thread's SIGCHLD handler restarts interrupted syscalls", async () => {
  const script = `
    const { dlopen, FFIType, ptr } = require("bun:ffi");
    const { sigaction } = dlopen(${JSON.stringify(libcPathForDlopen())}, {
      sigaction: { args: [FFIType.i32, FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
    }).symbols;
    // The waiter thread installs the handler before it reports any exit.
    await Bun.spawn({ cmd: [process.execPath, "-e", ""], stdio: ["ignore", "ignore", "ignore"] }).exited;
    const SIGCHLD = 17;
    const old = new Uint8Array(152);
    if (sigaction(SIGCHLD, null, ptr(old)) !== 0) throw new Error("sigaction failed");
    // struct sigaction: handler (8) + sa_mask (128), then int sa_flags.
    const flags = new DataView(old.buffer).getInt32(136, true);
    console.log(JSON.stringify({ restart: (flags & 0x10000000) !== 0, noCldStop: (flags & 1) !== 0 }));
  `;
  await using proc = spawn({
    cmd: [bunExe(), "-e", script],
    env: { ...bunEnv, BUN_GARBAGE_COLLECTOR_LEVEL: "1", BUN_FEATURE_FLAG_FORCE_WAITER_THREAD: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(JSON.parse(stdout)).toEqual({ restart: true, noCldStop: true });
  expect(exitCode).toBe(0);
});
