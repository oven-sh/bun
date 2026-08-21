import type { Subprocess } from "bun";
import { spawn } from "bun";
import { afterEach, expect, it } from "bun:test";
import { bunEnv, bunExe, isBroken, isLinux, isWindows, tempDir, tmpdirSync } from "harness";
import { readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

let watchee: Subprocess;

function stdoutWaiter(proc: Subprocess<"ignore", "pipe", any>) {
  const reader = proc.stdout.getReader();
  const decoder = new TextDecoder();
  let output = "";
  return {
    waitFor: async (needle: string) => {
      while (!output.includes(needle)) {
        const { value, done } = await reader.read();
        if (done) throw new Error(`stream closed, output so far: ${JSON.stringify(output)}`);
        output += decoder.decode(value, { stream: true });
      }
    },
    release: () => reader.releaseLock(),
    output: () => output,
  };
}

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

afterEach(async () => {
  // SIGKILL, not the default SIGTERM: the wedge fixtures below register a
  // SIGTERM handler and never yield, so SIGTERM can't kill them — a leaked
  // pair spins at full CPU until someone notices. Await the exit so a test
  // failure can't strand the child past the suite.
  if (watchee) {
    watchee.kill("SIGKILL");
    await watchee.exited;
    watchee = undefined;
  }
});

it.skipIf(isWindows)(
  "process.exit() in a watch kill-signal handler never returns to JS",
  async () => {
    using dir = tempDir("watch-exit-in-sigterm", {
      "exiter.js": `process.on("SIGTERM", () => {
  process.exit(0);
  require("fs").writeFileSync("should-not-write.txt", "hello");
});
process.on("SIGTERM", () => {
  require("fs").writeFileSync("second-listener-ran.txt", "hello");
});
console.log("started");
setInterval(() => {}, 1000);
`,
    });
    const cwd = String(dir);
    const path = join(cwd, "exiter.js");
    watchee = spawn({
      cwd,
      cmd: [bunExe(), "--watch", "exiter.js"],
      env: bunEnv,
      stdout: "pipe",
      stderr: "inherit",
      stdin: "ignore",
    });
    let starts = 0;
    let touched = false;
    const decoder = new TextDecoder();
    await (async () => {
      // Output written before this reader attaches waits in the kernel pipe
      // buffer, so no start can be missed. Lines are reassembled across chunk
      // boundaries before matching.
      let buffered = "";
      for await (const chunk of watchee.stdout) {
        buffered += decoder.decode(chunk);
        let newline;
        while ((newline = buffered.indexOf("\n")) !== -1) {
          const line = buffered.slice(0, newline);
          buffered = buffered.slice(newline + 1);
          if (line.includes("started") && ++starts === 2) return;
          if (starts === 1 && !touched) {
            touched = true;
            // First boot seen: touch the file to trigger the kill-signal reload.
            await Bun.write(path, (await Bun.file(path).text()) + "\n// touched");
          }
        }
      }
      // The child exiting before the reload start is a failure of the watch
      // path itself; without this the absent-file expects below pass vacuously.
      throw new Error(`watchee stdout ended after ${starts} start(s); expected 2`);
    })();
    expect(await Bun.file(join(cwd, "should-not-write.txt")).exists()).toBe(false);
    expect(await Bun.file(join(cwd, "second-listener-ran.txt")).exists()).toBe(false);
  },
  10000,
);

// Watcher::start() must propagate a failed thread spawn as an Err through its
// Result return instead of aborting inside start() with `.expect()`. An
// LD_PRELOAD shim arms on inotify_init1 (which Watcher::init() calls on Linux
// immediately before start()) and fails the very next pthread_create.
const cc = Bun.which("cc") || Bun.which("gcc") || Bun.which("clang");

/** Compiles `dir/shim.c` to a shared object and returns the value to put in LD_PRELOAD. */
async function compileShim(dir: string): Promise<string> {
  const shimPath = join(dir, "shim.so");
  await using ccProc = Bun.spawn({
    cmd: [cc!, "-shared", "-fPIC", "-o", shimPath, join(dir, "shim.c"), "-ldl", "-lpthread"],
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });
  const [ccOut, ccErr, ccExit] = await Promise.all([ccProc.stdout.text(), ccProc.stderr.text(), ccProc.exited]);
  if (ccExit !== 0) throw new Error(`shim compile failed: ${ccErr || ccOut}`);
  return bunEnv.LD_PRELOAD ? `${shimPath}:${bunEnv.LD_PRELOAD}` : shimPath;
}

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
  /* Watcher::start() retries once on EAGAIN; fail both attempts. */
  armed = 2;
  return real_inotify_init1(flags);
}

