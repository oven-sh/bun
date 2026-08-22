import { afterAll, describe, expect, test } from "bun:test";
import {
  bunEnv,
  bunExe,
  isLinux,
  isMacOS,
  isProcessAlive,
  killProcesses,
  readFirstLine,
  tempDir,
  waitForProcessExit,
} from "harness";
import { readFileSync } from "node:fs";

// Subprocess.killTree(signal): walks the process tree rooted at the
// subprocess and signals every descendant. Shares the freeze-verify-signal
// machinery with `--no-orphans` (/proc/<pid>/task/*/children on Linux,
// proc_listchildpids on macOS). On Windows and other POSIX targets it
// falls back to signalling just the root, so the descendant-death
// assertions below are gated on Linux/macOS specifically.

// Linux only. The state char follows the parenthesised comm, which may itself contain spaces.
function procState(pid: number): string {
  const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
  return stat.charAt(stat.lastIndexOf(")") + 2);
}

// A signal takes effect shortly after kill() returns, not synchronously, so poll before asserting.
async function waitForStates(pids: number[], want: RegExp): Promise<string[]> {
  const deadline = Date.now() + 5000;
  let states = pids.map(procState);
  while (!states.every(s => want.test(s)) && Date.now() < deadline) {
    await Bun.sleep(10);
    states = pids.map(procState);
  }
  return states;
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
  // Outer sh backgrounds an inner sh ($!), prints both pids, then waits,
  // so both stay alive and are distinct from gc.pid (== outer sh's $$).
  "child.js": `
    const gc = Bun.spawn({
      cmd: [
        "/bin/sh", "-c",
        "/bin/sh -c 'while :; do sleep 1; done' & echo $$ $!; wait",
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
afterAll(() => fixture[Symbol.dispose]());

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

  // Whatever has been started so far is torn down if a setup assertion below fails.
  let descendants: number[] = [];
  try {
    const line = await readFirstLine(proc.stdout);
    const [rootPid, childPid, outerShPid, innerShPid] = line.split(/\s+/).map(Number);
    descendants = [childPid, outerShPid, innerShPid];
    expect(rootPid).toBe(proc.pid);
    expect(childPid).toBeGreaterThan(1);
    expect(outerShPid).toBeGreaterThan(1);
    expect(innerShPid).toBeGreaterThan(1);
    // Four distinct pids: no level of the tree is collapsed.
    expect(new Set([rootPid, childPid, outerShPid, innerShPid]).size).toBe(4);
    expect(isProcessAlive(childPid)).toBe(true);
    expect(isProcessAlive(outerShPid)).toBe(true);
    expect(isProcessAlive(innerShPid)).toBe(true);

    return { proc, rootPid, childPid, outerShPid, innerShPid };
  } catch (e) {
    proc.kill("SIGKILL");
    killProcesses(...descendants);
    throw e;
  }
}

// Argument handling and the root-process behaviour are the same on every
// platform (elsewhere than Linux/macOS, killTree() is exactly kill()).
test("exists and is a function", async () => {
  await using proc = Bun.spawn({ cmd: [bunExe(), "-e", "setTimeout(()=>{}, 1e6)"], env: bunEnv });
  expect(typeof proc.killTree).toBe("function");
  expect(proc.killTree.length).toBe(1);
});

test("kills the root process with SIGTERM by default", async () => {
  await using proc = Bun.spawn({ cmd: [bunExe(), "-e", "setTimeout(()=>{}, 1e6)"], env: bunEnv });
  proc.killTree();
  await proc.exited;
  expect({ killed: proc.killed, exitCode: proc.exitCode, signalCode: proc.signalCode }).toEqual({
    killed: true,
    exitCode: null,
    signalCode: "SIGTERM",
  });
});

test("is a no-op once the process has already exited", async () => {
  await using proc = Bun.spawn({ cmd: [bunExe(), "-e", ""], env: bunEnv });
  await proc.exited;
  expect(() => proc.killTree()).not.toThrow();
  expect(() => proc.killTree("SIGKILL")).not.toThrow();
});

test("rejects invalid signals the same way kill() does", async () => {
  await using proc = Bun.spawn({ cmd: [bunExe(), "-e", "setTimeout(()=>{}, 1e6)"], env: bunEnv });

  function thrownBy(fn: () => void) {
    try {
      fn();
    } catch (e: any) {
      return { name: e.name, code: e.code, message: e.message };
    }
    throw new Error("expected a throw");
  }

  for (const sig of [-1, 32, 1.5, "NOT_A_SIGNAL", {}] as any[]) {
    expect(thrownBy(() => proc.killTree(sig))).toEqual(thrownBy(() => proc.kill(sig)));
  }

  expect(() => proc.killTree(-1)).toThrow(
    expect.objectContaining({
      name: "TypeError",
      code: "ERR_INVALID_ARG_TYPE",
      message: "Invalid signal: must be >= 0",
    }),
  );
  expect(() => proc.killTree("NOT_A_SIGNAL" as any)).toThrow(
    expect.objectContaining({
      name: "TypeError",
      code: "ERR_INVALID_ARG_TYPE",
      message: expect.stringContaining("'SIGTERM'"),
    }),
  );

  // Nothing above may have signalled the process.
  expect(proc.killed).toBe(false);
});

describe.skipIf(!(isLinux || isMacOS))("Subprocess.killTree() process tree", () => {
  test("default signal kills the root and every descendant", async () => {
    const { proc, childPid, outerShPid, innerShPid } = await spawnTree();
    await using _ = proc;
    try {
      proc.killTree();
      await proc.exited;

      const childDied = await waitForProcessExit(childPid, 10000);
      const outerShDied = await waitForProcessExit(outerShPid, 10000);
      const innerShDied = await waitForProcessExit(innerShPid, 10000);

      expect(proc.exitCode === null ? proc.signalCode : proc.exitCode).not.toBe(0);
      expect({ childDied, outerShDied, innerShDied }).toEqual({
        childDied: true,
        outerShDied: true,
        innerShDied: true,
      });
    } finally {
      killProcesses(childPid, outerShPid, innerShPid);
    }
  });

  test("plain kill() does NOT reach descendants (contrast case)", async () => {
    const { proc, childPid, outerShPid, innerShPid } = await spawnTree();
    await using _ = proc;
    try {
      proc.kill("SIGKILL");
      await proc.exited;

      // The direct child becomes orphaned (reparented to init) but keeps
      // running. This is what killTree() fixes.
      const childDied = await waitForProcessExit(childPid, 1000);
      expect(childDied).toBe(false);
    } finally {
      killProcesses(childPid, outerShPid, innerShPid);
    }
  });

  test("accepts a signal name", async () => {
    const { proc, childPid, outerShPid, innerShPid } = await spawnTree();
    await using _ = proc;
    try {
      proc.killTree("SIGKILL");
      await proc.exited;

      const childDied = await waitForProcessExit(childPid, 10000);
      const outerShDied = await waitForProcessExit(outerShPid, 10000);
      const innerShDied = await waitForProcessExit(innerShPid, 10000);

      expect(proc.signalCode).toBe("SIGKILL");
      expect({ childDied, outerShDied, innerShDied }).toEqual({
        childDied: true,
        outerShDied: true,
        innerShDied: true,
      });
    } finally {
      killProcesses(childPid, outerShPid, innerShPid);
    }
  });

  test("catchable signal is delivered (SIGCONT wakes stopped descendants)", async () => {
    // SIGSTOP, verify, SIGTERM, SIGCONT: the descendant must actually
    // receive SIGTERM rather than stay frozen with it pending. Two levels
    // (root bun, then sh) is enough, since one stopped descendant is all
    // it takes to observe the wake-up.
    using dir = tempDir("killTree-catchable", {
      "root.js": `
        const child = Bun.spawn({
          cmd: ["/bin/sh", "-c", "echo $$; while :; do sleep 1; done"],
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
        // child.pid == sh's $$, so just pass through the sh pid.
        console.log(process.pid + " " + line.trim());
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

    const [rootPid, shPid] = (await readFirstLine(proc.stdout)).split(/\s+/).map(Number);
    try {
      expect(rootPid).toBe(proc.pid);
      expect(isProcessAlive(shPid)).toBe(true);

      proc.killTree("SIGTERM");
      await proc.exited;

      const shDied = await waitForProcessExit(shPid, 10000);

      expect(proc.signalCode).toBe("SIGTERM");
      expect(shDied).toBe(true);
    } finally {
      killProcesses(shPid);
    }
  });

  test("killTree(0) is a liveness probe and does not pause descendants", async () => {
    const { proc, childPid, outerShPid, innerShPid } = await spawnTree();
    await using _ = proc;
    try {
      expect(() => proc.killTree(0)).not.toThrow();
      expect(isProcessAlive(childPid)).toBe(true);
      expect(isProcessAlive(outerShPid)).toBe(true);
      expect(isProcessAlive(innerShPid)).toBe(true);
      expect(proc.killed).toBe(false);
      if (isLinux) {
        // Not merely alive, but not left SIGSTOPped (state "T") either.
        const running = expect.stringMatching(/^[RSD]$/);
        expect({
          child: procState(childPid),
          outerSh: procState(outerShPid),
          innerSh: procState(innerShPid),
        }).toEqual({ child: running, outerSh: running, innerSh: running });
      }
    } finally {
      killProcesses(childPid, outerShPid, innerShPid);
    }
  });

  // Stop signals must not be followed by the SIGCONT that other signals get, or the
  // stop would be undone; SIGCONT itself must leave the tree running.
  test.skipIf(!isLinux)("killTree('SIGSTOP') pauses the whole tree and killTree('SIGCONT') resumes it", async () => {
    const { proc, childPid, outerShPid, innerShPid } = await spawnTree();
    await using _ = proc;
    const pids = [proc.pid, childPid, outerShPid, innerShPid];
    try {
      proc.killTree("SIGSTOP");
      expect(await waitForStates(pids, /^T$/)).toEqual(["T", "T", "T", "T"]);

      proc.killTree("SIGCONT");
      const running = expect.stringMatching(/^[RSD]$/);
      expect(await waitForStates(pids, /^[RSD]$/)).toEqual([running, running, running, running]);

      expect(proc.killed).toBe(false);
    } finally {
      // A SIGKILLed stopped process dies, but its stopped children would not, so take the whole tree down.
      try {
        proc.killTree("SIGKILL");
      } catch {}
      killProcesses(childPid, outerShPid, innerShPid);
    }
  });
});
