import { spawn as bunSpawn } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isPosix } from "harness";
import { spawn } from "node:child_process";
import { once } from "node:events";

// https://github.com/oven-sh/bun/issues/29001 — kill() must return false
// once the child has exited, matching Node.
describe.concurrent("issue #29001 — kill() reports failure after exit", () => {
  test.if(isPosix)("node:child_process ChildProcess.kill() returns false after exit", async () => {
    const proc = spawn(bunExe(), ["-e", "process.exit(0)"], {
      env: bunEnv,
      stdio: "ignore",
    });

    // Assert the clean exit first so a fixture crash surfaces clearly.
    const [code, signal] = await once(proc, "close");
    expect(code).toBe(0);
    expect(signal).toBe(null);

    expect(proc.kill("SIGTERM")).toBe(false);
    expect(proc.kill("SIGQUIT")).toBe(false);
    expect(proc.kill(0)).toBe(false);

    // Child exited on its own — proc.killed only flips on our signal.
    expect(proc.killed).toBe(false);
  });

  test.if(isPosix)("node:child_process ChildProcess.kill() returns true while alive", async () => {
    const proc = spawn("cat", [], { stdio: ["pipe", "ignore", "ignore"] });

    try {
      // Signal 0 is an existence probe — succeeds but must not mark killed.
      expect(proc.kill(0)).toBe(true);
      expect(proc.killed).toBe(false);
    } finally {
      proc.kill("SIGKILL");
      await once(proc, "close");
    }
  });

  // These Bun.spawn tests cover the cross-platform hasExited() fast path
  // in Subprocess.tryKill (short-circuits before Process.kill), so they
  // don't exercise the OS-level ESRCH branch.
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
