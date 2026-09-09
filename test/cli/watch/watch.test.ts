import type { Subprocess } from "bun";
import { spawn } from "bun";
import { afterAll, describe, expect, it } from "bun:test";
import { bunEnv, bunExe, isBroken, isLinux, isWindows, tempDir } from "harness";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

// Every child this file starts. A concurrent test that times out never reaches
// its `await using` disposal, and the runner's dangling-process killer does
// not run for concurrent tests, so afterAll reaps whatever is still alive.
const children = new Set<Subprocess>();
function track<T extends Subprocess>(child: T): T {
  children.add(child);
  return child;
}
// SIGKILL, not SIGTERM: the wedge fixtures below install a SIGTERM handler and
// never yield, so SIGTERM cannot stop them and a leaked pair spins at full CPU.
async function reap(child: Subprocess) {
  child.kill("SIGKILL");
  await child.exited;
  children.delete(child);
}
afterAll(() => Promise.all([...children].map(reap)));

/** `bun --watch ...args` with stdout piped. Disposal SIGKILLs the child. */
function watchChild<Stderr extends "inherit" | "pipe" = "inherit">(
  args: string[],
  options: { cwd: string; env?: NodeJS.Dict<string>; stderr?: Stderr; ipc?: (message: unknown) => void },
) {
  const proc = track(
    spawn({
      cmd: [bunExe(), "--watch", ...args],
      cwd: options.cwd,
      env: options.env ?? bunEnv,
      stdin: "ignore",
      stdout: "pipe",
      stderr: options.stderr ?? "inherit",
      ...(options.ipc ? { ipc: options.ipc } : {}),
    }) as Subprocess<"ignore", "pipe", Stderr>,
  );
  const reader = proc.stdout.getReader();
  const decoder = new TextDecoder();
  let output = "";
  return {
    proc,
    /** Everything read from stdout so far. */
    get output() {
      return output;
    },
    /**
     * Reads stdout until `needle` has appeared `occurrences` times in total.
     * Output the child wrote before this is called waits in the pipe, so
     * nothing is missed. stdout survives the reload exec, so end of stream
     * means the child died instead of reloading.
     */
    async waitFor(needle: string, occurrences = 1) {
      while (output.split(needle).length - 1 < occurrences) {
        const { value, done } = await reader.read();
        if (done) {
          throw new Error(
            `watchee stdout ended before ${JSON.stringify(needle)} x${occurrences}: ${JSON.stringify(output)}`,
          );
        }
        output += decoder.decode(value, { stream: true });
      }
    },
    [Symbol.asyncDispose]: () => reap(proc),
  };
}

