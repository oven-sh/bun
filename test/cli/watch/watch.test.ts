import type { Subprocess } from "bun";
import { spawn } from "bun";
import { afterEach, expect, it, test } from "bun:test";
import { bunEnv, bunExe, isBroken, isLinux, isWindows, tempDir, tmpdirSync } from "harness";
import { readdirSync, rmSync } from "node:fs";
import { writeFile } from "node:fs/promises";
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

// process.exit() in a --preload script unwinds inside load_preloads' own
// promise-spin loop, which must bail like load_entry_point's does, and must
// not go on to load the remaining preloads or the entry point.
test("--watch: process.exit() in a --preload script keeps the watcher alive", async () => {
  const fixture = (n: number) =>
    `console.log("MARK:${n}");\nprocess.exit(1);\nconsole.log("AFTER_EXIT_SHOULD_NOT_PRINT");\n`;
  using dir = tempDir("watch-preload-exit", {
    "preload.ts": fixture(0),
    "preload2.ts": `console.log("AFTER_EXIT_SHOULD_NOT_PRINT");\n`,
    "index.ts": `console.log("AFTER_EXIT_SHOULD_NOT_PRINT");\n`,
  });
  const path = join(String(dir), "preload.ts");

  await using proc = spawn({
    cmd: [bunExe(), "--watch", "--no-clear-screen", "--preload=./preload.ts", "--preload=./preload2.ts", "index.ts"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  });

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

  await waitForMark(0);
  for (let n = 1; n <= 2; n++) {
    await writeFile(path, fixture(n));
    await waitForMark(n);
  }

  // Neither the statement after exit nor the entry point may run.
  expect(out).not.toContain("AFTER_EXIT_SHOULD_NOT_PRINT");
  expect(proc.exitCode).toBeNull();

  await reader.cancel();
  proc.kill();
  expect(await stderrText).toBe("");
});

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
  expect(stderr).toBe("");
  // Exited on its own with the given code instead of staying alive as a watcher.
  expect(exitCode).toBe(3);
});

// Ctrl+C must still stop the watcher: once a kill signal is delivered,
// process.exit() is a real exit, not a keepalive unwind, even when the
// handler defers the exit past the synchronous emit.
for (const [variant, handler] of [
  ["direct", `process.exit(7);`],
  ["deferred", `setTimeout(() => process.exit(7), 10);`],
] as const) {
  it.skipIf(isWindows)(`--watch: process.exit() in a SIGINT handler exits the watcher (${variant})`, async () => {
    using dir = tempDir("watch-sigint-exit", {
      "index.ts": `process.on("SIGINT", () => { ${handler} });\nconsole.log("READY");\nsetInterval(() => {}, 1000);\n`,
    });

    await using proc = spawn({
      cmd: [bunExe(), "--watch", "--no-clear-screen", "index.ts"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
      stdin: "ignore",
    });

    const stderrText = proc.stderr.text();
    const reader = proc.stdout.getReader();
    const decoder = new TextDecoder();
    let out = "";
    while (!out.includes("READY")) {
      const { done, value } = await reader.read();
      if (done) throw new Error(`watcher exited before READY. stdout so far: ${JSON.stringify(out)}`);
      out += decoder.decode(value, { stream: true });
    }

    proc.kill("SIGINT");
    // The handler's exit code is honored and the watcher is gone.
    expect(await proc.exited).toBe(7);
    await reader.cancel();
    expect(await stderrText).toBe("");
  });
}

// SIGINT while the watcher is parked after a watch exit: the handler's
// deferred continuation can never fire there, so the watcher ends with the
// completed run's exit code instead of trapping Ctrl+C forever.
it.skipIf(isWindows)("--watch: SIGINT after a watch exit ends the parked watcher", async () => {
  using dir = tempDir("watch-sigint-parked", {
    "index.ts": `process.on("SIGINT", () => { setTimeout(() => process.exit(7), 10); });\nconsole.log("READY");\nprocess.exit(3);\n`,
  });

  await using proc = spawn({
    cmd: [bunExe(), "--watch", "--no-clear-screen", "index.ts"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  });

  const stderrText = proc.stderr.text();
  const reader = proc.stdout.getReader();
  const decoder = new TextDecoder();
  let out = "";
  while (!out.includes("READY")) {
    const { done, value } = await reader.read();
    if (done) throw new Error(`watcher exited before READY. stdout so far: ${JSON.stringify(out)}`);
    out += decoder.decode(value, { stream: true });
  }

  proc.kill("SIGINT");
  expect(await proc.exited).toBe(3);
  await reader.cancel();
  expect(await stderrText).toBe("");
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
