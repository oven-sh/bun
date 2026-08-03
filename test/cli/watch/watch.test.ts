import type { Subprocess } from "bun";
import { spawn } from "bun";
import { afterEach, expect, it } from "bun:test";
import { bunEnv, bunExe, isBroken, isLinux, isWindows, tempDir, tmpdirSync } from "harness";
import { rmSync } from "node:fs";
import { join } from "node:path";

let watchee: Subprocess;

for (const dir of ["dir", "©️"]) {
  it.todoIf(isBroken && isWindows)(
    `should watch files${dir === "dir" ? "" : " (non-ascii path)"}`,
    async () => {
      const cwd = join(tmpdirSync(), dir);
      const path = join(cwd, "watchee.js");

      const updateFile = async (i: number) => {
        await Bun.write(path, `console.log(${i}, __dirname);`);
      };

      let i = 0;
      await updateFile(i);
      await Bun.sleep(1000);
      watchee = spawn({
        cwd,
        cmd: [bunExe(), "--watch", "watchee.js"],
        env: bunEnv,
        stdout: "pipe",
        stderr: "inherit",
        stdin: "ignore",
      });

      for await (const line of watchee.stdout) {
        if (i == 10) break;
        var str = new TextDecoder().decode(line);
        expect(str).toContain(`${i} ${cwd}`);
        i++;
        await updateFile(i);
      }
      rmSync(path);
    },
    10000,
  );
}

afterEach(() => {
  watchee?.kill();
});

