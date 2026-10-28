import type { Subprocess } from "bun";
import { spawn } from "bun";
import { afterAll, afterEach, expect, it } from "bun:test";
import { bunEnv, bunExe, isBroken, isLinux, isMacOS, isWindows, tempDir, tmpdirSync } from "harness";
import {
  copyFileSync,
  linkSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";

let watchee: Subprocess;

function stdoutWaiter(proc: Subprocess<"ignore", "pipe", any>) {
  const reader = proc.stdout.getReader();
  const decoder = new TextDecoder();
  let output = "";
  return {
    /** Resolves once `needle` has been printed `count` times. */
    waitFor: async (needle: string, count = 1) => {
      while (output.split(needle).length <= count) {
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

      for await (const line of watchee.stdout as ReadableStream<Uint8Array>) {
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
    watchee = undefined!;
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
      for await (const chunk of watchee.stdout as ReadableStream<Uint8Array>) {
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
    const proc = spawn({
      cwd,
      cmd: [bunExe(), "--watch", "--no-clear-screen", "spinner.js"],
      env: bunEnv,
      stdout: "pipe",
      stderr: "inherit",
      stdin: "ignore",
    });
    watchee = proc;
    const reader = proc.stdout.getReader();
    const decoder = new TextDecoder();
    let output = "";
    const waitForStarts = async (count: number) => {
      while (output.split("started\n").length - 1 < count) {
        const { value, done } = await reader.read();
        // stdout survives the exec, so a closed pipe means the process died
        // instead of reloading.
        if (done) throw new Error(`watchee exited after ${count - 1} reload(s): ${JSON.stringify(output)}`);
        output += decoder.decode(value, { stream: true });
      }
    };

    const reloads = 8;
    await waitForStarts(1);
    for (let i = 1; i <= reloads; i++) {
      await Bun.write(path, (await Bun.file(path).text()) + `// touch ${i}\n`);
      await waitForStarts(i + 1);
    }
    reader.releaseLock();
    proc.kill("SIGKILL");
    await proc.exited;

    expect(await Bun.file(join(cwd, "failures.txt")).text()).toBe("");
  },
  30000,
);

// The two tests below build an LD_PRELOAD shim around the libc calls that Watcher::init() and
// start() make on Linux. NO_CORE_C disables core files, which CI's runner would flag as a crash.
const cc = Bun.which("cc") || Bun.which("gcc") || Bun.which("clang");
const NO_CORE_C = /* c */ `
#include <sys/resource.h>
__attribute__((constructor)) static void no_core(void) {
  struct rlimit rl = {0, 0};
  setrlimit(RLIMIT_CORE, &rl);
}
`;

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
  return shimPath;
}

async function runWatcheeWithShim(dir: string, shimPath: string, args: string[]) {
  const existing = bunEnv.LD_PRELOAD;
  await using proc = Bun.spawn({
    // --debug-crash-handler-use-trace-string skips the debug build's slow
    // backtrace symbolication so an aborting child exits promptly.
    cmd: [bunExe(), "--debug-crash-handler-use-trace-string", ...args],
    cwd: dir,
    env: { ...bunEnv, LD_PRELOAD: existing ? `${shimPath}:${existing}` : shimPath },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode, signalCode: proc.signalCode };
}

// Watcher::start() must propagate a failed thread spawn as an Err through its
// Result return instead of aborting inside start() with `.expect()`. The shim
// arms on inotify_init1 (which Watcher::init() calls on Linux immediately
// before start()) and fails the very next pthread_create.
it.skipIf(!isLinux || !cc)("propagates FileWatcher thread spawn failure instead of panicking in start()", async () => {
  const SHIM_C = /* c */ `
#define _GNU_SOURCE
#include <dlfcn.h>
#include <errno.h>
#include <pthread.h>
${NO_CORE_C}
static int (*real_inotify_init1)(int);
static int (*real_pthread_create)(pthread_t *, const pthread_attr_t *, void *(*)(void *), void *);
static volatile int armed = 0;

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
  const shimPath = await compileShim(String(dir));
  const { stdout, stderr, exitCode } = await runWatcheeWithShim(String(dir), shimPath, ["--watch", "watchee.js"]);

  // The .expect("spawn FileWatcher thread") panic inside start() must be gone;
  // the error now reaches the caller, which reports it by errno name.
  expect(stderr).not.toContain("spawn FileWatcher thread");
  expect(stderr).toContain("Failed to start File Watcher: EAGAIN");
  expect(stdout).not.toContain("unreachable");
  expect(exitCode).not.toBe(0);
});

// EMFILE means the user is out of inotify instances or the process is out of file descriptors.
it.skipIf(!isLinux || !cc)("prints an error and exits with code 1 when inotify_init1 fails", async () => {
  using dir = tempDir("watch-init-fail", {
    "shim.c": /* c */ `
#include <errno.h>
${NO_CORE_C}
int inotify_init1(int flags) {
  (void)flags;
  errno = EMFILE;
  return -1;
}
`,
    "watchee.js": "console.log('unreachable');\n",
  });
  const shimPath = await compileShim(String(dir));
  expect(await runWatcheeWithShim(String(dir), shimPath, ["--watch", "watchee.js"])).toEqual({
    stdout: "",
    stderr: "error: Failed to enable File Watcher: EMFILE\n",
    exitCode: 1,
    signalCode: null,
  });
});

it.skipIf(isWindows)("--watch reports an error when its executable was deleted", async () => {
  using dir = tempDir("watch-exe-removed", {
    "app/entry.js": `console.log("iter first"); setInterval(() => {}, 1000);`,
  });
  const exe = join(String(dir), basename(bunExe()));
  copyFileSync(bunExe(), exe);
  const proc = spawn({
    // The flag skips a debug build's slow crash symbolication.
    cmd: [exe, "--debug-crash-handler-use-trace-string", "--watch", "entry.js"],
    cwd: join(String(dir), "app"),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  });
  watchee = proc;
  const stderr = proc.stderr.text();

  const { waitFor, release } = stdoutWaiter(proc);
  await waitFor("iter first");
  release();

  rmSync(exe);
  await Bun.write(join(String(dir), "app", "entry.js"), `console.log("iter second");`);

  expect(await stderr).toContain(`error: Failed to reload "${exe}`);
  expect(await stderr).toContain(`ENOENT (execve)`);
  expect(await proc.exited).toBe(1);
});

// On Windows, the first --watch process acts as a manager that restarts the script in a child process on every change.
it.skipIf(!isWindows)("--watch reports an error when its executable was renamed", async () => {
  // Windows can keep the renamed executable mapped briefly after the manager exits, so ignore a failed delete.
  const dir = tempDir("watch-exe-renamed", {
    "app/entry.js": `console.log("iter first"); setInterval(() => {}, 1000);`,
  });
  try {
    const exe = join(String(dir), basename(bunExe()));
    copyFileSync(bunExe(), exe);
    await using proc = spawn({
      cmd: [exe, "--watch", "entry.js"],
      cwd: join(String(dir), "app"),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
      stdin: "ignore",
    });
    const stderr = proc.stderr.text();

    const { waitFor, release } = stdoutWaiter(proc);
    await waitFor("iter first");
    release();

    renameSync(exe, exe + ".renamed");
    await Bun.write(join(String(dir), "app", "entry.js"), `console.log("iter second");`);

    expect((await stderr).replaceAll("\r\n", "\n")).toBe(`error: Failed to start "${exe}": ENOENT (CreateProcessW)\n`);
    expect(await proc.exited).toBe(1);
  } finally {
    try {
      rmSync(String(dir), { recursive: true, force: true });
    } catch {}
  }
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

  const env: typeof bunEnv = { ...bunEnv, FORCE_COLOR: "1" };
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

// The files and directories a process holds open, as (fd, path) pairs. Linux
// reads /proc, macOS asks lsof (the kernel has no per-process fd listing
// there). lsof also lists the cwd, the executable and mapped libraries under
// the fd names "cwd", "txt" and "mem"; a numbered fd is a real descriptor.
function openFds(pid: number): { fd: string; path: string }[] {
  if (isLinux) {
    const fdDir = `/proc/${pid}/fd`;
    return readdirSync(fdDir).flatMap(fd => {
      // The process is live, so an fd listed a moment ago can be closed by
      // the time it is read. A closed fd is not a held path.
      try {
        return [{ fd, path: readlinkSync(join(fdDir, fd)) }];
      } catch {
        return [];
      }
    });
  }
  const out = Bun.spawnSync({ cmd: ["lsof", "-Ffn", "-p", String(pid)], stdout: "pipe", stderr: "ignore" });
  const fds: { fd: string; path: string }[] = [];
  let fd = "";
  for (const line of out.stdout.toString().split("\n")) {
    if (line.startsWith("f")) fd = line.slice(1);
    else if (line.startsWith("n/")) fds.push({ fd, path: line.slice(1) });
  }
  return fds;
}

function openPaths(pid: number): string[] {
  return openFds(pid).map(e => e.path);
}

// Watch mode used to make the resolver keep every directory and symlink
// descriptor it opened, most of them under node_modules, which the watcher
// never registers. On macOS each one is an fd for the life of the dev
// server, and a monorepo with the isolated linker reached tens of thousands
// of them (#42702).
for (const [mode, args] of [
  ["--watch", ["--watch", "--no-clear-screen", "main.ts"]],
  ["--hot", ["--hot", "--no-clear-screen", "main.ts"]],
  ["test --watch", ["test", "--watch", "main.test.ts"]],
] as const) {
  it.skipIf(isWindows || (isMacOS && !Bun.which("lsof")))(
    `${mode} holds no file descriptors for paths under node_modules`,
    async () => {
      using dir = tempDir("watch-node-modules-fds", {
        "main.ts": `import { x } from "dep";
import { y } from "dep2";
console.log("ready", x, y);
setInterval(() => {}, 1e6);
`,
        "main.test.ts": `import { test } from "bun:test";
import { x } from "dep";
import { y } from "dep2";
test("ready", () => console.log("ready", x, y));
`,
        "node_modules/dep/package.json": JSON.stringify({
          name: "dep",
          type: "module",
          exports: { ".": { import: "./dist/esm/index.js" } },
        }),
        "node_modules/dep/dist/esm/index.js": "export const x = 1;",
        // The layout of the isolated linker: the real package lives under
        // node_modules/.bun and node_modules/dep2 is a symlink to it.
        "node_modules/.bun/dep2@1.0.0/node_modules/dep2/package.json": JSON.stringify({
          name: "dep2",
          type: "module",
          main: "./dist/index.js",
        }),
        "node_modules/.bun/dep2@1.0.0/node_modules/dep2/dist/index.js": "export const y = 2;",
      });
      const cwd = realpathSync(String(dir));
      symlinkSync(join(".bun", "dep2@1.0.0", "node_modules", "dep2"), join(cwd, "node_modules", "dep2"));

      watchee = spawn({
        cwd,
        cmd: [bunExe(), ...args],
        env: bunEnv,
        stdout: "pipe",
        stderr: "inherit",
        stdin: "ignore",
      });
      const waiter = stdoutWaiter(watchee);
      await waiter.waitFor("ready 1 2");

      const held = openPaths(watchee.pid);
      waiter.release();

      // stdin, stdout and stderr are always there, so an empty list means the
      // listing failed rather than that nothing is held.
      expect(held.length).toBeGreaterThan(0);
      expect(held.filter(p => p.startsWith(cwd) && p.includes("node_modules"))).toEqual([]);
    },
  );
}

// A --watch reload is an execve of the same binary. Linux marks every fd
// close-on-exec with close_range() first, macOS has no such sweep, so an fd
// the watcher opened without O_CLOEXEC survives into the new image and the
// watcher opens another one: one leaked directory fd per reload (#42700).
const watchCloexecFiles = {
  "dep.ts": `export const x = 1;`,
  "main.ts": `import { x } from "./dep";\nconsole.log("started", x);\nsetInterval(() => {}, 1e6);\n`,
};

// The inodes that the inotify instances of `pid` watch. A watch is not a
// descriptor: the instance lists each one on an "inotify wd:" line of its
// fdinfo, with the inode number in hex.
function inotifyInodes(pid: number): string[] {
  const inodes: string[] = [];
  for (const { fd, path } of openFds(pid)) {
    if (path !== "anon_inode:inotify") continue;
    try {
      const fdinfo = readFileSync(`/proc/${pid}/fdinfo/${fd}`, "utf8");
      for (const [, inode] of fdinfo.matchAll(/^inotify wd:\S+ ino:([0-9a-f]+) /gm)) inodes.push(inode);
    } catch {
      // Closed since it was listed.
    }
  }
  return inodes;
}

// The numbered fds of `pid` under `cwd`, keyed by the path relative to it
// ("/" is the directory itself). The watcher thread registers the entrypoint,
// its import and their directory after the script starts, so this polls until
// all three are registered. kqueue watches each of them through a descriptor.
// inotify watches them by path and the watcher holds a descriptor for the
// directory only: one on a file would keep its inode alive after a save by
// rename, and the kernel would then never report the old inode as deleted.
async function watchedFds(pid: number, cwd: string): Promise<Map<string, string[]>> {
  const deadline = Date.now() + 30_000;
  for (;;) {
    const watched = new Map<string, string[]>();
    for (const { fd, path } of openFds(pid)) {
      if (!/^\d+$/.test(fd)) continue;
      if (path !== cwd && !path.startsWith(cwd + "/")) continue;
      const rel = path.slice(cwd.length) || "/";
      watched.set(rel, [...(watched.get(rel) ?? []), fd]);
    }
    if (isLinux ? watched.has("/") && inotifyInodes(pid).length >= 3 : watched.size >= 3) return watched;
    if (Date.now() > deadline) {
      throw new Error(`the watcher of ${pid} did not register its files: ${JSON.stringify([...watched])}`);
    }
    await Bun.sleep(10);
  }
}

// The leak as the issue reports it: the count of fds on the project directory
// after two reloads must equal the count after the first start.
it.skipIf(isWindows || (isMacOS && !Bun.which("lsof")))(
  "--watch reload does not leak the watched directory fd",
  async () => {
    using dir = tempDir("watch-cloexec-reload", watchCloexecFiles);
    const cwd = realpathSync(String(dir));
    watchee = spawn({
      cwd,
      cmd: [bunExe(), "--watch", "--no-clear-screen", "main.ts"],
      env: bunEnv,
      stdout: "pipe",
      stderr: "inherit",
      stdin: "ignore",
    });
    const out = stdoutWaiter(watchee);
    await out.waitFor("started 1");
    const before = (await watchedFds(watchee.pid, cwd)).get("/")!.length;

    for (let i = 2; i <= 3; i++) {
      await Bun.write(join(cwd, "dep.ts"), `export const x = ${i};`);
      await out.waitFor(`started ${i}`);
    }
    const after = (await watchedFds(watchee.pid, cwd)).get("/")!.length;
    out.release();

    expect(before).toBe(1);
    expect(after).toBe(before);
  },
);

// The flag itself. Linux hides the leak behind its close_range() sweep, so
// this reads O_CLOEXEC from /proc for every fd the watcher holds instead of
// counting fds across reloads. On Linux that is the directory: see watchedFds
// for why the two watched files have no descriptor.
it.skipIf(!isLinux)("watcher opens the watched directory with O_CLOEXEC and no watched file", async () => {
  using dir = tempDir("watch-cloexec", watchCloexecFiles);
  const cwd = realpathSync(String(dir));
  watchee = spawn({
    cwd,
    cmd: [bunExe(), "--watch", "--no-clear-screen", "main.ts"],
    env: bunEnv,
    stdout: "pipe",
    stderr: "inherit",
    stdin: "ignore",
  });
  const out = stdoutWaiter(watchee);
  await out.waitFor("started 1");
  const watched = await watchedFds(watchee.pid, cwd);
  out.release();

  const O_CLOEXEC = 0o2000000;
  const flagsOf = (fds: string[]) =>
    fds.map(fd => {
      const fdinfo = readFileSync(`/proc/${watchee.pid}/fdinfo/${fd}`, "utf8");
      return parseInt(/flags:\s*(\d+)/.exec(fdinfo)![1], 8) & O_CLOEXEC;
    });
  expect(Object.fromEntries([...watched].sort().map(([rel, fds]) => [rel, flagsOf(fds)]))).toEqual({
    "/": [O_CLOEXEC],
  });
});

// A save by rename (write a temp file, rename() it over the target) puts a new
// inode at the path. An inotify watch stays on the old inode, and the kernel
// reports that inode as deleted only once nothing holds it open. The watcher
// used to keep the descriptor each file was read through, so it saw the save
// only through the watch on the file's directory. A file outside the working
// directory has no such watch, and the directory's event is not matched to a
// dot-file, to an extension without a loader, or to a package behind a symlink.
// Linux only: kqueue watches through a descriptor and reports the replaced
// file at once, and the Windows watcher matches events by path.
function saveByRename(path: string, content: string) {
  writeFileSync(path + ".tmp", content);
  renameSync(path + ".tmp", path);
}

// vim, Neovim and Helix move the file to a backup name, write a new file and
// remove the backup. The watch follows the old inode to the backup name, so
// the new file is seen only when the backup goes.
function saveByBackup(path: string, content: string) {
  renameSync(path, path + "~");
  writeFileSync(path, content);
  rmSync(path + "~");
}

// The tests below run concurrently, each with its own process. One that times
// out never reaches the end of its `await using` scope.
const concurrentWatchees = new Set<Subprocess>();
function spawnWatchee(cwd: string, args: readonly string[], env: Record<string, string | undefined> = bunEnv) {
  const proc = spawn({ cwd, cmd: [bunExe(), ...args], env, stdout: "pipe", stderr: "inherit", stdin: "ignore" });
  concurrentWatchees.add(proc);
  return proc;
}
afterAll(() => {
  for (const proc of concurrentWatchees) proc.kill("SIGKILL");
});

// Resolves once an inotify watch is on the file that `path` names now.
async function watchOn(pid: number, path: string) {
  const inode = statSync(path).ino.toString(16);
  const started = Date.now();
  let told = false;
  while (!inotifyInodes(pid).includes(inode)) {
    const waited = Date.now() - started;
    // The timeout of the test can come before the deadline. This names the step then.
    if (!told && waited > 3000) {
      told = true;
      console.error(`watchOn: no inotify watch on ${path} (inode ${inode}) after 3 s`);
    }
    if (waited > 30_000) {
      throw new Error(`no inotify watch on ${path} (inode ${inode}), watched: ${inotifyInodes(pid).join(" ")}`);
    }
    await Bun.sleep(10);
  }
}

const keepAlive = "setInterval(() => {}, 1e6);\n";
const entryPoint = (n: number) => `console.log("run ${n}");\n${keepAlive}`;
const importer = (specifier: string) =>
  `import { n } from ${JSON.stringify(specifier)};\nconsole.log("run", n);\n${keepAlive}`;
const exporter = (n: number) => `export const n = ${n};\n`;

const renameSaveCases: {
  name: string;
  /** Relative to a temp directory. The working directory is `app`. */
  files: Record<string, string>;
  symlink?: [target: string, path: string];
  args: string[];
  saved: string;
  content: (n: number) => string;
  save?: (path: string, content: string) => void;
  /** A hard link keeps each replaced inode alive, so only the event of the directory reports the save. */
  held?: boolean;
  saves?: number;
}[] = [
  // The module loader does not register a path with the letters "node_modules"
  // in it, which leaves that entry point with the watch it gets by path: that
  // one reloaded before. Both must reload, however the loader treats the path.
  ...["tools", "node_modules-tools"].flatMap(dir =>
    ["--watch", "--hot"].map(flag => ({
      name: `${flag} entry point in ../${dir}`,
      files: { "app/.keep": "", [`${dir}/server.js`]: entryPoint(1) },
      args: [flag, "--no-clear-screen", `../${dir}/server.js`],
      saved: `${dir}/server.js`,
      content: entryPoint,
    })),
  ),
  ...["--watch", "--hot"].map(flag => ({
    name: `${flag} import outside the working directory`,
    files: { "app/main.js": importer("../lib/dep.js"), "lib/dep.js": exporter(1) },
    args: [flag, "--no-clear-screen", "main.js"],
    saved: "lib/dep.js",
    content: exporter,
  })),
  {
    name: "test --watch import outside the working directory",
    files: {
      "app/a.test.js": `import { test } from "bun:test";\nimport { n } from "../lib/dep.js";\ntest("t", () => console.log("run", n));\n`,
      "lib/dep.js": exporter(1),
    },
    args: ["test", "--watch", "a.test.js"],
    saved: "lib/dep.js",
    content: exporter,
  },
  {
    name: "--watch dot-named import",
    files: { "app/main.js": importer("./.dep.js"), "app/.dep.js": exporter(1) },
    args: ["--watch", "--no-clear-screen", "main.js"],
    saved: "app/.dep.js",
    content: exporter,
  },
  {
    name: "--hot text import with an extension that has no loader",
    files: {
      "app/main.js": `import n from "./n.data" with { type: "text" };\nconsole.log("run", n.trim());\n${keepAlive}`,
      "app/n.data": "1\n",
    },
    args: ["--hot", "--no-clear-screen", "main.js"],
    saved: "app/n.data",
    content: n => `${n}\n`,
  },
  {
    name: "--watch workspace package behind a symlink",
    files: {
      "app/main.js": importer("@repo/db"),
      "app/packages/db/package.json": JSON.stringify({ name: "@repo/db", main: "index.js" }),
      "app/packages/db/index.js": exporter(1),
      "app/node_modules/@repo/.keep": "",
    },
    symlink: [join("..", "..", "packages", "db"), "app/node_modules/@repo/db"],
    args: ["--watch", "--no-clear-screen", "main.js"],
    saved: "app/packages/db/index.js",
    content: exporter,
  },
  // Under --watch these reloaded before: the restart watches the new file.
  {
    name: "--hot import outside the working directory, saved through a backup file,",
    files: { "app/main.js": importer("../lib/dep.js"), "lib/dep.js": exporter(1) },
    args: ["--hot", "--no-clear-screen", "main.js"],
    saved: "lib/dep.js",
    content: exporter,
    save: saveByBackup,
  },
  {
    name: "--hot entry point in ../tools, saved through a backup file,",
    files: { "app/.keep": "", "tools/server.js": entryPoint(1) },
    args: ["--hot", "--no-clear-screen", "../tools/server.js"],
    saved: "tools/server.js",
    content: entryPoint,
    save: saveByBackup,
  },
  // Only the event of the directory reports these saves. Without the fix they
  // reload too, and fail on the descriptor that is left open.
  ...["--watch", "--hot"].map(flag => ({
    name: `${flag} import in the working directory whose replaced inode stays alive`,
    files: { "app/main.js": importer("./dep.js"), "app/dep.js": exporter(1) },
    args: [flag, "--no-clear-screen", "main.js"],
    saved: "app/dep.js",
    content: exporter,
    held: true,
    saves: 2,
  })),
];

for (const { name, files, symlink, args, saved, content, save = saveByRename, held, saves = 3 } of renameSaveCases) {
  it.concurrent.skipIf(!isLinux)(
    `${name} reloads after each save${save === saveByRename ? " by rename" : ""}`,
    async () => {
      using dir = tempDir("watch-rename-save", files);
      const root = realpathSync(String(dir));
      if (symlink) symlinkSync(symlink[0], join(root, symlink[1]));
      await using proc = spawnWatchee(join(root, "app"), args);
      const out = stdoutWaiter(proc);
      const target = join(root, saved);
      for (let n = 1; n <= saves + 1; n++) {
        if (n > 1) {
          if (held) linkSync(target, join(root, `held-${n}`));
          save(target, content(n));
        }
        await out.waitFor(`run ${n}\n`);
        // A file that only the watcher registers, by path, is registered after
        // the run that loaded it has started. The next save must not come first.
        await watchOn(proc.pid, target);
      }
      out.release();
      // Each save replaced the inode and the watch is on the current one, with no
      // descriptor open on the file.
      expect(openPaths(proc.pid).filter(path => path.startsWith(target))).toEqual([]);
    },
  );
}

it.concurrent.skipIf(!isLinux)(
  "build --watch rebuilds an input outside the working directory after each save by rename",
  async () => {
    using dir = tempDir("watch-build-rename-save", { "app/.keep": "", "src/entry.js": `console.log("run 1");\n` });
    const root = realpathSync(String(dir));
    await using proc = spawnWatchee(join(root, "app"), ["build", "--watch", "../src/entry.js", "--outdir", "out"]);
    const out = stdoutWaiter(proc);
    const entry = join(root, "src", "entry.js");
    await out.waitFor("Bundled");
    for (let n = 2; n <= 4; n++) {
      await watchOn(proc.pid, entry);
      saveByRename(entry, `console.log("run ${n}");\n`);
      await out.waitFor("Bundled", n);
      expect(readFileSync(join(root, "app", "out", "entry.js"), "utf8")).toContain(`"run ${n}"`);
    }
    out.release();
    expect(openPaths(proc.pid).filter(path => path.startsWith(entry))).toEqual([]);
  },
);

// On Windows the handle that the watcher kept on a watched file also made the
// rename itself fail with EPERM (#41045). Nothing reports that the watcher of
// a new run has started, so a save is repeated until that run sees it. The
// module loader of that run holds the file while it reads it, and a rename in
// that moment fails on Windows as well. That save is tried again: only a
// handle that stays open keeps the reload away.
for (const flag of ["--watch", "--hot"]) {
  it.concurrent(`${flag} lets a save by rename replace the entry point`, async () => {
    using dir = tempDir("watch-rename-over-entry", { "main.js": entryPoint(1) });
    const cwd = realpathSync(String(dir));
    await using proc = spawnWatchee(cwd, [flag, "--no-clear-screen", "main.js"]);
    const out = stdoutWaiter(proc);
    await out.waitFor("run 1\n");
    for (let n = 2; n <= 4; n++) {
      let reloaded = false;
      const reload = out.waitFor(`run ${n}\n`).then(() => {
        reloaded = true;
      });
      while (!reloaded) {
        try {
          saveByRename(join(cwd, "main.js"), entryPoint(n));
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          if (!isWindows || (code !== "EPERM" && code !== "EACCES" && code !== "EBUSY")) throw error;
        }
        await Promise.race([reload, Bun.sleep(250)]);
      }
    }
    out.release();
  });
}

// The other side of the same events. A removed file is also reported as a
// deleted inode. These guard against a restart loop: a program that writes a
// module, imports it and removes it, once, runs once where the directory's
// event is not matched to the module (outside the working directory, or under
// a dot-name). Under a matched name in the working directory the removal
// restarts such a program, as it does on kqueue and Windows everywhere (see
// "reloads when an import in the working directory is removed" below). A
// program that creates the same path again can still restart.
const removesItsImport = `const { RUNS, GENERATED } = process.env;
appendFileSync(RUNS, "x");
writeFileSync(GENERATED, "export const n = 1;");
const { n } = await import(GENERATED);
rmSync(GENERATED);
console.log("ran", n);
`;
const importsFs = `import { appendFileSync, rmSync, writeFileSync } from "node:fs";\n`;
for (const [name, args, generated] of [
  ["--watch, module outside the working directory", ["--watch", "--no-clear-screen", "main.js"], "generated/mod.mjs"],
  ["--hot, dot-named module in the working directory", ["--hot", "--no-clear-screen", "main.js"], "app/.mod.mjs"],
  ["test --watch, module outside the working directory", ["test", "--watch", "main.test.js"], "generated/mod.mjs"],
] as const) {
  it.concurrent.skipIf(!isLinux)(`a program that removes a module it imported runs once (${name})`, async () => {
    using dir = tempDir("watch-removes-import", {
      "app/main.js": importsFs + removesItsImport + keepAlive,
      "app/main.test.js": `import { test } from "bun:test";\n${importsFs}test("t", async () => {\n${removesItsImport}});\n`,
      "generated/.keep": "",
      "runs": "",
    });
    const root = realpathSync(String(dir));
    const runs = join(root, "runs");
    const started = performance.now();
    await using proc = spawnWatchee(join(root, "app"), args, {
      ...bunEnv,
      RUNS: runs,
      GENERATED: join(root, generated),
    });
    const out = stdoutWaiter(proc);
    await out.waitFor("ran 1\n");
    out.release();
    // A restart takes about as long as the start did, and nothing signals that
    // none is coming. Look for one for twice that long.
    const deadline = performance.now() + Math.max(2 * (performance.now() - started), 300);
    while (performance.now() < deadline) {
      expect(readFileSync(runs, "utf8")).toBe("x");
      await Bun.sleep(10);
    }
  });
}

// An import that the user removes from the working directory reloads, and the
// run reports it. The event of the directory does that, on the old inode's
// entry. This passes without the fix.
for (const flag of ["--watch", "--hot"]) {
  it.concurrent.skipIf(!isLinux)(`${flag} reloads when an import in the working directory is removed`, async () => {
    using dir = tempDir("watch-removed-import", { "main.js": importer("./dep.js"), "dep.js": exporter(1) });
    const cwd = realpathSync(String(dir));
    await using proc = spawn({
      cwd,
      cmd: [bunExe(), flag, "--no-clear-screen", "main.js"],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
      stdin: "ignore",
    });
    concurrentWatchees.add(proc);
    const out = stdoutWaiter(proc);
    await out.waitFor("run 1\n");
    out.release();
    await watchOn(proc.pid, join(cwd, "dep.js"));
    rmSync(join(cwd, "dep.js"));
    let stderr = "";
    for await (const chunk of proc.stderr) {
      stderr += new TextDecoder().decode(chunk);
      if (stderr.includes("Cannot find module")) break;
    }
    expect(stderr).toContain("Cannot find module");
  });
}

// A stylesheet that a program imports once is registered by path, and no run
// registers it again. The event of the directory must leave its entry in the
// watchlist, or the second save is lost. This passes without the fix.
it.concurrent.skipIf(!isLinux)("--hot reloads on each save of a stylesheet that was imported once", async () => {
  using dir = tempDir("watch-once-imported", {
    "main.js": `import { readFileSync } from "node:fs";\nglobalThis.once ??= await import("./a.css");\nconsole.log("read", readFileSync("a.css", "utf8"));\n${keepAlive}`,
    "a.css": "/* 1 */\n",
  });
  const cwd = realpathSync(String(dir));
  await using proc = spawnWatchee(cwd, ["--hot", "--no-clear-screen", "main.js"]);
  const out = stdoutWaiter(proc);
  await out.waitFor("read /* 1 */\n");
  await watchOn(proc.pid, join(cwd, "a.css"));
  for (let n = 2; n <= 4; n++) {
    writeFileSync(join(cwd, "a.css"), `/* ${n} */\n`);
    await out.waitFor(`read /* ${n} */\n`);
  }
  out.release();
});
