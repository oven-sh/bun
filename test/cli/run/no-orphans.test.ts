import { dlopen, FFIType } from "bun:ffi";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, isMusl, tempDir } from "harness";
import { chmodSync, readFileSync } from "node:fs";
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
            `if(fork){ select undef,undef,undef,0.01 until -s $f; exit } ` +
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

// Same perl daemon, but run via a `node_modules/.bin` entry instead of a
// package.json script. That path is `runBinaryWithoutBunxPath`, which sets
// `use_execve_on_macos = silent` *unconditionally* — on macOS that's
// POSIX_SPAWN_SETEXEC (replaces our image; no_orphans intentionally off), but
// on Linux the spawn side ignores the flag, so the no_orphans gate must too.
// Regression for that gate reading the flag platform-agnostically and silently
// dropping subreaper here, which let the setsid daemon escape.
test.skipIf(!isLinux || !hasPerl)(
  "bun run --no-orphans (node_modules/.bin, Linux): setsid daemon is reaped despite use_execve_on_macos",
  async () => {
    const perlDaemon =
      `#!/usr/bin/env perl\n` +
      `use POSIX;\n` +
      `$f="$ENV{OUT}/pid";\n` +
      `if(fork){ select undef,undef,undef,0.01 until -s $f; exit }\n` +
      `$old=getpgrp(); setsid;\n` +
      `exit if fork;\n` +
      `open F,">",$f; print F "$$ $old ".getpgrp(); close F;\n` +
      `sleep 1 while 1;\n`;
    using dir = tempDir("no-orphans-bin", {
      "package.json": JSON.stringify({ name: "p" }),
      "node_modules/.bin/dev": perlDaemon,
    });
    chmodSync(`${dir}/node_modules/.bin/dev`, 0o755);
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
    expect(pgidAfter).not.toBe(pgidBefore);

    // Under the default 5s test timeout — short enough that reap() runs even
    // on failure, so a regressing build doesn't leak the daemon into CI.
    const died = await waitUntilDead(daemonPid, 3000);
    reap(daemonPid);
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

// Ctrl-Z bridge: with the script in its own pgroup `bun run` is a one-job
// shell on a controlling TTY. Send SIGTSTP to the script's pgroup; bun run's
// WUNTRACED wait must observe the stop, take the terminal, and `raise(SIGTSTP)`
// itself (state 'T'). After SIGCONT, bun must SIGCONT the script. Without the
// dance bun would spin forever in poll() while the script is stopped and the
// user's shell never sees a stopped job.
//
// Linux-only — needs /proc/<pid>/stat for state polling and login-TTY
// acquisition via O_NOCTTY-less open. The macOS path (EVFILT_SIGNAL+SIGCHLD →
// wait4 WUNTRACED → same `JobControl.onChildStopped`) is structurally
// identical and is type-checked by `zig build check-macos`.
test.skipIf(!isLinux)("bun run --no-orphans on TTY: Ctrl-Z stop bridges to bun, fg resumes script", async () => {
  // openpty + ptsname so a setsid wrapper can reopen the slave as its
  // controlling terminal — Bun.spawn can't acquire a ctty for us.
  const decls = {
    openpty: { args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
    ptsname: { args: [FFIType.i32], returns: FFIType.cstring },
    close: { args: [FFIType.i32], returns: FFIType.i32 },
  } as const;
  const lib = isMusl
    ? dlopen(process.arch === "arm64" ? "libc.musl-aarch64.so.1" : "libc.musl-x86_64.so.1", decls)
    : {
        symbols: {
          ...dlopen("libutil.so.1", { openpty: decls.openpty }).symbols,
          ...dlopen("libc.so.6", { ptsname: decls.ptsname, close: decls.close }).symbols,
        },
      };

  const m = new Int32Array(1);
  const s = new Int32Array(1);
  expect(lib.symbols.openpty(m, s, null, null, null)).toBe(0);
  const master = m[0];
  const slave = s[0];
  const slavePath = String(lib.symbols.ptsname(master));
  expect(slavePath).toMatch(/^\/dev\/pts\//);

  using dir = tempDir("no-orphans-tty", {
    "package.json": JSON.stringify({
      name: "p",
      // bun run wraps this in `sh -c '<script>'`, so $$ = the sh that
      // spawnSync/new_process_group put in its own pgroup, $PPID = bun run.
      scripts: { go: `echo "S $$ $PPID" >"$OUT/ids"; while :; do sleep 1; done` },
    }),
    // setsid → reopen the slave as 0/1/2 (acquires it as ctty on Linux when
    // the session has none) → exec bun run. bun run is now session leader,
    // foreground pgroup of the PTY, with isatty(0)=true and tcgetpgrp(0) > 0.
    "wrap.sh": `#!/bin/sh\n` + `exec setsid sh -c 'exec <"$1" >"$1" 2>"$1"; shift; exec "$@"' -- "$@"\n`,
  });
  chmodSync(`${dir}/wrap.sh`, 0o755);
  const env: Record<string, string> = { ...bunEnv, OUT: String(dir) };
  delete env.BUN_FEATURE_FLAG_NO_ORPHANS;

  await using proc = Bun.spawn({
    cmd: [`${dir}/wrap.sh`, slavePath, bunExe(), "run", "--no-orphans", "--silent", "go"],
    env,
    cwd: String(dir),
    stdio: ["ignore", "ignore", "ignore"],
  });
  // The `setsid` re-exec drops `proc.pid` immediately; resolve the real
  // `bun run` pid as the script's PPID once the script writes its ids.
  lib.symbols.close(slave);

  const procState = (pid: number) => {
    try {
      // /proc/<pid>/stat field 3 is the state char; field 2 (comm) can
      // contain spaces/parens, so anchor on the closing ')'.
      const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
      return stat.slice(stat.lastIndexOf(")") + 2, stat.lastIndexOf(")") + 3);
    } catch {
      return "X";
    }
  };
  const waitState = async (pid: number, want: (s: string) => boolean, ms: number) => {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      if (want(procState(pid))) return true;
      await sleep(10);
    }
    return want(procState(pid));
  };

  // Wait for the script to write its ids (proves bun run + spawn finished).
  let scriptPid = 0,
    runPid = 0;
  {
    const deadline = Date.now() + 4000;
    while (Date.now() < deadline) {
      try {
        const t = readFileSync(`${dir}/ids`, "utf8").match(/S (\d+) (\d+)/);
        if (t) {
          scriptPid = Number(t[1]);
          runPid = Number(t[2]);
          break;
        }
      } catch {}
      await sleep(10);
    }
  }
  try {
    expect(scriptPid).toBeGreaterThan(0);
    expect(runPid).toBeGreaterThan(0);
    // Preconditions: script is in its own pgroup (`\) . ppid pgrp `), and is
    // the PTY's foreground pgroup (bun's stat field 8 = tpgid = scriptPid),
    // proving `JobControl.give()` ran with `isatty(0) && tcgetpgrp(0)>0`.
    expect(readFileSync(`/proc/${scriptPid}/stat`, "utf8")).toMatch(new RegExp(`\\) . ${runPid} ${scriptPid} `));
    expect(readFileSync(`/proc/${runPid}/stat`, "utf8")).toMatch(
      new RegExp(`\\) . \\d+ ${runPid} ${runPid} \\d+ ${scriptPid} `),
    );

    // Ctrl-Z: SIGTSTP to the script's pgroup (what the line discipline would
    // send to the foreground pgroup on ^Z). bun's WUNTRACED wait observes the
    // stop and runs the dance: take terminal → raise(SIGTSTP) → SIGCONT
    // script. Here bun's *own* pgroup is orphaned (its parent — this test
    // process — is in a different session), so the kernel discards bun's
    // self-SIGTSTP and the dance falls straight through to SIGCONT'ing the
    // script. Net effect: script is running again. In a real interactive
    // shell bun's pgroup is *not* orphaned and bun stops at raise(); the
    // shell's `fg` then SIGCONTs bun which SIGCONTs the script — same code
    // path, just with the kernel's orphan rule short-circuiting the middle.
    //
    // Without WUNTRACED (the regression): the script stays 'T' forever and
    // bun spins in poll() — `resumed` is false and the test fails.
    for (let i = 0; i < 2; i++) {
      process.kill(-scriptPid, "SIGTSTP");
      // Don't assert it reached 'T' — the dance is fast enough that we may
      // only ever observe 'S'. The post-condition is what matters.
      await waitState(scriptPid, st => st === "T" || st === "t", 200);
      const resumed = await waitState(scriptPid, st => st === "S" || st === "R", 3000);
      expect({
        round: i,
        resumed,
        scriptState: procState(scriptPid),
        runState: procState(runPid),
      }).toEqual({
        round: i,
        resumed: true,
        scriptState: expect.stringMatching(/[SR]/),
        runState: "S",
      });
    }

    // Foreground pgroup is back on the script after each dance round.
    expect(readFileSync(`/proc/${runPid}/stat`, "utf8")).toMatch(
      new RegExp(`\\) . \\d+ ${runPid} ${runPid} \\d+ ${scriptPid} `),
    );
  } finally {
    if (runPid > 0) reap(runPid);
    if (scriptPid > 0) reap(-scriptPid, scriptPid);
    lib.symbols.close(master);
  }
});