describe.concurrent("bun --watch", () => {
  for (const dir of ["dir", "©️"]) {
    it.todoIf(isBroken && isWindows)(
      `should watch files${dir === "dir" ? "" : " (non-ascii path)"}`,
      async () => {
        using root = tempDir("watch-files", { [dir]: { "watchee.js": `console.log(0, __dirname);` } });
        const cwd = join(String(root), dir);
        await using child = watchChild(["watchee.js"], { cwd });

        // One line per process image: the first boot, then one reload per edit.
        let expected = "";
        for (let i = 0; ; i++) {
          expected += `${i} ${cwd}\n`;
          await child.waitFor("\n", i + 1);
          expect(child.output).toBe(expected);
          if (i === 10) break;
          await Bun.write(join(cwd, "watchee.js"), `console.log(${i + 1}, __dirname);`);
        }
      },
      30_000,
    );
  }

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
      await using child = watchChild(["exiter.js"], { cwd });

      await child.waitFor("started\n");
      // Touch the file to trigger the kill-signal reload.
      await Bun.write(path, (await Bun.file(path).text()) + "\n// touched");
      // The second boot line proves the reload happened. Without it the
      // absent-file expects below would pass vacuously.
      await child.waitFor("started\n", 2);

      expect(child.output).toBe("started\nstarted\n");
      expect(existsSync(join(cwd, "should-not-write.txt"))).toBe(false);
      expect(existsSync(join(cwd, "second-listener-ran.txt"))).toBe(false);
    },
    30_000,
  );

  // While one thread is inside execve(2), Linux fails every clone(CLONE_FS) in
  // the process with EAGAIN until the exec has killed the other threads
  // (fs/exec.c check_unsafe_exec, kernel/fork.c copy_fs). The --watch reload
  // runs execve on the watcher thread, so a GC marker or worker thread that the
  // JS thread spawned at that moment failed, and WTF::Thread::create aborted the
  // process. The fixture keeps the JS thread inside pthread_create for the whole
  // run and records the first failure in a file that outlives each exec'd image.
  it.skipIf(!isLinux)(
    "a --watch reload does not fail pthread_create on the other threads",
    async () => {
      using dir = tempDir("watch-reload-pthread-create", {
        "spinner.js": `import { spawnThreadsForTesting } from "bun:internal-for-testing";
import { openSync } from "node:fs";
const fd = openSync("failures.txt", "a");
console.log("started");
for (;;) spawnThreadsForTesting(1000, fd, 2);
`,
      });
      const cwd = String(dir);
      const path = join(cwd, "spinner.js");

      // An unfixed ASAN build hits the window in roughly 1 of 5 reloads.
      const reloads = 8;
      {
        await using child = watchChild(["--no-clear-screen", "spinner.js"], { cwd });
        await child.waitFor("started\n");
        for (let i = 1; i <= reloads; i++) {
          await Bun.write(path, (await Bun.file(path).text()) + `// touch ${i}\n`);
          await child.waitFor("started\n", i + 1);
        }
        expect(child.output).toBe("started\n".repeat(reloads + 1));
      }

      expect(await Bun.file(join(cwd, "failures.txt")).text()).toBe("");
    },
    30_000,
  );

  // Watcher::start() must propagate a failed thread spawn as an Err through its
  // Result return instead of aborting inside start() with `.expect()`. An
  // LD_PRELOAD shim arms on inotify_init1 (which Watcher::init() calls on Linux
  // immediately before start()) and fails the very next pthread_create.
  const cc = Bun.which("cc") || Bun.which("gcc") || Bun.which("clang");
  it.skipIf(!isLinux || !cc)(
    "propagates FileWatcher thread spawn failure instead of panicking in start()",
    async () => {
      const SHIM_C = /* c */ `
#define _GNU_SOURCE
#include <dlfcn.h>
#include <errno.h>
#include <pthread.h>
#include <sys/resource.h>

static int (*real_inotify_init1)(int);
static int (*real_pthread_create)(pthread_t *, const pthread_attr_t *, void *(*)(void *), void *);
static volatile int armed = 0;

/* If start() regresses to aborting, suppress the core file so CI's runner does
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
      await using proc = track(
        Bun.spawn({
          // --debug-crash-handler-use-trace-string skips the debug build's slow
          // backtrace symbolication so the child exits promptly.
          cmd: [bunExe(), "--debug-crash-handler-use-trace-string", "--watch", "watchee.js"],
          cwd: String(dir),
          env: { ...bunEnv, LD_PRELOAD: existing ? `${shimPath}:${existing}` : shimPath },
          stdin: "ignore",
          stdout: "pipe",
          stderr: "pipe",
        }),
      );
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      // The error reaches enable_hot_module_reloading(), which names the errno
      // and exits 1 before the entry point loads.
      expect(stderr).toContain("Failed to start File Watcher: EAGAIN");
      expect(stdout).toBe("");
      expect(exitCode).toBe(1);
    },
    30_000,
  );

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
    await using child = watchChild(["busy.js"], { cwd: String(dir) });

    await child.waitFor("iter first\n");
    await Bun.write(
      join(String(dir), "busy.js"),
      `process.on("SIGTERM", () => {});
     console.log("iter second");
     process.exit(0);`,
    );
    await child.waitFor("iter second\n");

    expect(child.output).toBe("iter first\niter second\n");
  }, 30_000);

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
    await using child = watchChild(["busy.js"], { cwd: String(dir) });

    await child.waitFor("iter first\n");
    await Bun.write(
      join(String(dir), "busy.js"),
      `console.log("iter second");
     process.exit(0);`,
    );
    await child.waitFor("iter second\n");

    expect(child.output).toBe("iter first\niter second\n");
  }, 30_000);

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
    const env: NodeJS.Dict<string> = { ...bunEnv, FORCE_COLOR: "1" };
    delete env.NO_COLOR;

    let stdout: string;
    let stderr: Promise<string>;
    {
      // stderr is piped, not inherited: the clear sequence would otherwise
      // wipe the terminal running the test suite.
      await using child = watchChild(["busy.js"], { cwd: String(dir), env, stderr: "pipe" });
      stderr = child.proc.stderr.text();

      await child.waitFor("iter first\n");
      await Bun.write(
        join(String(dir), "busy.js"),
        `process.on("SIGTERM", () => {});
     console.log("iter second");
     process.exit(0);`,
      );
      await child.waitFor("iter second\n");
      stdout = child.output;
    }

    // The old image writes the clear sequence to both streams right before
    // execve; the new image then prints its line.
    const clearScreen = "\x1b[2J\x1b[3J\x1b[H";
    expect(stdout).toBe(`iter first\n${clearScreen}iter second\n`);
    expect(await stderr).toBe(clearScreen);
  }, 30_000);

  // execve replaces the process without reaching on_exit(), so the compile
  // cache must be flushed explicitly on the reload path; otherwise
  // NODE_COMPILE_CACHE never writes anything under --watch.
  it("NODE_COMPILE_CACHE persists across a --watch reload", async () => {
    using dir = tempDir("watch-compile-cache", {
      "dep.js": `module.exports = 1;`,
      "app.js": `require("./dep.js"); console.log("iter first");`,
    });
    const cacheDir = join(String(dir), ".cc");
    // Layout: <cacheDir>/<version tag>/<one entry per module, 16 hex digits>.
    const entries = () =>
      readdirSync(cacheDir, { recursive: true, withFileTypes: true })
        .map(e => (e.isDirectory() ? "tag dir" : e.isFile() && /^[0-9a-f]{16}$/.test(e.name) ? "entry" : e.name))
        .sort();

    {
      await using child = watchChild(["app.js"], {
        cwd: String(dir),
        env: { ...bunEnv, NODE_COMPILE_CACHE: cacheDir },
      });

      await child.waitFor("iter first\n");
      // Startup creates the version-tag directory; entries are only written
      // at exit or on reload.
      expect(entries()).toEqual(["tag dir"]);

      await Bun.write(join(String(dir), "app.js"), `require("./dep.js"); console.log("iter second");`);
      await child.waitFor("iter second\n");
      expect(child.output).toBe("iter first\niter second\n");
    }

    // The first image persisted app.js and dep.js before execve. The second
    // image was SIGKILLed, so it wrote nothing.
    expect(entries()).toEqual(["entry", "entry", "tag dir"]);
  }, 30_000);

  // NODE_CHANNEL_FD survives in environ across execve; the fd it names must
  // survive too, so the reloaded image re-attaches to a live socket instead
  // of a closed one and the parent keeps receiving 'message' events.
  it.skipIf(isWindows)(
    "IPC to the parent survives a --watch reload",
    async () => {
      using dir = tempDir("watch-ipc-reload", {
        "app.js": `process.send("iter first"); setInterval(() => {}, 1000);`,
      });
      const messages: string[] = [];
      let notify = () => {};
      await using child = watchChild(["app.js"], {
        cwd: String(dir),
        ipc: message => {
          messages.push(String(message));
          notify();
        },
      });
      // Waits for the next message; gives up if the child exits first so a
      // dead child fails the toEqual below instead of hanging.
      const received = async (expected: string) => {
        while (!messages.includes(expected)) {
          const next = new Promise<boolean>(resolve => (notify = () => resolve(true)));
          if (!(await Promise.race([next, child.proc.exited.then(() => false)]))) break;
        }
        return messages;
      };

      expect(await received("iter first")).toEqual(["iter first"]);
      await Bun.write(join(String(dir), "app.js"), `process.send("iter second");`);
      expect(await received("iter second")).toEqual(["iter first", "iter second"]);
    },
    30_000,
  );
});
