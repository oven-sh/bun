import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { setTimeout as sleep } from "node:timers/promises";

// BUN_FEATURE_FLAG_DIE_WITH_PARENT: Bun watches its original ppid and exits when that
// process dies, even if the parent was SIGKILLed and couldn't signal us. On
// the way out it also recursively SIGKILLs every descendant so nothing it
// spawned outlives it. Linux uses prctl(PR_SET_PDEATHSIG); macOS registers
// EVFILT_PROC/NOTE_EXIT on the existing event loop's kqueue (no thread).
//
// Tree under test: test → sh (the "parent" we SIGKILL) → bun-debug → grandchild.
// We SIGKILL sh and observe bun-debug and the grandchild.

const isSupported = process.platform === "linux" || process.platform === "darwin";

// Shared fixture dir — child.js spawns grandchild.js, prints
// "<self> <ppid> <grandchild>", then idles. Kept on disk so we can pass it
// through /bin/sh without fighting shell quoting of an inline -e payload.
const fixture = tempDir("die-with-parent", {
  // The grandchild must finish its own ParentDeathWatchdog.install() (and on
  // Linux, prctl) before the test SIGKILLs sh, otherwise the cascade can miss
  // it. install() runs in main() before any JS, so once this process has
  // produced a byte on stdout we know its prctl is in place.
  "grandchild.js": `
    process.stdout.write("r");
    setInterval(()=>{}, 1000);
  `,
  "child.js": `
    const gc = Bun.spawn({
      cmd: [process.execPath, "grandchild.js"],
      cwd: import.meta.dir,
      stdio: ["ignore", "pipe", "ignore"],
    });
    // Block on the grandchild's readiness byte before announcing pids — the
    // test reads our line as the "go" signal.
    await gc.stdout.getReader().read();
    console.log(process.pid, process.ppid, gc.pid);
    setInterval(()=>{}, 1000);
  `,
  // Same shape as child.js, but the grandchild is plain /bin/sh — never calls
  // prctl itself, so reaping it proves the spawn-side linux_pdeathsig (Linux)
  // and the libproc walk (macOS) cover non-Bun descendants.
  "child-nonbun.js": `
    const gc = Bun.spawn({
      cmd: ["/bin/sh", "-c", "echo r; while :; do sleep 1; done"],
      stdio: ["ignore", "pipe", "ignore"],
    });
    await gc.stdout.getReader().read();
    console.log(process.pid, process.ppid, gc.pid);
    setInterval(()=>{}, 1000);
  `,
  // Spawns a grandchild, prints its pid, then exits cleanly. Exercises the
  // descendant reaper independently of the parent-watch path.
  "clean-exit.js": `
    const gc = Bun.spawn({
      cmd: [process.execPath, "grandchild.js"],
      cwd: import.meta.dir,
      stdio: ["ignore", "pipe", "ignore"],
    });
    await gc.stdout.getReader().read();
    gc.unref();
    console.log(gc.pid);
    process.exit(0);
  `,
});