int pthread_create(pthread_t *t, const pthread_attr_t *a, void *(*f)(void *), void *arg) {
  if (!real_pthread_create) real_pthread_create = dlsym(RTLD_NEXT, "pthread_create");
  if (armed) {
    armed--;
    return EAGAIN;
  }
  return real_pthread_create(t, a, f, arg);
}
`;
  using dir = tempDir("watch-spawn-fail", {
    "shim.c": SHIM_C,
    "watchee.js": "console.log('unreachable');\n",
  });
  const LD_PRELOAD = await compileShim(String(dir));

  await using proc = Bun.spawn({
    // --debug-crash-handler-use-trace-string skips the debug build's slow
    // backtrace symbolication so the child exits promptly.
    cmd: [bunExe(), "--debug-crash-handler-use-trace-string", "--watch", "watchee.js"],
    cwd: String(dir),
    env: { ...bunEnv, LD_PRELOAD },
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

// The watcher thread reloads with execve() while the other threads are still running. While a
// thread is inside execve, the kernel fails every clone() made by the other threads of the process
// with EAGAIN. JSC starts its GC marker threads at the first collection, so a reload that lands on
// that collection makes WTF::Thread::create abort on the JS thread. reload_process has to keep such
// a thread out of the way (it parks it) so that the execve still goes through; when it reset the
// crash signals to SIG_DFL first, the abort took the whole process down instead of reloading it.
//
// The LD_PRELOAD shim stands in for the kernel so that the race is deterministic: from the moment
// bun calls execve() it fails every pthread_create in the process, tells the script to run its
// first collection, and execs for real once the crash behind that failure has been parked. bun
// parks a thread in pause(), which the shim interposes too, so that is directly observable.
//
// The JS thread is not necessarily the only thread that crashes in that window (every thread that
// creates a thread right then fails the same way), and the crash handler, with SA_RESETHAND, used to
// step aside for one of them at most. So before the shim execs it also crashes two threads of its
// own: one aborts like WTF does on Linux, one traps like WTF does on macOS (SIGILL on x64, SIGTRAP
// on aarch64). All three have to be parked for the reload to go through.
it.skipIf(!isLinux || !cc)(
  "--watch still reloads when threads abort or trap while the watcher thread is in execve",
  async () => {
    const SHIM_C = /* c */ `
#define _GNU_SOURCE
#include <dlfcn.h>
#include <errno.h>
#include <fcntl.h>
#include <pthread.h>
#include <stdlib.h>
#include <sys/resource.h>
#include <sys/syscall.h>
#include <unistd.h>

static int (*real_pthread_create)(pthread_t *, const pthread_attr_t *, void *(*)(void *), void *);
static int (*real_execve)(const char *, char *const *, char *const *);
static int (*real_pause)(void);
static volatile int in_execve;
/* The threads that crash: the one whose pthread_create fails, the aborting one, the trapping one. */
static volatile long crashing[3];
static volatile long parked[16];
static volatile int parked_count;

__attribute__((constructor)) static void init(void) {
  /* Without the fix the crashes take the default action; keep the core file out of CI's crash scan. */
  struct rlimit rl = {0, 0};
  setrlimit(RLIMIT_CORE, &rl);
  /* pause() below runs inside bun's signal handler, where dlsym is not safe. */
  real_pthread_create = dlsym(RTLD_NEXT, "pthread_create");
  real_execve = dlsym(RTLD_NEXT, "execve");
  real_pause = dlsym(RTLD_NEXT, "pause");
}

static long tid(void) { return syscall(SYS_gettid); }

static void create_marker(const char *env) {
  const char *path = getenv(env);
  int fd = path ? open(path, O_WRONLY | O_CREAT, 0644) : -1;
  if (fd >= 0) close(fd);
}

