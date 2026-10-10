import { spawn } from "bun";
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, isWindows } from "harness";
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

  const resourceUsage = proc.resourceUsage()!;

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

// Not everything retries a system call after EINTR: a native addon, bun:ffi, LeakSanitizer when the process exits.
test.skipIf(!isLinux)("a child that exits does not interrupt a system call of the main thread", async () => {
  await using proc = spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const { dlopen, ptr } = require("bun:ffi");
      const { closeSync, readFileSync } = require("node:fs");
      const arch = process.arch === "x64" ? "x86_64" : "aarch64";
      let libc, lastError;
      for (const lib of ["libc.so.6", "libc.musl-" + arch + ".so.1"]) {
        try {
          libc = dlopen(lib, {
            pipe: { args: ["ptr"], returns: "int" },
            read: { args: ["int", "ptr", "u64"], returns: "i64" },
          }).symbols;
          break;
        } catch (err) {
          lastError = err;
        }
      }
      if (!libc) throw lastError;
      const fds = new Int32Array(2);
      if (libc.pipe(ptr(fds)) !== 0) throw new Error("pipe");
      const victim = Bun.spawn({ cmd: ["sleep", "1000"] });

      // The waiter thread installs the handler when it starts. Without that thread nobody reaps the victim below.
      const SIGCHLD = 1n << BigInt(require("node:os").constants.signals.SIGCHLD - 1);
      const caught = () => BigInt("0x" + /SigCgt:\\s*(\\w+)/.exec(readFileSync("/proc/self/status", "utf8"))[1]);
      for (const deadline = performance.now() + 10_000; !(caught() & SIGCHLD); await Bun.sleep(1)) {
        if (performance.now() > deadline) {
          victim.kill("SIGKILL");
          throw new Error("there is no handler for SIGCHLD");
        }
      }

      // It kills the victim once this thread sleeps in read(), and writes once the victim is reaped, which the
      // handler has woken the waiter thread up for.
      const asleep = 'while read -r _ _ state _ < /proc/$PPID/stat && [ "$state" != S ]; do :; done';
      const gone = "while kill -0 " + victim.pid + " 2>/dev/null; do :; done";
      Bun.spawn({ cmd: ["sh", "-c", [asleep, "kill -9 " + victim.pid, gone, "echo x"].join("; ")], stdout: fds[1] });
      closeSync(fds[1]);
      console.log(Number(libc.read(fds[0], ptr(new Uint8Array(1)), 1)));
      `,
    ],
    env: { ...bunEnv, BUN_GARBAGE_COLLECTOR_LEVEL: "1", BUN_FEATURE_FLAG_FORCE_WAITER_THREAD: "1" },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "inherit",
  });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  expect(stdout).toBe("1\n");
  expect(exitCode).toBe(0);
});
