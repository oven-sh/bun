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

// https://github.com/oven-sh/bun/issues/5841
//
// Simulates a Docker bind mount / WSL /mnt/c path: inotify_add_watch reports
// success but the kernel never delivers events. Without BUN_WATCHER_USE_POLLING
// the watcher blocks on read() forever and never reloads; with it, the polling
// backend stats the file and picks up the change.
it.skipIf(!isLinux || !(Bun.which("cc") || Bun.which("gcc") || Bun.which("clang")))(
  "BUN_WATCHER_USE_POLLING reloads when inotify events never fire",
  async () => {
    const cc = Bun.which("cc") || Bun.which("gcc") || Bun.which("clang");
    const SHIM_C = /* c */ `
#define _GNU_SOURCE
static int next_wd = 1;
int inotify_add_watch(int fd, const char *path, unsigned int mask) {
  (void)fd; (void)path; (void)mask;
  return next_wd++;
}
`;
    using dir = tempDir("watch-poll", {
      "shim.c": SHIM_C,
      "watchee.js": `console.log("tick", 0);\n`,
    });
    const cwd = String(dir);
    const shimPath = join(cwd, "shim.so");
    await using ccProc = Bun.spawn({
      cmd: [cc!, "-shared", "-fPIC", "-o", shimPath, join(cwd, "shim.c")],
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });
    const [ccOut, ccErr, ccExit] = await Promise.all([ccProc.stdout.text(), ccProc.stderr.text(), ccProc.exited]);
    if (ccExit !== 0) throw new Error(`shim compile failed: ${ccErr || ccOut}`);

    const existing = bunEnv.LD_PRELOAD;
    watchee = spawn({
      cwd,
      cmd: [bunExe(), "--watch", "--no-clear-screen", "watchee.js"],
      env: {
        ...bunEnv,
        LD_PRELOAD: existing ? `${shimPath}:${existing}` : shimPath,
        BUN_WATCHER_USE_POLLING: "1",
        BUN_WATCHER_POLL_INTERVAL: "50",
      },
      stdout: "pipe",
      stderr: "inherit",
      stdin: "ignore",
    });

    const decoder = new TextDecoder();
    let buf = "";
    let i = 0;
    for await (const chunk of watchee.stdout) {
      buf += decoder.decode(chunk);
      while (buf.includes("\n")) {
        const nl = buf.indexOf("\n");
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (!line.startsWith("tick ")) continue;
        expect(line).toBe(`tick ${i}`);
        i++;
        if (i === 4) break;
        await Bun.write(join(cwd, "watchee.js"), `console.log("tick", ${i});\n`);
      }
      if (i === 4) break;
    }
    expect(i).toBe(4);
  },
  20000,
);

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
