import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { setTimeout as sleep } from "node:timers/promises";

// BUN_DIE_WITH_PARENT: Bun watches its original ppid and exits when that
// process dies, even if the parent was SIGKILLed and couldn't signal us.
// macOS uses a libdispatch DISPATCH_SOURCE_TYPE_PROC source; Linux uses
// prctl(PR_SET_PDEATHSIG).
//
// Tree: test → sh (the "parent" we SIGKILL) → bun-debug.
// We SIGKILL sh and observe whether bun survives.

// The watchdog only installs on Linux (prctl) and macOS (kqueue); gate to
// exactly those platforms rather than generic POSIX.
const isSupported = process.platform === "linux" || process.platform === "darwin";

async function spawnTree(dieWithParent: string | undefined) {
  // bun child writes "pid ppid" to stdout once it's up; the test reads sh's
  // stdout (inherited by bun) before SIGKILLing sh.
  const env: Record<string, string> = { ...bunEnv };
  // bunEnv spreads process.env; make sure an ambient BUN_DIE_WITH_PARENT
  // from the test runner doesn't leak into the "unset" case.
  delete env.BUN_DIE_WITH_PARENT;
  if (dieWithParent !== undefined) env.BUN_DIE_WITH_PARENT = dieWithParent;

  const sh = Bun.spawn({
    // Trailing `wait` defeats sh's implicit-exec-of-last-command so sh stays
    // a distinct pid we can SIGKILL independently of bun.
    cmd: [
      "/bin/sh",
      "-c",
      `"${bunExe()}" -e 'console.log(process.pid, process.ppid); setInterval(()=>{}, 1000)' & wait`,
    ],
    env,
    stdout: "pipe",
    stderr: "ignore",
  });

  // A single reader.read() can return a partial chunk; buffer until we see
  // the newline that terminates the "pid ppid" line.
  const reader = sh.stdout.getReader();
  const decoder = new TextDecoder();
  let line = "";
  while (!line.includes("\n")) {
    const { value, done } = await reader.read();
    if (done) break;
    line += decoder.decode(value, { stream: true });
  }
  reader.releaseLock();
  const [bunPid, bunPpid] = line.trim().split(" ").map(Number);
  expect(bunPid).toBeGreaterThan(0);
  expect(bunPpid).toBe(sh.pid);

  return { sh, bunPid };
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Poll `isAlive(pid)` until it returns false or `timeoutMs` elapses.
 * Returns true if the process died within the window, false if it was still
 * alive when the window expired. Used both ways: "must die" asserts true,
 * "must survive" asserts false.
 */
async function waitUntilDead(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isAlive(pid)) return true;
    await sleep(25);
  }
  return !isAlive(pid);
}

test.skipIf(!isSupported)("without BUN_DIE_WITH_PARENT, bun is orphaned when its parent is SIGKILLed", async () => {
  const { sh, bunPid } = await spawnTree(undefined);
  process.kill(sh.pid!, "SIGKILL");
  await sh.exited;
  // bun must NOT die: poll for death and expect the poll to time out.
  const died = await waitUntilDead(bunPid, 1000);
  if (isAlive(bunPid)) process.kill(bunPid, "SIGKILL");
  expect(died).toBe(false);
});

test.skipIf(!isSupported)(
  "BUN_DIE_WITH_PARENT=1: bun exits when its parent is SIGKILLed",
  async () => {
    const { sh, bunPid } = await spawnTree("1");
    process.kill(sh.pid!, "SIGKILL");
    await sh.exited;
    // kqueue NOTE_EXIT / PDEATHSIG fire effectively immediately; poll until
    // bun is gone rather than sleeping a fixed interval.
    const died = await waitUntilDead(bunPid, 10000);
    if (isAlive(bunPid)) process.kill(bunPid, "SIGKILL");
    expect(died).toBe(true);
  },
  30000,
);

test.skipIf(!isSupported)("BUN_DIE_WITH_PARENT=0 is treated as unset", async () => {
  const { sh, bunPid } = await spawnTree("0");
  process.kill(sh.pid!, "SIGKILL");
  await sh.exited;
  const died = await waitUntilDead(bunPid, 1000);
  if (isAlive(bunPid)) process.kill(bunPid, "SIGKILL");
  expect(died).toBe(false);
});

test.skipIf(!isSupported)(
  "BUN_DIE_WITH_PARENT=1 does not fire while the parent is alive",
  async () => {
    const { sh, bunPid } = await spawnTree("1");
    // Parent is alive; bun must stay alive. Poll for premature death.
    const diedEarly = await waitUntilDead(bunPid, 1000);
    expect(diedEarly).toBe(false);
    process.kill(sh.pid!, "SIGKILL");
    await sh.exited;
    const diedAfter = await waitUntilDead(bunPid, 10000);
    if (isAlive(bunPid)) process.kill(bunPid, "SIGKILL");
    expect(diedAfter).toBe(true);
  },
  30000,
);
