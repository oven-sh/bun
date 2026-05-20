import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isPosix, tempDir } from "harness";
import { setTimeout as sleep } from "node:timers/promises";

// Subprocess.killTree(signal): walks the process tree rooted at the
// subprocess and signals every descendant. Shares the freeze-verify-signal
// machinery with `--no-orphans` (/proc/<pid>/task/*/children on Linux,
// proc_listchildpids on macOS). POSIX only; on Windows it falls back to
// signalling just the root.

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

// root.js (bun) spawns child.js (bun) which spawns an outer sh, which
// itself spawns an inner sh in the background. root.js prints the four
// pids on one line once the whole chain is up, then everything idles.
// Four distinct levels so killTree() has to recurse past the direct child.
const fixture = tempDir("spawn-killTree", {
  "root.js": `
    const child = Bun.spawn({
      cmd: [process.execPath, "child.js"],
      cwd: import.meta.dir,
      stdio: ["ignore", "pipe", "inherit"],
      env: process.env,
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
    console.log(process.pid + " " + line.trim());
    setInterval(() => {}, 1e6);
  `,
  // Outer sh backgrounds an inner sh ($!), prints both pids, then waits —
  // so both stay alive and are distinct from gc.pid (== outer sh's $$).
  "child.js": `
    const gc = Bun.spawn({
      cmd: [
        "/bin/sh", "-c",
        "/bin/sh -c 'while :; do sleep 30; done' & echo $$ $!; wait",
      ],
      stdio: ["ignore", "pipe", "inherit"],
    });
    let line = "";
    const reader = gc.stdout.getReader();
    const dec = new TextDecoder();
    while (!line.includes("\\n")) {
      const { value, done } = await reader.read();
      if (done) break;
      line += dec.decode(value, { stream: true });
    }
    reader.releaseLock();
    // line is "<outer-sh-pid> <inner-sh-pid>"; outer == gc.pid.
    console.log(process.pid + " " + line.trim());
    setInterval(() => {}, 1e6);
  `,
});

async function spawnTree() {
  const env: Record<string, string> = { ...bunEnv };
  // Isolate from an ambient --no-orphans so we're testing killTree() alone.
  delete env.BUN_FEATURE_FLAG_NO_ORPHANS;

  const proc = Bun.spawn({
    cmd: [bunExe(), "root.js"],
    cwd: String(fixture),
    env,
    stdio: ["ignore", "pipe", "inherit"],
  });

  const reader = proc.stdout.getReader();
  const dec = new TextDecoder();
  let line = "";
  while (!line.includes("\n")) {
    const { value, done } = await reader.read();
    if (done) break;
    line += dec.decode(value, { stream: true });
  }
  reader.releaseLock();

  const [rootPid, childPid, outerShPid, innerShPid] = line.trim().split(/\s+/).map(Number);
  expect(rootPid).toBe(proc.pid);
  expect(childPid).toBeGreaterThan(1);
  expect(outerShPid).toBeGreaterThan(1);
  expect(innerShPid).toBeGreaterThan(1);
  // Four distinct pids — no level of the tree is collapsed.
  expect(new Set([rootPid, childPid, outerShPid, innerShPid]).size).toBe(4);
  expect(isAlive(childPid)).toBe(true);
  expect(isAlive(outerShPid)).toBe(true);
  expect(isAlive(innerShPid)).toBe(true);

  return { proc, rootPid, childPid, outerShPid, innerShPid };
}

