import { spawn } from "node:child_process";
import { spawn as bunSpawn } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isPosix } from "harness";
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

    // Wait for the child to actually exit.
    await once(proc, "close");

    // Every kill attempt must now report failure — the process is gone.
    expect(proc.kill("SIGTERM")).toBe(false);
    expect(proc.kill("SIGQUIT")).toBe(false);
    // Signal 0 is the existence probe; it must also report failure.
    expect(proc.kill(0)).toBe(false);
  });

  test.if(isPosix)("node:child_process ChildProcess.kill() returns true while alive", async () => {
    // `cat` with no stdin sits around until we kill it.
    const proc = spawn("cat", [], { stdio: ["pipe", "ignore", "ignore"] });

    try {
      // Signal 0 does not terminate but should report success.
      expect(proc.kill(0)).toBe(true);
    } finally {
      proc.kill("SIGKILL");
      await once(proc, "close");
    }
  });

  test.if(isPosix)("Bun.spawn subprocess.kill() returns false after exit", async () => {
    await using proc = bunSpawn({
      cmd: [bunExe(), "-e", "process.exit(0)"],
      env: bunEnv,
      stdio: ["ignore", "ignore", "ignore"],
    });

    await proc.exited;

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