// Watcher::start() must propagate a failed thread spawn as an Err through its
// Result return instead of aborting inside start() with `.expect()`. An
// LD_PRELOAD shim arms on inotify_init1 (which Watcher::init() calls on Linux
// immediately before start()) and fails the very next pthread_create.
const cc = Bun.which("cc") || Bun.which("gcc") || Bun.which("clang");
it.skipIf(!isLinux || !cc)("propagates FileWatcher thread spawn failure instead of panicking in start()", async () => {
  const SHIM_C = /* c */ `
#define _GNU_SOURCE
#include <dlfcn.h>
#include <errno.h>
#include <pthread.h>
#include <sys/resource.h>

static int (*real_inotify_init1)(int);
static int (*real_pthread_create)(pthread_t *, const pthread_attr_t *, void *(*)(void *), void *);
static volatile int armed = 0;

/* The child is expected to abort; suppress the core file so CI's runner does
 * not flag it as a crash. RLIMIT_CORE survives execvp. */
__attribute__((constructor)) static void no_core(void) {
  struct rlimit rl = {0, 0};
  setrlimit(RLIMIT_CORE, &rl);
}

int inotify_init1(int flags) {
  if (!real_inotify_init1) real_inotify_init1 = dlsym(RTLD_NEXT, "inotify_init1");
  armed = 1;
  return real_inotify_init1(flags);
}

int pthread_create(pthread_t *t, const pthread_attr_t *a, void *(*f)(void *), void *arg) {
  if (!real_pthread_create) real_pthread_create = dlsym(RTLD_NEXT, "pthread_create");
  if (armed) {
    armed = 0;
    return EAGAIN;
  }
  return real_pthread_create(t, a, f, arg);
}
`;
  using dir = tempDir("watch-spawn-fail", {
    "shim.c": SHIM_C,
    "watchee.js": "console.log('unreachable');\n",
  });
  const shimPath = join(String(dir), "shim.so");
  await using ccProc = Bun.spawn({
    cmd: [cc!, "-shared", "-fPIC", "-o", shimPath, join(String(dir), "shim.c"), "-ldl", "-lpthread"],
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });
  const [ccOut, ccErr, ccExit] = await Promise.all([ccProc.stdout.text(), ccProc.stderr.text(), ccProc.exited]);
  if (ccExit !== 0) throw new Error(`shim compile failed: ${ccErr || ccOut}`);

  const existing = bunEnv.LD_PRELOAD;
  await using proc = Bun.spawn({
    // --debug-crash-handler-use-trace-string skips the debug build's slow
    // backtrace symbolication so the child exits promptly.
    cmd: [bunExe(), "--debug-crash-handler-use-trace-string", "--watch", "watchee.js"],
    cwd: String(dir),
    env: { ...bunEnv, LD_PRELOAD: existing ? `${shimPath}:${existing}` : shimPath },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // The .expect("spawn FileWatcher thread") panic inside start() must be gone;
  // the error now reaches the caller, which reports it by errno name.
  expect(stderr).not.toContain("spawn FileWatcher thread");
  expect(stderr).toContain("Failed to start File Watcher: EAGAIN");
  expect(stdout).not.toContain("unreachable");
  expect(exitCode).not.toBe(0);
});

// When the watcher thread enters execve(), the kernel's de_thread makes a
// concurrent pthread_create on any other thread fail with EAGAIN, and WTF
// treats that as fatal (abort()). The shim reproduces that deterministically
// by hooking execve and, before calling the real one, spawning a few threads
// that abort(). bun's reload_process sets RELOAD_IN_PROGRESS before it reaches
// execve, so the hook runs inside the reload window; a correct build parks
// each aborting thread via pthread_exit and the exec then completes. Two
// aborts are needed because the crash handler's existing SA_RESETHAND SIGABRT
// hook absorbs a single one.
it.skipIf(!isLinux || !cc)("survives abort() from another thread during --watch reload", async () => {
  const SHIM_C = /* c */ `
#define _GNU_SOURCE
#include <dlfcn.h>
#include <pthread.h>
#include <stdlib.h>
#include <sys/resource.h>
#include <time.h>

static int (*real_execve)(const char *, char *const[], char *const[]);

__attribute__((constructor)) static void no_core(void) {
  struct rlimit rl = {0, 0};
  setrlimit(RLIMIT_CORE, &rl);
}

static void *aborter(void *unused) {
  (void)unused;
  abort();
  return 0;
}

int execve(const char *path, char *const argv[], char *const envp[]) {
  if (!real_execve) real_execve = dlsym(RTLD_NEXT, "execve");
  pthread_t t;
  pthread_create(&t, 0, aborter, 0);
  pthread_create(&t, 0, aborter, 0);
  pthread_create(&t, 0, aborter, 0);
  /* Let the aborts land before the real execve starts de_thread. */
  struct timespec ts = {0, 100 * 1000 * 1000};
  nanosleep(&ts, 0);
  return real_execve(path, argv, envp);
}
`;
  const WATCHEE = `
process.stdout.write("gen " + GEN + " up\\n");
setInterval(() => {}, 1000);
`;
  using dir = tempDir("watch-reload-abort", {
    "shim.c": SHIM_C,
    "watchee.mjs": WATCHEE.replace("GEN", "1"),
  });
  const shimPath = join(String(dir), "shim.so");
  await using ccProc = Bun.spawn({
    cmd: [cc!, "-shared", "-fPIC", "-o", shimPath, join(String(dir), "shim.c"), "-ldl", "-lpthread"],
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });
  const [ccOut, ccErr, ccExit] = await Promise.all([ccProc.stdout.text(), ccProc.stderr.text(), ccProc.exited]);
  if (ccExit !== 0) throw new Error(`shim compile failed: ${ccErr || ccOut}`);

  const existing = bunEnv.LD_PRELOAD;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "--watch", "--no-clear-screen", "watchee.mjs"],
    cwd: String(dir),
    env: { ...bunEnv, LD_PRELOAD: existing ? `${shimPath}:${existing}` : shimPath },
    stdout: "pipe",
    stderr: "pipe",
  });

  const target = 3;
  let gen = 1;
  let sawTarget = false;
  let stderrText = "";
  (async () => {
    for await (const chunk of proc.stderr) stderrText += new TextDecoder().decode(chunk);
  })();
  for await (const chunk of proc.stdout) {
    const text = new TextDecoder().decode(chunk);
    if (text.includes(`gen ${gen} up`)) {
      if (gen >= target) {
        sawTarget = true;
        proc.kill("SIGKILL");
        break;
      }
      gen++;
      await Bun.write(join(String(dir), "watchee.mjs"), WATCHEE.replace("GEN", String(gen)));
    }
  }
  await proc.exited;

  expect({ sawTarget, restartsCompleted: gen - 1, signalCode: proc.signalCode, stderr: stderrText.trim() }).toEqual({
    sawTarget: true,
    restartsCompleted: target - 1,
    signalCode: "SIGKILL",
    stderr: "",
  });
}, 30_000);