/* bun parks a thread that crashes during the reload in pause(). */
int pause(void) {
  int i = __sync_fetch_and_add(&parked_count, 1);
  if (i < 16) parked[i] = tid();
  return real_pause();
}

static int is_parked(long t) {
  int n = parked_count < 16 ? parked_count : 16;
  for (int i = 0; i < n; i++)
    if (t && parked[i] == t) return 1;
  return 0;
}

static void *abort_thread(void *unused) {
  (void)unused;
  crashing[1] = tid();
  create_marker("RELOAD_TEST_ABORTED_MARKER");
  abort();
}

static void *trap_thread(void *unused) {
  (void)unused;
  crashing[2] = tid();
  create_marker("RELOAD_TEST_TRAPPED_MARKER");
  __builtin_trap();
}

int pthread_create(pthread_t *t, const pthread_attr_t *a, void *(*f)(void *), void *arg) {
  if (!real_pthread_create) real_pthread_create = dlsym(RTLD_NEXT, "pthread_create");
  if (in_execve) {
    crashing[0] = tid();
    create_marker("RELOAD_TEST_FAILED_CREATE_MARKER");
    return EAGAIN;
  }
  return real_pthread_create(t, a, f, arg);
}

int execve(const char *path, char *const argv[], char *const envp[]) {
  pthread_t t;
  in_execve = 1;
  create_marker("RELOAD_TEST_IN_EXECVE_MARKER");
  for (int i = 0; i < 10000 && !crashing[0]; i++) usleep(1000);
  real_pthread_create(&t, 0, abort_thread, 0);
  real_pthread_create(&t, 0, trap_thread, 0);
  /* Without the fix the first crash kills the process while this waits. The deadline only matters
   * for a build that gets a crashing thread out of the way without pause(); the reload must still
   * go through then. */
  for (int i = 0; i < 10000 && !(is_parked(crashing[0]) && is_parked(crashing[1]) && is_parked(crashing[2])); i++)
    usleep(1000);
  return real_execve(path, argv, envp);
}
`;
    using dir = tempDir("watch-reload-abort-in-execve", {
      "shim.c": SHIM_C,
      "app.js": `
      const { existsSync, writeSync } = require("node:fs");
      writeSync(1, "iter first\\n");
      while (!existsSync(process.env.RELOAD_TEST_IN_EXECVE_MARKER)) Bun.sleepSync(2);
      // The first collection of this process: JSC creates its marker threads right here, on this
      // thread, and the shim fails the pthread_create.
      Bun.gc(true);
      setInterval(() => {}, 1000);
    `,
    });
    // Kept outside the watched directory so that the markers do not show up as file events.
    using markers = tempDir("watch-reload-abort-in-execve-markers", {});
    const LD_PRELOAD = await compileShim(String(dir));

    const proc = spawn({
      cmd: [bunExe(), "--watch", "app.js"],
      cwd: String(dir),
      env: {
        ...bunEnv,
        LD_PRELOAD,
        RELOAD_TEST_IN_EXECVE_MARKER: join(String(markers), "in-execve"),
        RELOAD_TEST_FAILED_CREATE_MARKER: join(String(markers), "failed-create"),
        RELOAD_TEST_ABORTED_MARKER: join(String(markers), "aborted"),
        RELOAD_TEST_TRAPPED_MARKER: join(String(markers), "trapped"),
        // Nothing may collect before the script does, or the marker threads already exist by the
        // time the reload starts and the collection below creates none.
        BUN_GARBAGE_COLLECTOR_LEVEL: "0",
        BUN_GC_TIMER_DISABLE: "1",
        // The marker count is derived from the CPU count otherwise; one marker means no threads.
        BUN_JSC_numberOfGCMarkers: "4",
      },
      stdout: "pipe",
      // Drained below: WTF reports the failed pthread_create (and a debug build its assertion) on
      // stderr before the abort, and a full pipe would block the aborting thread instead.
      stderr: "pipe",
    });
    watchee = proc;
    const stderr = proc.stderr.text();
    const { waitFor, release } = stdoutWaiter(proc);

    await waitFor("iter first");
    await Bun.write(
      join(String(dir), "app.js"),
      `require("node:fs").writeSync(1, "iter second\\n"); setInterval(() => {}, 1000);`,
    );
    // Without the fix this rejects with "stream closed": the abort on the JS thread killed the
    // process before the watcher thread reached execve.
    await waitFor("iter second");

    release();
    proc.kill("SIGKILL");
    await proc.exited;
    await stderr;

    // The reload went through the three crashes, not around them.
    expect(readdirSync(String(markers)).sort()).toEqual(["aborted", "failed-create", "in-execve", "trapped"]);
  },
  30000,
);

// The other branch of the same handler: a crash on the reloading thread itself, after the
// handler is installed, has to stay fatal. Parked, it would leave a watcher that never reloads.
it.skipIf(!isLinux || !cc)("--watch dies when the watcher thread itself aborts on its way into execve", async () => {
  using dir = tempDir("watch-reload-abort-on-reloading-thread", {
    "shim.c": /* c */ `