async function spawnTree(dieWithParent: string | undefined, childScript = "child.js") {
  const env: Record<string, string> = { ...bunEnv };
  // bunEnv spreads process.env; make sure an ambient BUN_FEATURE_FLAG_DIE_WITH_PARENT from
  // the test runner doesn't leak into the "unset" case.
  delete env.BUN_FEATURE_FLAG_DIE_WITH_PARENT;
  if (dieWithParent !== undefined) env.BUN_FEATURE_FLAG_DIE_WITH_PARENT = dieWithParent;

  const sh = Bun.spawn({
    // Trailing `wait` defeats sh's implicit-exec-of-last-command so sh stays a
    // distinct pid we can SIGKILL independently of bun.
    cmd: ["/bin/sh", "-c", `"${bunExe()}" "${String(fixture)}/${childScript}" & wait`],
    env,
    stdout: "pipe",
    stderr: "ignore",
  });

  // A single reader.read() can return a partial chunk; buffer until we see the
  // newline that terminates the "pid ppid grandchild" line.
  const reader = sh.stdout.getReader();
  const decoder = new TextDecoder();
  let line = "";
  while (!line.includes("\n")) {
    const { value, done } = await reader.read();
    if (done) break;
    line += decoder.decode(value, { stream: true });
  }
  reader.releaseLock();
  const [bunPid, bunPpid, grandchildPid] = line.trim().split(" ").map(Number);
  expect(bunPid).toBeGreaterThan(0);
  expect(bunPpid).toBe(sh.pid);
  expect(grandchildPid).toBeGreaterThan(0);

  return { sh, bunPid, grandchildPid };
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
 * Returns true if the process died within the window. Used both ways:
 * "must die" asserts true, "must survive" asserts false.
 */
async function waitUntilDead(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isAlive(pid)) return true;
    await sleep(25);
  }
  return !isAlive(pid);
}

function reap(...pids: number[]) {
  for (const pid of pids) {
    if (isAlive(pid)) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {}
    }
  }
}

test.skipIf(!isSupported)(
  "without BUN_FEATURE_FLAG_DIE_WITH_PARENT, bun is orphaned when its parent is SIGKILLed",
  async () => {
    const { sh, bunPid, grandchildPid } = await spawnTree(undefined);
    process.kill(sh.pid!, "SIGKILL");
    await sh.exited;
    // bun must NOT die: poll for death and expect the poll to time out.
    const died = await waitUntilDead(bunPid, 1000);
    reap(bunPid, grandchildPid);
    expect(died).toBe(false);
  },
);

test.skipIf(!isSupported)("BUN_FEATURE_FLAG_DIE_WITH_PARENT=1: bun exits when its parent is SIGKILLed", async () => {
  const { sh, bunPid, grandchildPid } = await spawnTree("1");
  process.kill(sh.pid!, "SIGKILL");
  await sh.exited;
  // kqueue NOTE_EXIT / PDEATHSIG fire effectively immediately; poll until
  // bun is gone rather than sleeping a fixed interval.
  const died = await waitUntilDead(bunPid, 10000);
  reap(bunPid, grandchildPid);
  expect(died).toBe(true);
});

test.skipIf(!isSupported)(
  "BUN_FEATURE_FLAG_DIE_WITH_PARENT=1: grandchildren are reaped when bun dies with its parent",
  async () => {
    const { sh, bunPid, grandchildPid } = await spawnTree("1");
    expect(isAlive(grandchildPid)).toBe(true);
    process.kill(sh.pid!, "SIGKILL");
    await sh.exited;
    const bunDied = await waitUntilDead(bunPid, 10000);
    // macOS: bun's NOTE_EXIT fires → Global.exit → libproc walk SIGKILLs the
    // grandchild. Linux: bun gets SIGKILL via PDEATHSIG, but the grandchild is
    // also Bun with the env var inherited and so has its own PDEATHSIG.
    const grandchildDied = await waitUntilDead(grandchildPid, 10000);
    reap(bunPid, grandchildPid);
    expect(bunDied).toBe(true);
    expect(grandchildDied).toBe(true);
  },
);

// The grandchild here is plain /bin/sh — it never calls prctl itself. On
// Linux this is covered by Bun setting linux_pdeathsig on every spawn when
// BUN_FEATURE_FLAG_DIE_WITH_PARENT is enabled (prctl in the vfork child before exec). On
// macOS it's covered by the libproc descendant walk in the exit handler.
test.skipIf(!isSupported)(
  "BUN_FEATURE_FLAG_DIE_WITH_PARENT=1: non-Bun grandchildren are reaped when bun dies with its parent",
  async () => {
    const { sh, bunPid, grandchildPid } = await spawnTree("1", "child-nonbun.js");
    expect(isAlive(grandchildPid)).toBe(true);
    process.kill(sh.pid!, "SIGKILL");
    await sh.exited;
    const bunDied = await waitUntilDead(bunPid, 10000);
    const grandchildDied = await waitUntilDead(grandchildPid, 10000);
    reap(bunPid, grandchildPid);
    expect(bunDied).toBe(true);
    expect(grandchildDied).toBe(true);
  },
);

