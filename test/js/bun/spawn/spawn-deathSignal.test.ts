import { describe, expect, test } from "bun:test";
import {
  bunEnv,
  bunExe,
  isLinux,
  isProcessAlive,
  killProcesses,
  readFirstLine,
  tempDir,
  waitForProcessExit,
} from "harness";

// Bun.spawn({ deathSignal }): sets prctl(PR_SET_PDEATHSIG) in the child
// between vfork and exec, so the kernel delivers `deathSignal` to the child
// when the spawning thread dies. Linux only; no-op elsewhere.

describe.skipIf(!isLinux)("Bun.spawn deathSignal", () => {
  // Middle bun process spawns a plain sh with deathSignal set, prints the
  // sh pid, then idles. We SIGKILL the middle process and observe whether
  // sh survives. sh is not a bun process, so this isolates PR_SET_PDEATHSIG
  // from --no-orphans env-var inheritance.
  const fixture = (deathSignal: string | number | undefined) => `
    const child = Bun.spawn({
      cmd: ["/bin/sh", "-c", "echo $$; while :; do sleep 1; done"],
      stdio: ["ignore", "pipe", "inherit"],
      ${deathSignal !== undefined ? `deathSignal: ${JSON.stringify(deathSignal)},` : ""}
    });
    let line = "";
    const reader = child.stdout.getReader();
    const dec = new TextDecoder();
    while (!line.includes("\\n")) {
      const { value, done } = await reader.read();
      if (done) break;
      line += dec.decode(value, { stream: true });
    }
    reader.releaseLock();
    console.log(line.trim());
    setInterval(() => {}, 1e6);
  `;

  async function spawnPair(deathSignal: string | number | undefined) {
    using dir = tempDir("deathSignal", { "middle.js": fixture(deathSignal) });
    const env: Record<string, string> = { ...bunEnv };
    delete env.BUN_FEATURE_FLAG_NO_ORPHANS;
    const middle = Bun.spawn({
      cmd: [bunExe(), "middle.js"],
      cwd: String(dir),
      env,
      stdio: ["ignore", "pipe", "inherit"],
    });
    let shPid = NaN;
    try {
      shPid = Number(await readFirstLine(middle.stdout));
      expect(shPid).toBeGreaterThan(1);
      expect(isProcessAlive(shPid)).toBe(true);
      return { middle, shPid };
    } catch (e) {
      middle.kill("SIGKILL");
      killProcesses(shPid);
      throw e;
    }
  }

  test("without deathSignal, child outlives a SIGKILLed parent", async () => {
    const { middle, shPid } = await spawnPair(undefined);
    await using _ = middle;
    try {
      process.kill(middle.pid!, "SIGKILL");
      await middle.exited;
      // sh must NOT die; it is simply orphaned.
      const died = await waitForProcessExit(shPid, 1000);
      expect(died).toBe(false);
    } finally {
      killProcesses(shPid);
    }
  });

  test("deathSignal: 'SIGKILL' kills the child when its parent dies", async () => {
    const { middle, shPid } = await spawnPair("SIGKILL");
    await using _ = middle;
    try {
      process.kill(middle.pid!, "SIGKILL");
      await middle.exited;
      // PR_SET_PDEATHSIG delivers SIGKILL to sh as soon as the spawning
      // thread (middle's main thread) exits.
      const died = await waitForProcessExit(shPid, 10000);
      expect(died).toBe(true);
    } finally {
      killProcesses(shPid);
    }
  });

  test("deathSignal: 9 (numeric signal)", async () => {
    const { middle, shPid } = await spawnPair(9);
    await using _ = middle;
    try {
      process.kill(middle.pid!, "SIGKILL");
      await middle.exited;
      const died = await waitForProcessExit(shPid, 10000);
      expect(died).toBe(true);
    } finally {
      killProcesses(shPid);
    }
  });

  test("deathSignal: 'SIGTERM' (catchable signal) is delivered", async () => {
    const { middle, shPid } = await spawnPair("SIGTERM");
    await using _ = middle;
    try {
      process.kill(middle.pid!, "SIGKILL");
      await middle.exited;
      const died = await waitForProcessExit(shPid, 10000);
      expect(died).toBe(true);
    } finally {
      killProcesses(shPid);
    }
  });

  test("deathSignal does not fire while the parent is alive", async () => {
    const { middle, shPid } = await spawnPair("SIGKILL");
    await using _ = middle;
    try {
      const diedEarly = await waitForProcessExit(shPid, 1000);
      expect(diedEarly).toBe(false);
    } finally {
      killProcesses(shPid);
    }
  });
});

// Option validation happens before the platform-specific spawn, so it is the
// same everywhere (on macOS and Windows a valid deathSignal is then ignored).
describe("Bun.spawn deathSignal validation", () => {
  // Returns the error thrown by Bun.spawn for these options. If nothing was
  // thrown, the stray child is killed and the test fails.
  async function spawnError(opts: Record<string, unknown>) {
    let proc: Bun.Subprocess;
    try {
      proc = Bun.spawn({ cmd: [bunExe(), "-e", ""], env: bunEnv, ...opts });
    } catch (e: any) {
      return { name: e.name, code: e.code, message: e.message };
    }
    proc.kill();
    await proc.exited;
    throw new Error(`Bun.spawn(${JSON.stringify(opts)}) did not throw`);
  }

  test("rejects a signal name that does not exist", async () => {
    expect(await spawnError({ deathSignal: "NOT_A_SIGNAL" })).toEqual({
      name: "TypeError",
      code: "ERR_INVALID_ARG_TYPE",
      message: expect.stringContaining("'SIGKILL'"),
    });
  });

  test("rejects a negative signal number", async () => {
    expect(await spawnError({ deathSignal: -1 })).toEqual({
      name: "TypeError",
      code: "ERR_INVALID_ARG_TYPE",
      message: "Invalid signal: must be >= 0",
    });
  });

  test("rejects 0, exactly like killSignal: 0", async () => {
    const expected = {
      name: "TypeError",
      code: "ERR_UNKNOWN_SIGNAL",
      message: "Unknown signal: 0",
    };
    expect(await spawnError({ deathSignal: 0 })).toEqual(expected);
    expect(await spawnError({ killSignal: 0 })).toEqual(expected);
  });

  test.concurrent.each([["SIGKILL"], [9], [undefined], [null]])("accepts deathSignal: %p", async deathSignal => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", "process.exit(0)"],
      env: bunEnv,
      deathSignal: deathSignal as any,
    });
    expect(await proc.exited).toBe(0);
  });
});
