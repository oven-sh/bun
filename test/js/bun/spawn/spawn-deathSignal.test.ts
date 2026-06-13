import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, tempDir } from "harness";
import { setTimeout as sleep } from "node:timers/promises";

// Bun.spawn({ deathSignal }): sets prctl(PR_SET_PDEATHSIG) in the child
// between vfork and exec, so the kernel delivers `deathSignal` to the child
// when the spawning thread dies. Linux only; no-op elsewhere.

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitUntilDead(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isAlive(pid)) return true;
    await sleep(20);
  }
  return !isAlive(pid);
}

function reap(...pids: number[]) {
  for (const pid of pids) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {}
  }
}

async function readLine(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const dec = new TextDecoder();
  let line = "";
  while (!line.includes("\n")) {
    const { value, done } = await reader.read();
    if (done) break;
    line += dec.decode(value, { stream: true });
  }
  reader.releaseLock();
  return line.trim();
}

describe.skipIf(!isLinux)("Bun.spawn deathSignal", () => {
  // Middle bun process spawns a plain sh with deathSignal set, prints the
  // sh pid, then idles. We SIGKILL the middle process and observe whether
  // sh survives. sh is not a bun process, so this isolates PR_SET_PDEATHSIG
  // from --no-orphans env-var inheritance.
  const fixture = (deathSignal: string | number | undefined) => `
    const child = Bun.spawn({
      cmd: ["/bin/sh", "-c", "echo $$; while :; do sleep 30; done"],
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
    const shPid = Number(await readLine(middle.stdout));
    expect(shPid).toBeGreaterThan(1);
    expect(isAlive(shPid)).toBe(true);
    return { middle, shPid };
  }

  test("without deathSignal, child outlives a SIGKILLed parent", async () => {
    const { middle, shPid } = await spawnPair(undefined);
    await using _ = middle;
    try {
      process.kill(middle.pid!, "SIGKILL");
      await middle.exited;
      // sh must NOT die — it is simply orphaned.
      const died = await waitUntilDead(shPid, 1000);
      expect(died).toBe(false);
    } finally {
      reap(shPid);
    }
  });

  test("deathSignal: 'SIGKILL' — child dies with its parent", async () => {
    const { middle, shPid } = await spawnPair("SIGKILL");
    await using _ = middle;
    try {
      process.kill(middle.pid!, "SIGKILL");
      await middle.exited;
      // PR_SET_PDEATHSIG delivers SIGKILL to sh as soon as the spawning
      // thread (middle's main thread) exits.
      const died = await waitUntilDead(shPid, 10000);
      expect(died).toBe(true);
    } finally {
      reap(shPid);
    }
  });

  test("deathSignal: 9 — numeric signal", async () => {
    const { middle, shPid } = await spawnPair(9);
    await using _ = middle;
    try {
      process.kill(middle.pid!, "SIGKILL");
      await middle.exited;
      const died = await waitUntilDead(shPid, 10000);
      expect(died).toBe(true);
    } finally {
      reap(shPid);
    }
  });

  test("deathSignal: 'SIGTERM' — catchable signal is delivered", async () => {
    const { middle, shPid } = await spawnPair("SIGTERM");
    await using _ = middle;
    try {
      process.kill(middle.pid!, "SIGKILL");
      await middle.exited;
      const died = await waitUntilDead(shPid, 10000);
      expect(died).toBe(true);
    } finally {
      reap(shPid);
    }
  });

  test("deathSignal does not fire while the parent is alive", async () => {
    const { middle, shPid } = await spawnPair("SIGKILL");
    await using _ = middle;
    try {
      const diedEarly = await waitUntilDead(shPid, 1000);
      expect(diedEarly).toBe(false);
    } finally {
      reap(shPid);
    }
  });

  test("rejects invalid deathSignal", () => {
    expect(() =>
      Bun.spawn({
        cmd: [bunExe(), "-e", ""],
        env: bunEnv,
        deathSignal: "NOT_A_SIGNAL" as any,
      }),
    ).toThrow();
    expect(() =>
      Bun.spawn({
        cmd: [bunExe(), "-e", ""],
        env: bunEnv,
        deathSignal: -1 as any,
      }),
    ).toThrow();
  });
});

// On macOS and Windows, deathSignal is accepted but ignored.
test.skipIf(isLinux)("deathSignal is accepted (no-op) on non-Linux", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", "process.exit(0)"],
    env: bunEnv,
    deathSignal: "SIGKILL",
  });
  await proc.exited;
  expect(proc.exitCode).toBe(0);
});
