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

// Watcher::start() spawns the watcher thread. An LD_PRELOAD shim arms on
// inotify_init1 (which Watcher::init() calls on Linux immediately before
// start()) and fails the next N pthread_create calls with EAGAIN — the error
// pthread_create returns under transient thread/memory pressure.
const cc = Bun.which("cc") || Bun.which("gcc") || Bun.which("clang");
const SHIM_C = /* c */ `
#define _GNU_SOURCE
#include <dlfcn.h>
#include <errno.h>
#include <pthread.h>
#include <stdlib.h>
#include <sys/resource.h>

static int (*real_inotify_init1)(int);
static int (*real_pthread_create)(pthread_t *, const pthread_attr_t *, void *(*)(void *), void *);
static volatile int armed = 0;

/* On the persistent-failure path the child aborts; suppress the core file so
 * CI's runner does not flag it as a crash. RLIMIT_CORE survives execvp. */
__attribute__((constructor)) static void no_core(void) {
  struct rlimit rl = {0, 0};
  setrlimit(RLIMIT_CORE, &rl);
}

int inotify_init1(int flags) {
  if (!real_inotify_init1) real_inotify_init1 = dlsym(RTLD_NEXT, "inotify_init1");
  const char *n = getenv("FAIL_PTHREAD_CREATE_N");
  armed = n ? atoi(n) : 0;
  return real_inotify_init1(flags);
}

int pthread_create(pthread_t *t, const pthread_attr_t *a, void *(*f)(void *), void *arg) {
  if (!real_pthread_create) real_pthread_create = dlsym(RTLD_NEXT, "pthread_create");
  if (armed > 0) {
    armed--;
    return EAGAIN;
  }
  return real_pthread_create(t, a, f, arg);
}
`;
async function withShim(fn: (dir: string, env: Record<string, string | undefined>) => Promise<void>) {
  using dir = tempDir("watch-spawn-fail", {
    "shim.c": SHIM_C,
    "watchee.js": "console.log('running'); process.exit(0);\n",
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
  await fn(String(dir), { ...bunEnv, LD_PRELOAD: existing ? `${shimPath}:${existing}` : shimPath });
}

it.skipIf(!isLinux || !cc)("retries FileWatcher thread spawn on transient EAGAIN", async () => {
  await withShim(async (dir, env) => {
    await using proc = Bun.spawn({
      // --debug-crash-handler-use-trace-string skips the debug build's slow
      // backtrace symbolication so a (regressed) crash surfaces its message.
      cmd: [bunExe(), "--debug-crash-handler-use-trace-string", "--watch", "watchee.js"],
      cwd: dir,
      env: { ...env, FAIL_PTHREAD_CREATE_N: "3" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // start() must retry past the injected EAGAINs so the entry module runs.
    expect({ stdout: stdout.trim(), stderr, exitCode }).toEqual({
      stdout: "running",
      stderr: expect.not.stringContaining("Failed to start File Watcher"),
      exitCode: 0,
    });
  });
});

it.skipIf(!isLinux || !cc)("propagates FileWatcher thread spawn failure instead of panicking in start()", async () => {
  await withShim(async (dir, env) => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "--debug-crash-handler-use-trace-string", "--watch", "watchee.js"],
      cwd: dir,
      env: { ...env, FAIL_PTHREAD_CREATE_N: "1000000" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // The .expect("spawn FileWatcher thread") panic inside start() must be
    // gone; the error reaches the caller, which reports it by errno name.
    expect(stderr).not.toContain("spawn FileWatcher thread");
    expect(stderr).toContain("Failed to start File Watcher: EAGAIN");
    expect(stdout).not.toContain("running");
    expect(exitCode).not.toBe(0);
  });
});
