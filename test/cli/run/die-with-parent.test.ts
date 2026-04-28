import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { setTimeout as sleep } from "node:timers/promises";

// BUN_DIE_WITH_PARENT: Bun watches its original ppid and exits when that
// process dies, even if the parent was SIGKILLed and couldn't signal us.
// macOS uses kqueue NOTE_EXIT; Linux uses prctl(PR_SET_PDEATHSIG).
//
// Tree: test → sh (the "parent" we SIGKILL) → bun-debug.
// We SIGKILL sh and observe whether bun survives.

const isPosix = process.platform !== "win32";

async function spawnTree(dieWithParent: string | undefined) {
  // bun child writes "pid ppid" to stdout once it's up; the test reads sh's
  // stdout (inherited by bun) before SIGKILLing sh.
  const env: Record<string, string> = { ...bunEnv };
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

  const reader = sh.stdout.getReader();
  const { value } = await reader.read();
  reader.releaseLock();
  const [bunPid, bunPpid] = new TextDecoder()
    .decode(value)
    .trim()
    .split(" ")
    .map(Number);
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

test.skipIf(!isPosix)(
  "without BUN_DIE_WITH_PARENT, bun is orphaned when its parent is SIGKILLed",
  async () => {
    const { sh, bunPid } = await spawnTree(undefined);
    process.kill(sh.pid!, "SIGKILL");
    await sh.exited;
    await sleep(1000);
    const orphaned = isAlive(bunPid);
    if (orphaned) process.kill(bunPid, "SIGKILL");
    expect(orphaned).toBe(true);
  },
);

test.skipIf(!isPosix)(
  "BUN_DIE_WITH_PARENT=1: bun exits when its parent is SIGKILLed",
  async () => {
    const { sh, bunPid } = await spawnTree("1");
    process.kill(sh.pid!, "SIGKILL");
    await sh.exited;
    // kqueue NOTE_EXIT fires effectively immediately; allow scheduling slop.
    await sleep(1000);
    const alive = isAlive(bunPid);
    if (alive) process.kill(bunPid, "SIGKILL");
    expect(alive).toBe(false);
  },
);

test.skipIf(!isPosix)(
  "BUN_DIE_WITH_PARENT=0 is treated as unset",
  async () => {
    const { sh, bunPid } = await spawnTree("0");
    process.kill(sh.pid!, "SIGKILL");
    await sh.exited;
    await sleep(1000);
    const alive = isAlive(bunPid);
    if (alive) process.kill(bunPid, "SIGKILL");
    expect(alive).toBe(true);
  },
);

test.skipIf(!isPosix)(
  "BUN_DIE_WITH_PARENT=1 does not fire while the parent is alive",
  async () => {
    const { sh, bunPid } = await spawnTree("1");
    await sleep(1000);
    expect(isAlive(bunPid)).toBe(true);
    process.kill(sh.pid!, "SIGKILL");
    await sh.exited;
    await sleep(1000);
    if (isAlive(bunPid)) process.kill(bunPid, "SIGKILL");
  },
);
