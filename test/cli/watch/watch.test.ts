import type { Subprocess } from "bun";
import { spawn } from "bun";
import { afterEach, expect, it, test } from "bun:test";
import { bunEnv, bunExe, isBroken, isLinux, isWindows, tempDir, tmpdirSync } from "harness";
import { rmSync } from "node:fs";
import { writeFile } from "node:fs/promises";
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

// process.exit() used to tear down the whole process in --watch mode, killing
// the watcher itself. It should instead end the current run (like a thrown
// error does) and keep the watcher waiting for the next change.
// https://github.com/oven-sh/bun/issues/32648
const exitScenarios = {
  // process.exit() during top-level evaluation.
  direct: (n: number) => `console.log("MARK:${n}");\nprocess.exit(1);\nconsole.log("AFTER_EXIT_SHOULD_NOT_PRINT");\n`,
  // Callbacks queued before process.exit() must not resume while the watcher
  // waits for the next change.
  "pending callbacks": (n: number) =>
    `console.log("MARK:${n}");\nprocess.nextTick(() => console.log("AFTER_EXIT_SHOULD_NOT_PRINT"));\nsetImmediate(() => console.log("AFTER_EXIT_SHOULD_NOT_PRINT"));\nsetTimeout(() => console.log("AFTER_EXIT_SHOULD_NOT_PRINT"), 0);\nprocess.exit(1);\n`,
  // process.exit() from a beforeExit handler: the run ends normally, then the
  // handler calls process.exit() while the watcher loop is dispatching
  // beforeExit.
  "beforeExit handler": (n: number) =>
    `console.log("MARK:${n}");\nprocess.on("beforeExit", () => { process.exit(1); console.log("AFTER_EXIT_SHOULD_NOT_PRINT"); });\n`,
  // A beforeExit handler that defers process.exit() to a timer: the exit fires
  // inside on_before_exit's own drain loop, which must not re-dispatch
  // beforeExit or run more JS.
  "deferred exit in beforeExit": (n: number) =>
    `console.log("MARK:${n}");\nprocess.on("beforeExit", () => setTimeout(() => { process.exit(1); console.log("AFTER_EXIT_SHOULD_NOT_PRINT"); }, 0));\n`,
  // process.exit() inside a node:vm script: node:vm converts terminations to
  // SIGINT/timeout errors (and aborts on any other source), so the watch-exit
  // termination must propagate through it instead.
  "node:vm script": (n: number) =>
    `console.log("MARK:${n}");\nrequire("node:vm").runInThisContext("process.exit(1)");\nconsole.log("AFTER_EXIT_SHOULD_NOT_PRINT");\n`,
  // process.exit() inside an uncaughtExceptionCaptureCallback: the termination
  // unwinding the callback must not be logged as if the callback threw.
  "capture callback": (n: number) =>
    `console.log("MARK:${n}");\nprocess.setUncaughtExceptionCaptureCallback(() => { process.exit(1); console.log("AFTER_EXIT_SHOULD_NOT_PRINT"); });\nthrow new Error("handled by capture callback");\n`,
} as const;

for (const [scenario, fixture] of Object.entries(exitScenarios)) {
  test(`--watch: process.exit() (${scenario}) keeps the watcher alive`, async () => {
    using dir = tempDir("watch-process-exit", { "index.ts": fixture(0) });
    const path = join(String(dir), "index.ts");

    await using proc = spawn({
      cmd: [bunExe(), "--watch", "--no-clear-screen", "index.ts"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
      stdin: "ignore",
    });

    // Drain stderr so a full pipe never blocks the child.
    const stderrText = proc.stderr.text();

    const decoder = new TextDecoder();
    const reader = proc.stdout.getReader();
    let out = "";
    const waitForMark = async (n: number) => {
      const marker = `MARK:${n}`;
      while (!out.includes(marker)) {
        const { done, value } = await reader.read();
        if (done) {
          throw new Error(
            `watcher exited before reload ${n} (process.exit() killed it). stdout so far: ${JSON.stringify(out)}`,
          );
        }
        out += decoder.decode(value, { stream: true });
      }
    };

    // First run executes and calls process.exit().
    await waitForMark(0);

    // Each edit must reload, proving the watcher survived the previous
    // process.exit().
    for (let n = 1; n <= 2; n++) {
      await writeFile(path, fixture(n));
      await waitForMark(n);
    }

    // process.exit() stops execution: the statement after it never runs.
    expect(out).not.toContain("AFTER_EXIT_SHOULD_NOT_PRINT");
    // The watcher is still running (we reloaded twice after process.exit()).
    expect(proc.exitCode).toBeNull();

    await reader.cancel();
    proc.kill();
    // Every scenario's error is consumed before it becomes unhandled, so
    // nothing (like a rendering of the internal termination exception) may
    // reach stderr.
    expect(await stderrText).toBe("");
  });
}

// The keepalive is scoped to --watch (it re-execs on change). --hot
// re-evaluates in place, so process.exit() there still exits the process.
test("--hot: process.exit() exits the process (no keepalive)", async () => {
  using dir = tempDir("hot-process-exit", {
    "index.ts": `console.log("HOT_RAN");\nprocess.exit(3);\nconsole.log("AFTER_EXIT_SHOULD_NOT_PRINT");\n`,
  });

  await using proc = spawn({
    cmd: [bunExe(), "--hot", "--no-clear-screen", "index.ts"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toContain("HOT_RAN");
  expect(stdout).not.toContain("AFTER_EXIT_SHOULD_NOT_PRINT");
  // Exited on its own with the given code instead of staying alive as a watcher.
  if (exitCode !== 3) console.error(stderr);
  expect(exitCode).toBe(3);
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
