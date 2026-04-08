import { spawn as bunSpawn } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isPosix } from "harness";
import { spawn } from "node:child_process";
import { once } from "node:events";

// https://github.com/oven-sh/bun/issues/29001
//
// `ChildProcess.kill()` must return `false` once the child has exited,
// matching Node.js. Before the fix the JS binding for `Subprocess.kill()`
// always returned `undefined`, so the `node:child_process` wrapper could
// never tell the difference between "signal delivered" and "process was
// already gone" and ended up returning `true` in both cases.
describe.concurrent("issue #29001 — kill() reports failure after exit", () => {
  test.if(isPosix)("node:child_process ChildProcess.kill() returns false after exit", async () => {
    const proc = spawn(bunExe(), ["-e", "process.exit(0)"], {
      env: bunEnv,
      stdio: "ignore",
    });

    // Wait for the child to actually exit cleanly. We check the exit
    // code/signal before the kill assertions so a fixture crash surfaces
    // as a meaningful failure instead of a misleading "kill returned true".
    const [code, signal] = await once(proc, "close");
    expect(code).toBe(0);
    expect(signal).toBe(null);

    // Every kill attempt must now report failure — the process is gone.
    expect(proc.kill("SIGTERM")).toBe(false);
    expect(proc.kill("SIGQUIT")).toBe(false);
    // Signal 0 is the existence probe; it must also report failure.
    expect(proc.kill(0)).toBe(false);

    // `proc.killed` only flips when *we* successfully delivered a signal.
    // The child exited on its own, so it must still be false — matching
    // Node's documented semantics.
    expect(proc.killed).toBe(false);
  });

  test.if(isPosix)("node:child_process ChildProcess.kill() returns true while alive", async () => {
    // `cat` with no stdin sits around until we kill it.
    const proc = spawn("cat", [], { stdio: ["pipe", "ignore", "ignore"] });

    try {
      // Signal 0 does not terminate but should report success.
      expect(proc.kill(0)).toBe(true);
      // A successful existence probe must NOT mark the child as killed;
      // only a real signal delivery flips `proc.killed`. Mirrors Node,
      // which guards this with `signal > 0`.
      expect(proc.killed).toBe(false);
    } finally {
      proc.kill("SIGKILL");
      await once(proc, "close");
    }
  });

  // The Bun.spawn exit-path tests exercise the platform-agnostic
  // `hasExited()` fast path inside `Subprocess.tryKill` and the
  // Windows-specific `ESRCH` branch in `Process.kill`, so they run on
  // every platform.
  test("Bun.spawn subprocess.kill() returns false after exit", async () => {
    await using proc = bunSpawn({
      cmd: [bunExe(), "-e", "process.exit(0)"],
      env: bunEnv,
      stdio: ["ignore", "ignore", "ignore"],
    });

    const exitCode = await proc.exited;
    expect(exitCode).toBe(0);
    expect(proc.signalCode).toBe(null);

    expect(proc.kill("SIGTERM")).toBe(false);
    expect(proc.kill(0)).toBe(false);
  });

  test.if(isPosix)("Bun.spawn subprocess.kill() returns true while alive", async () => {
    await using proc = bunSpawn({
      cmd: ["cat"],
      env: bunEnv,
      stdio: ["pipe", "ignore", "ignore"],
    });

    try {
      expect(proc.kill(0)).toBe(true);
    } finally {
      proc.kill("SIGKILL");
      await proc.exited;
    }
  });
});