#include <stdlib.h>
#include <sys/resource.h>

/* The abort is the expected outcome; keep its core file out of CI's crash scan. */
__attribute__((constructor)) static void no_core(void) {
  struct rlimit rl = {0, 0};
  setrlimit(RLIMIT_CORE, &rl);
}

int execve(const char *path, char *const argv[], char *const envp[]) {
  (void)path; (void)argv; (void)envp;
  abort();
}
`,
    "app.js": `require("node:fs").writeSync(1, "iter first\\n"); setInterval(() => {}, 1000);`,
  });
  const LD_PRELOAD = await compileShim(String(dir));

  const proc = spawn({
    cmd: [bunExe(), "--watch", "app.js"],
    cwd: String(dir),
    env: { ...bunEnv, LD_PRELOAD },
    stdout: "pipe",
    stderr: "pipe",
  });
  watchee = proc;
  const stderr = proc.stderr.text();
  const { waitFor, release } = stdoutWaiter(proc);

  await waitFor("iter first");
  await Bun.write(join(String(dir), "app.js"), `console.log("unreachable");`);
  await proc.exited;
  release();

  expect(proc.signalCode, await stderr).toBe("SIGABRT");
});

// A script that registers a SIGTERM handler and then spins in synchronous
// code must still restart on file change: the watcher thread posts the reload
// to the JS thread first (so listeners can run), but forces the reload itself
// after a bounded grace window when the JS thread never drains the task.
it("--watch forces a restart when the kill-signal listener thread is stuck in sync code", async () => {
  using dir = tempDir("watch-busy-sigterm", {
    "busy.js": `
      process.on("SIGTERM", () => {});
      console.log("iter first");
      // The busy loop never yields to the event loop, so the posted
      // WatchReloadTask cannot run and the watcher-thread fallback must
      // fire. Self-limiting: it spins far past the 500ms fallback window
      // but exits on its own, so a leaked watch pair cannot burn CPU
      // forever if the test dies before killing it.
      const end = Date.now() + 30_000;
      while (Date.now() < end) {}
      process.exit(1);
    `,
  });

  watchee = spawn({
    cmd: [bunExe(), "--watch", "busy.js"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "inherit",
  });

  const { waitFor, release } = stdoutWaiter(watchee);

  await waitFor("iter first");
  await Bun.write(
    join(String(dir), "busy.js"),
    `process.on("SIGTERM", () => {});
     console.log("iter second");
     process.exit(0);`,
  );
  await waitFor("iter second");

  release();
  watchee.kill("SIGKILL");
  await watchee.exited;
}, 30000);

// Same fallback, but the wedge is *inside* the handler rather than before
// the posted task drains: the emit-flag stays true for the handler's full
// synchronous duration, and the grace thread must still force the reload
// when the handler never returns.
it("--watch forces a restart when the kill-signal handler itself never returns", async () => {
  using dir = tempDir("watch-sigterm-wedged-handler", {
    "busy.js": `
      process.on("SIGTERM", () => {
        const end = Date.now() + 30_000;
        while (Date.now() < end) {}
        process.exit(1);
      });
      console.log("iter first");
      setInterval(() => {}, 1000);
    `,
  });

  watchee = spawn({
    cmd: [bunExe(), "--watch", "busy.js"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "inherit",
  });

  const { waitFor, release } = stdoutWaiter(watchee);

  await waitFor("iter first");
  await Bun.write(
    join(String(dir), "busy.js"),
    `console.log("iter second");
     process.exit(0);`,
  );
  await waitFor("iter second");

  release();
  watchee.kill("SIGKILL");
  await watchee.exited;
}, 30000);

// With colors enabled, a reload also clears the terminal. The forced reload
// runs on the grace thread, which has its own thread-local Output state; the
// clear used to write through that thread's never-initialized writers and
// segfault instead of restarting.
it("--watch forced restart clears the terminal when colors are enabled", async () => {
  using dir = tempDir("watch-busy-sigterm-clear-screen", {
    "busy.js": `
      process.on("SIGTERM", () => {});
      console.log("iter first");
      const end = Date.now() + 30_000;
      while (Date.now() < end) {}
      process.exit(1);
    `,
  });

  const env = { ...bunEnv, FORCE_COLOR: "1" };
  delete env.NO_COLOR;
  // stderr is piped, not inherited: the clear sequence below would otherwise
  // wipe the terminal running the test suite.
  const proc = spawn({
    cmd: [bunExe(), "--watch", "busy.js"],
    cwd: String(dir),
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  watchee = proc;
  const stderr = proc.stderr.text();

  const { waitFor, release, output } = stdoutWaiter(proc);

  await waitFor("iter first");
  await Bun.write(
    join(String(dir), "busy.js"),
    `process.on("SIGTERM", () => {});
     console.log("iter second");
     process.exit(0);`,
  );
  await waitFor("iter second");

  release();
  proc.kill("SIGKILL");
  await proc.exited;

  const clearScreen = "\x1b[2J\x1b[3J\x1b[H";
  expect(output()).toContain(clearScreen);
  const [beforeReload, afterReload] = output().split(clearScreen);
  expect(beforeReload).toContain("iter first");
  expect(afterReload).toContain("iter second");
  expect(await stderr).toContain(clearScreen);
}, 30000);

// execve replaces the process without reaching on_exit(), so the compile
// cache must be flushed explicitly on the reload path; otherwise
// NODE_COMPILE_CACHE never writes anything under --watch.
it("NODE_COMPILE_CACHE persists across a --watch reload", async () => {
  using dir = tempDir("watch-compile-cache", {
    "dep.js": `module.exports = 1;`,
    "app.js": `require("./dep.js"); console.log("iter first");`,
  });
  const cacheDir = join(String(dir), ".cc");

  watchee = spawn({
    cmd: [bunExe(), "--watch", "app.js"],
    cwd: String(dir),
    env: { ...bunEnv, NODE_COMPILE_CACHE: cacheDir },
    stdout: "pipe",
    stderr: "inherit",
  });

  const { waitFor, release } = stdoutWaiter(watchee);

  await waitFor("iter first");
  await Bun.write(join(String(dir), "app.js"), `require("./dep.js"); console.log("iter second");`);
  await waitFor("iter second");

  release();
  watchee.kill("SIGKILL");
  await watchee.exited;

  // The first iteration persisted before execve; the <version-tag>/<hash>
  // files must now exist on disk.
  const entries = readdirSync(cacheDir, { recursive: true, withFileTypes: true });
  expect(entries.filter(e => e.isFile()).length).toBeGreaterThan(0);
}, 30000);

// NODE_CHANNEL_FD survives in environ across execve; the fd it names must
// survive too, so the reloaded image re-attaches to a live socket instead
// of a closed one and the parent keeps receiving 'message' events.
it.skipIf(isWindows)(
  "IPC to the parent survives a --watch reload",
  async () => {
    using dir = tempDir("watch-ipc-reload", {
      "app.js": `process.send?.("iter first"); setInterval(() => {}, 1000);`,
    });

    const messages: string[] = [];
    watchee = spawn({
      cmd: [bunExe(), "--watch", "app.js"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "inherit",
      stderr: "inherit",
      ipc(message) {
        messages.push(String(message));
      },
    });

    const deadline = Date.now() + 20000;
    while (!messages.includes("iter first") && Date.now() < deadline) await Bun.sleep(10);
    expect(messages).toContain("iter first");

    await Bun.write(join(String(dir), "app.js"), `process.send?.("iter second");`);
    while (!messages.includes("iter second") && Date.now() < deadline) await Bun.sleep(10);
    expect(messages).toContain("iter second");

    watchee.kill("SIGKILL");
    await watchee.exited;
  },
  30000,
);