test.skipIf(!isSupported)("BUN_FEATURE_FLAG_DIE_WITH_PARENT=0 is treated as unset", async () => {
  const { sh, bunPid, grandchildPid } = await spawnTree("0");
  process.kill(sh.pid!, "SIGKILL");
  await sh.exited;
  const died = await waitUntilDead(bunPid, 1000);
  reap(bunPid, grandchildPid);
  expect(died).toBe(false);
});

test.skipIf(!isSupported)("BUN_FEATURE_FLAG_DIE_WITH_PARENT=1 does not fire while the parent is alive", async () => {
  const { sh, bunPid, grandchildPid } = await spawnTree("1");
  // Parent is alive; bun must stay alive. Poll for premature death.
  const diedEarly = await waitUntilDead(bunPid, 1000);
  expect(diedEarly).toBe(false);
  process.kill(sh.pid!, "SIGKILL");
  await sh.exited;
  const died = await waitUntilDead(bunPid, 10000);
  reap(bunPid, grandchildPid);
  expect(died).toBe(true);
});

// Descendant cleanup must not depend on the parent-watch path. With the env
// var set, a Bun that exits *cleanly* should still SIGKILL its children. On
// macOS this is the only place the libproc walk is exercised independently of
// NOTE_EXIT.
test.skipIf(!isSupported)("BUN_FEATURE_FLAG_DIE_WITH_PARENT=1: clean exit reaps descendants", async () => {
  const env: Record<string, string> = { ...bunEnv, BUN_FEATURE_FLAG_DIE_WITH_PARENT: "1" };
  const proc = Bun.spawn({
    cmd: [bunExe(), `${String(fixture)}/clean-exit.js`],
    env,
    stdout: "pipe",
    stderr: "ignore",
  });
  const out = await proc.stdout.text();
  await proc.exited;
  const gcPid = Number(out.trim());
  expect(gcPid).toBeGreaterThan(0);
  const died = await waitUntilDead(gcPid, 10000);
  reap(gcPid);
  expect(proc.exitCode).toBe(0);
  expect(died).toBe(true);
});

// Same as the clean-exit test but enabled via bunfig.toml instead of the env
// var, exercising the second `enable()` call site.
test.skipIf(!isSupported)("bunfig [run] dieWithParent = true: clean exit reaps descendants", async () => {
  using dir = tempDir("die-with-parent-bunfig", {
    "bunfig.toml": "[run]\ndieWithParent = true\n",
    "grandchild.js": `process.stdout.write("r"); setInterval(()=>{}, 1000);`,
    "clean-exit.js": `
      const gc = Bun.spawn({
        cmd: [process.execPath, "grandchild.js"],
        cwd: import.meta.dir,
        stdio: ["ignore", "pipe", "ignore"],
      });
      await gc.stdout.getReader().read();
      gc.unref();
      console.log(gc.pid);
      process.exit(0);
    `,
  });
  const env: Record<string, string> = { ...bunEnv };
  delete env.BUN_FEATURE_FLAG_DIE_WITH_PARENT;
  const proc = Bun.spawn({
    cmd: [bunExe(), "clean-exit.js"],
    env,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "ignore",
  });
  const out = await proc.stdout.text();
  await proc.exited;
  const gcPid = Number(out.trim());
  expect(gcPid).toBeGreaterThan(0);
  const died = await waitUntilDead(gcPid, 10000);
  reap(gcPid);
  expect(proc.exitCode).toBe(0);
  expect(died).toBe(true);
});