describe.skipIf(!isPosix)("Subprocess.killTree()", () => {
  test("exists and is a function", async () => {
    await using proc = Bun.spawn({ cmd: [bunExe(), "-e", "setTimeout(()=>{}, 1e6)"], env: bunEnv });
    expect(typeof proc.killTree).toBe("function");
    expect(proc.killTree.length).toBe(1);
  });

  test("default signal kills the root and every descendant", async () => {
    const { proc, childPid, outerShPid, innerShPid } = await spawnTree();
    await using _ = proc;
    try {
      proc.killTree();
      await proc.exited;

      const childDied = await waitUntilDead(childPid, 10000);
      const outerShDied = await waitUntilDead(outerShPid, 10000);
      const innerShDied = await waitUntilDead(innerShPid, 10000);

      expect(proc.exitCode === null ? proc.signalCode : proc.exitCode).not.toBe(0);
      expect({ childDied, outerShDied, innerShDied }).toEqual({
        childDied: true,
        outerShDied: true,
        innerShDied: true,
      });
    } finally {
      reap(childPid, outerShPid, innerShPid);
    }
  });

  test("plain kill() does NOT reach descendants (contrast case)", async () => {
    const { proc, childPid, outerShPid, innerShPid } = await spawnTree();
    await using _ = proc;
    try {
      proc.kill("SIGKILL");
      await proc.exited;

      // The direct child becomes orphaned (reparented to init) but keeps
      // running — this is what killTree() fixes.
      const childDied = await waitUntilDead(childPid, 1000);
      expect(childDied).toBe(false);
    } finally {
      reap(childPid, outerShPid, innerShPid);
    }
  });

  test("accepts a signal name", async () => {
    const { proc, childPid, outerShPid, innerShPid } = await spawnTree();
    await using _ = proc;
    try {
      proc.killTree("SIGKILL");
      await proc.exited;

      const childDied = await waitUntilDead(childPid, 10000);
      const outerShDied = await waitUntilDead(outerShPid, 10000);
      const innerShDied = await waitUntilDead(innerShPid, 10000);

      expect(proc.signalCode).toBe("SIGKILL");
      expect({ childDied, outerShDied, innerShDied }).toEqual({
        childDied: true,
        outerShDied: true,
        innerShDied: true,
      });
    } finally {
      reap(childPid, outerShPid, innerShPid);
    }
  });

  test("catchable signal is delivered (SIGCONT wakes stopped descendants)", async () => {
    // SIGSTOP → verify → SIGTERM → SIGCONT: the descendant must actually
    // receive SIGTERM rather than stay frozen with it pending.
    using dir = tempDir("killTree-catchable", {
      "root.js": `
        const child = Bun.spawn({
          cmd: ["/bin/sh", "-c", "echo $$; while :; do sleep 30; done"],
          stdio: ["ignore", "pipe", "inherit"],
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
        console.log(process.pid + " " + child.pid + " " + line.trim());
        setInterval(() => {}, 1e6);
      `,
    });

    const env: Record<string, string> = { ...bunEnv };
    delete env.BUN_FEATURE_FLAG_NO_ORPHANS;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "root.js"],
      cwd: String(dir),
      env,
      stdio: ["ignore", "pipe", "inherit"],
    });

    const reader = proc.stdout.getReader();
    const dec = new TextDecoder();
    let line = "";
    while (!line.includes("\n")) {
      const { value, done } = await reader.read();
      if (done) break;
      line += dec.decode(value, { stream: true });
    }
    reader.releaseLock();
    const [, childPid, shPid] = line.trim().split(/\s+/).map(Number);
    expect(isAlive(childPid)).toBe(true);
    expect(isAlive(shPid)).toBe(true);

    try {
      proc.killTree("SIGTERM");
      await proc.exited;

      const childDied = await waitUntilDead(childPid, 10000);
      const shDied = await waitUntilDead(shPid, 10000);

      expect(proc.signalCode).toBe("SIGTERM");
      expect({ childDied, shDied }).toEqual({ childDied: true, shDied: true });
    } finally {
      reap(childPid, shPid);
    }
  });

  test("is a no-op once the process has already exited", async () => {
    await using proc = Bun.spawn({ cmd: [bunExe(), "-e", ""], env: bunEnv });
    await proc.exited;
    expect(() => proc.killTree()).not.toThrow();
    expect(() => proc.killTree("SIGKILL")).not.toThrow();
  });

  test("rejects invalid signals the same way kill() does", async () => {
    await using proc = Bun.spawn({ cmd: [bunExe(), "-e", "setTimeout(()=>{}, 1e6)"], env: bunEnv });
    expect(() => proc.killTree(-1)).toThrow();
    expect(() => proc.killTree("NOT_A_SIGNAL" as any)).toThrow();
  });

  test("killTree(0) is a liveness probe and does not pause descendants", async () => {
    const { proc, childPid, outerShPid, innerShPid } = await spawnTree();
    await using _ = proc;
    try {
      expect(() => proc.killTree(0)).not.toThrow();
      // Descendants must still be alive and, crucially, still running —
      // not stuck SIGSTOPped. We can't directly observe run state
      // portably, so just confirm liveness and that the root wasn't
      // signalled.
      expect(isAlive(childPid)).toBe(true);
      expect(isAlive(outerShPid)).toBe(true);
      expect(isAlive(innerShPid)).toBe(true);
      expect(proc.killed).toBe(false);
    } finally {
      reap(childPid, outerShPid, innerShPid);
    }
  });
});
