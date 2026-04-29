import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { setTimeout as sleep } from "node:timers/promises";

// --no-orphans / BUN_FEATURE_FLAG_NO_ORPHANS / [run] noOrphans: Bun watches its
// original ppid and exits when that process dies, even if the parent was
// SIGKILLed and couldn't signal us. On the way out it also recursively SIGKILLs
// every descendant so nothing it spawned outlives it. Linux uses
// prctl(PR_SET_PDEATHSIG); macOS registers EVFILT_PROC/NOTE_EXIT on the
// existing event loop's kqueue (no thread).
//
// Tree under test: test → sh (the "parent" we SIGKILL) → bun-debug → grandchild.
// We SIGKILL sh and observe bun-debug and the grandchild.

const isSupported = process.platform === "linux" || process.platform === "darwin";

// Shared fixture dir — child.js spawns grandchild.js, prints
// "<self> <ppid> <grandchild>", then idles. Kept on disk so we can pass it
// through /bin/sh without fighting shell quoting of an inline -e payload.
const fixture = tempDir("no-orphans", {
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
});

async function spawnTree(noOrphans: string | undefined, childScript = "child.js") {
  const env: Record<string, string> = { ...bunEnv };
  // bunEnv spreads process.env; make sure an ambient BUN_FEATURE_FLAG_NO_ORPHANS
  // from the test runner doesn't leak into the "unset" case.
  delete env.BUN_FEATURE_FLAG_NO_ORPHANS;
  if (noOrphans !== undefined) env.BUN_FEATURE_FLAG_NO_ORPHANS = noOrphans;

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
  "without BUN_FEATURE_FLAG_NO_ORPHANS, bun is orphaned when its parent is SIGKILLed",
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

test.skipIf(!isSupported)("BUN_FEATURE_FLAG_NO_ORPHANS=1: bun exits when its parent is SIGKILLed", async () => {
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
  "BUN_FEATURE_FLAG_NO_ORPHANS=1: grandchildren are reaped when bun dies with its parent",
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
// no-orphans mode is enabled (prctl in the vfork child before exec). On macOS
// it's covered by the libproc descendant walk in the exit handler.
test.skipIf(!isSupported)(
  "BUN_FEATURE_FLAG_NO_ORPHANS=1: non-Bun grandchildren are reaped when bun dies with its parent",
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

test.skipIf(!isSupported)("BUN_FEATURE_FLAG_NO_ORPHANS=0 is treated as unset", async () => {
  const { sh, bunPid, grandchildPid } = await spawnTree("0");
  process.kill(sh.pid!, "SIGKILL");
  await sh.exited;
  const died = await waitUntilDead(bunPid, 1000);
  reap(bunPid, grandchildPid);
  expect(died).toBe(false);
});

test.skipIf(!isSupported)("BUN_FEATURE_FLAG_NO_ORPHANS=1 does not fire while the parent is alive", async () => {
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

// Descendant cleanup must not depend on the parent-watch path. A Bun that
// exits *cleanly* should SIGKILL its children. Same fixture, three enable()
// call sites — env var, --no-orphans flag, bunfig.
describe.each([
  { via: "BUN_FEATURE_FLAG_NO_ORPHANS=1", argv: [], bunfig: false, env: { BUN_FEATURE_FLAG_NO_ORPHANS: "1" } },
  { via: "--no-orphans", argv: ["--no-orphans"], bunfig: false, env: {} },
  { via: "bunfig [run] noOrphans = true", argv: [], bunfig: true, env: {} },
])("clean exit reaps descendants", ({ via, argv, bunfig, env: extraEnv }) => {
  test.skipIf(!isSupported)(via, async () => {
    using dir = tempDir("no-orphans-clean-exit", {
      ...(bunfig && { "bunfig.toml": "[run]\nnoOrphans = true\n" }),
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
    const env: Record<string, string> = { ...bunEnv, ...extraEnv };
    if (!("BUN_FEATURE_FLAG_NO_ORPHANS" in extraEnv)) delete env.BUN_FEATURE_FLAG_NO_ORPHANS;
    const proc = Bun.spawn({
      cmd: [bunExe(), ...argv, "clean-exit.js"],
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
    expect(died).toBe(true);
    expect(proc.exitCode).toBe(0);
  });
});

// `bun run --no-orphans` while the supervisor is SIGKILLed.
// Tree: test → sh (supervisor) → `bun run` → /bin/sh (script). The script is
// non-Bun so it never installs its own watchdog — survival of the script after
// the supervisor dies would prove `bun run` slept through it.
//
// Two macOS code paths under test:
//   - plain `bun run <script>` → spawnSync → `waitForChildNoOrphans`
//   - `--filter='*'` → MiniEventLoop → `installOnEventLoop`
// Linux: both covered by PDEATHSIG on `bun run` + linux_pdeathsig on the spawn.
//
// `exec` collapses the script's wrapper sh into the script pid, so $PPID is
// `bun run`. Do NOT `cd ... &&` inside sh -c — that adds a subshell between sh
// and `bun run`, so `bun run`'s ppid would survive the SIGKILL.
const goScript = `exec /bin/sh -c 'echo "$$ $PPID"; while :; do sleep 1; done'`;
describe.each([
  {
    label: "<script>",
    runArgs: "--silent go",
    files: { "package.json": JSON.stringify({ name: "p", scripts: { go: goScript } }) },
  },
  {
    label: "--filter='*'",
    runArgs: "--filter='*' --elide-lines=0 go",
    files: {
      "package.json": JSON.stringify({ name: "p", workspaces: ["pkg"] }),
      "pkg/package.json": JSON.stringify({ name: "pkg", scripts: { go: goScript } }),
    },
  },
])("bun run --no-orphans $label: supervisor SIGKILLed", ({ runArgs, files }) => {
  test.skipIf(!isSupported)("bun run and the script exit", async () => {
    using dir = tempDir("no-orphans-run", files);
    const env: Record<string, string> = { ...bunEnv };
    delete env.BUN_FEATURE_FLAG_NO_ORPHANS;
    const sh = Bun.spawn({
      cmd: ["/bin/sh", "-c", `"${bunExe()}" run --no-orphans ${runArgs} & wait`],
      env,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "ignore",
    });

    // --filter prefixes each line with a package label, plain run doesn't —
    // just scan for the first "<pid> <pid>" pair anywhere in the stream.
    const reader = sh.stdout.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let scriptPid = 0;
    let runPid = 0;
    while (scriptPid === 0) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const m = buf.match(/(\d+) (\d+)/);
      if (m) {
        scriptPid = Number(m[1]);
        runPid = Number(m[2]);
      }
    }
    reader.releaseLock();
    expect(scriptPid).toBeGreaterThan(0);
    expect(runPid).toBeGreaterThan(0);
    expect(isAlive(runPid)).toBe(true);
    expect(isAlive(scriptPid)).toBe(true);

    process.kill(sh.pid!, "SIGKILL");
    await sh.exited;

    const runDied = await waitUntilDead(runPid, 10000);
    const scriptDied = await waitUntilDead(scriptPid, 10000);
    reap(runPid, scriptPid);
    expect(runDied).toBe(true);
    expect(scriptDied).toBe(true);
  });
});

// The package.json script *itself* is a perl one-liner that setsid +
// double-forks — no Bun anywhere in the chain after `bun run`. The daemon
// writes "<pid> <ppid> <pgid>" to a file; the outer perl blocks until that
// file exists so `bun run` can't reap before the test has the daemon's pid.
// We then assert (a) the daemon really escaped (pgid != bun run's child pgid)
// and (b) it died anyway when `bun run` exited.
//
// Linux: PR_SET_CHILD_SUBREAPER claims the orphan, procfs walk finds it.
// macOS: NoOrphansTracker's p_puniqueid spawn-graph finds it.
const hasPerl = Bun.which("perl") != null;
test.skipIf(!isSupported || !hasPerl)(
  "bun run --no-orphans: perl setsid+double-fork daemon (no Bun in chain) is reaped",
  async () => {
    using dir = tempDir("no-orphans-perl", {
      "package.json": JSON.stringify({
        name: "p",
        scripts: {
          dev:
            `perl -MPOSIX -e '` +
            `$f="$ENV{OUT}/pid"; ` +
            // outer: spin until daemon recorded its pid, then exit — this is
            // bun run's direct child, so bun run can't finish (and reap the
            // daemon) before the test can read the pid.
            // record getpgrp() before/after setsid so the test can prove the
            // daemon actually left the script's pgroup.
            `if(fork){ select undef,undef,undef,0.01 until -e $f; exit } ` +
            `$old=getpgrp(); setsid; ` + // new session+pgroup
            `exit if fork; ` + // session leader exits → daemon fully detached
            `open F,">",$f; print F "$$ $old ".getpgrp(); close F; ` +
            `sleep 1 while 1'`,
        },
      }),
    });
    const env: Record<string, string> = { ...bunEnv, OUT: String(dir) };
    delete env.BUN_FEATURE_FLAG_NO_ORPHANS;

    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", "--no-orphans", "--silent", "dev"],
      env,
      cwd: String(dir),
      stdout: "ignore",
      stderr: "pipe",
    });
    await proc.exited;
    const stderr = await proc.stderr.text();

    const txt = await Bun.file(`${dir}/pid`).text();
    const [daemonPid, pgidBefore, pgidAfter] = txt.trim().split(" ").map(Number);
    expect(daemonPid).toBeGreaterThan(0);
    // Prove setsid actually moved the daemon out of the script's pgroup —
    // before/after captured around the setsid call itself, so this can't be
    // vacuously true.
    expect(pgidAfter).not.toBe(pgidBefore);
    expect(pgidAfter).toBeGreaterThan(0);

    const died = await waitUntilDead(daemonPid, 10000);
    reap(daemonPid);
    // ASAN/debug warnings can land on stderr even on success; only surface
    // stderr as a diagnostic when the test is already failing.
    if (proc.exitCode !== 0) console.error(stderr);
    expect(died).toBe(true);
    expect(proc.exitCode).toBe(0);
  },
);

// `bun run --no-orphans <script>`: the package.json script spawns a non-Bun
// grandchild, prints its pid, and exits. The outer `bun run` process must reap
// the grandchild on its own clean exit. Uses a non-Bun grandchild so the test
// doesn't depend on env-var inheritance — proves the descendant walk runs from
// the `bun run` process itself.
test.skipIf(!isSupported)("bun run --no-orphans <script>: clean exit reaps descendants", async () => {
  using dir = tempDir("no-orphans-run", {
    "package.json": JSON.stringify({
      name: "no-orphans-run",
      scripts: { go: `${bunExe()} script.js` },
    }),
    "script.js": `
      const gc = Bun.spawn({
        cmd: ["/bin/sh", "-c", "echo r; while :; do sleep 1; done"],
        stdio: ["ignore", "pipe", "ignore"],
      });
      await gc.stdout.getReader().read();
      gc.unref();
      console.log(gc.pid);
      process.exit(0);
    `,
  });
  const env: Record<string, string> = { ...bunEnv };
  delete env.BUN_FEATURE_FLAG_NO_ORPHANS;
  const proc = Bun.spawn({
    cmd: [bunExe(), "run", "--no-orphans", "--silent", "go"],
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
  expect(died).toBe(true);
  expect(proc.exitCode).toBe(0);
});
