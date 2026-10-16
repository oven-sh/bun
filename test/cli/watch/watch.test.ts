import type { Subprocess } from "bun";
import { spawn } from "bun";
import { afterAll, afterEach, describe, expect, it } from "bun:test";
import { bunEnv, bunExe, isBroken, isLinux, isMacOS, isWindows, tempDir, tmpdirSync } from "harness";
import {
  closeSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";
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

// The numbered fds of `pid` under `cwd`, keyed by the path relative to it
// ("/" is the directory itself). The watcher thread registers the entrypoint,
// its import and their directory after the script starts, so this polls until
// all three are open.
async function watchedFds(pid: number, cwd: string): Promise<Map<string, string[]>> {
  for (;;) {
    const watched = new Map<string, string[]>();
    for (const { fd, path } of openFds(pid)) {
      if (!/^\d+$/.test(fd)) continue;
      if (path !== cwd && !path.startsWith(cwd + "/")) continue;
      const rel = path.slice(cwd.length) || "/";
      watched.set(rel, [...(watched.get(rel) ?? []), fd]);
    }
    if (watched.size >= 3) return watched;
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
// counting fds across reloads.
it.skipIf(!isLinux)("watcher opens the watched directory and files with O_CLOEXEC", async () => {
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
    "/dep.ts": [O_CLOEXEC],
    "/main.ts": [O_CLOEXEC],
  });
});

// The reader closes a source file right after the read when the open-file limit is 254 or less, or
// once it has seen a descriptor number at half of the limit. The module loader and the bundler used
// to watch a file only through that descriptor, so they did not watch such a file at all.
// kqueue needs a descriptor for each watch, so there such a file stays unwatched. Windows never
// closes a source file early.
describe.skipIf(isWindows)("a file that was read near the open-file limit", () => {
  // A concurrent test that times out never reaches its own cleanup.
  const children = new Set<Subprocess>();
  afterAll(async () => {
    for (const child of children) child.kill("SIGKILL");
    await Promise.all(Array.from(children, child => child.exited));
  });
  // Each test restarts or reloads a process several times, next to the other tests of this block.
  const timeout = 30_000;

  // Resolves when `needle` shows up after the text that earlier calls consumed.
  function reader(stream: ReadableStream<Uint8Array>) {
    const source = stream.getReader();
    const decoder = new TextDecoder();
    let output = "";
    let consumed = 0;
    return async (needle: string) => {
      for (;;) {
        const at = output.indexOf(needle, consumed);
        if (at !== -1) {
          consumed = at + needle.length;
          return;
        }
        const { value, done } = await source.read();
        if (done) throw new Error(`stream closed before ${JSON.stringify(needle)}: ${JSON.stringify(output)}`);
        output += decoder.decode(value, { stream: true });
      }
    };
  }

  function run(limit: number, cwd: string, args: string[], stderr: "inherit" | "pipe" = "inherit") {
    const proc = spawn({
      // `sh` sets the soft and the hard limit, so bun cannot raise it again.
      cmd: ["sh", "-c", `ulimit -n ${limit} && exec "$0" "$@"`, bunExe(), ...args],
      cwd,
      env: bunEnv,
      stdout: "pipe",
      stderr,
      stdin: "ignore",
    });
    children.add(proc);
    return {
      stdout: reader(proc.stdout),
      stderr: stderr === "pipe" ? reader(proc.stderr as ReadableStream<Uint8Array>) : undefined,
      async [Symbol.asyncDispose]() {
        proc.kill("SIGKILL");
        await proc.exited;
        children.delete(proc);
      },
    };
  }

  // One write, same length, no truncate: a single watcher event, and a reload never reads a partial file.
  function overwrite(path: string, contents: string) {
    const fd = openSync(path, "r+");
    try {
      writeSync(fd, contents, 0);
    } finally {
      closeSync(fd);
    }
  }

  for (const mode of ["--watch", "--hot"]) {
    it.concurrent(
      `${mode} reloads import, import() and require() at an open-file limit of 200`,
      async () => {
        using dir = tempDir("watch-closed-early", {
          "static.js": `export const a = 1;`,
          "dynamic.js": `export const b = 1;`,
          "required.cjs": `exports.c = 1;`,
          "entry.js": `
          import { a } from "./static.js";
          const { b } = await import("./dynamic.js");
          const { c } = require("./required.cjs");
          console.log("values", a, b, c);
          setInterval(() => {}, 1 << 30);
        `,
        });
        const cwd = String(dir);
        await using proc = run(200, cwd, [mode, "--no-clear-screen", "entry.js"]);
        await proc.stdout("values 1 1 1\n");
        // On kqueue the three modules stay unwatched. They still have to load.
        if (!isLinux) return;
        // The second round finds each module watched again after its first reload.
        for (const round of [2, 3]) {
          overwrite(join(cwd, "static.js"), `export const a = ${round};`);
          await proc.stdout(`values ${round} ${round - 1} ${round - 1}\n`);
          overwrite(join(cwd, "dynamic.js"), `export const b = ${round};`);
          await proc.stdout(`values ${round} ${round} ${round - 1}\n`);
          overwrite(join(cwd, "required.cjs"), `exports.c = ${round};`);
          await proc.stdout(`values ${round} ${round} ${round}\n`);
        }
      },
      timeout,
    );

    it.skipIf(!isLinux).concurrent(
      `${mode} reloads modules loaded while 600 of 1024 descriptors are held`,
      async () => {
        using dir = tempDir("watch-closed-early-held", {
          "first.js": `export const z = 0;`,
          "late.js": `export const a = 1;`,
          "late.cjs": `exports.b = 1;`,
          // Which read first meets the limit differs by build, so the modules under test come second.
          "entry.js": `
          import { openSync } from "node:fs";
          globalThis.held ??= [];
          while (globalThis.held.length < 600) globalThis.held.push(openSync("entry.js", "r"));
          await import("./first.js");
          const { a } = await import("./late.js");
          const { b } = require("./late.cjs");
          console.log("values", a, b);
          setInterval(() => {}, 1 << 30);
        `,
        });
        const cwd = String(dir);
        await using proc = run(1024, cwd, [mode, "--no-clear-screen", "entry.js"]);
        await proc.stdout("values 1 1\n");
        overwrite(join(cwd, "late.js"), `export const a = 2;`);
        await proc.stdout("values 2 1\n");
        overwrite(join(cwd, "late.cjs"), `exports.b = 2;`);
        await proc.stdout("values 2 2\n");
      },
      timeout,
    );

    it.skipIf(!isLinux).concurrent(
      `${mode} reloads a module that failed to parse at an open-file limit of 200`,
      async () => {
        using dir = tempDir("watch-closed-early-parse-error", {
          "static.js": `export const a = ];`,
          "required.cjs": `exports.c = ];`,
          "entry.js": `
          import { a } from "./static.js";
          const { c } = require("./required.cjs");
          console.log("values", a, c);
          setInterval(() => {}, 1 << 30);
        `,
        });
        const cwd = String(dir);
        await using proc = run(200, cwd, [mode, "--no-clear-screen", "entry.js"], "pipe");
        await proc.stderr!("static.js");
        overwrite(join(cwd, "static.js"), `export const a = 1;`);
        await proc.stderr!("required.cjs");
        overwrite(join(cwd, "required.cjs"), `exports.c = 1;`);
        await proc.stdout("values 1 1\n");
      },
      timeout,
    );
  }

  it.skipIf(!isLinux).concurrent(
    "--hot reloads a save by rename while the old file is open elsewhere, at an open-file limit of 200",
    async () => {
      using dir = tempDir("hot-closed-early-rename-over", {
        "dep.js": `export const value = 1;`,
        "entry.js": `
          import { value } from "./dep.js";
          console.log("value", value);
          setInterval(() => {}, 1 << 30);
        `,
      });
      const cwd = String(dir);
      const dep = join(cwd, "dep.js");
      await using proc = run(200, cwd, ["--hot", "--no-clear-screen", "entry.js"]);
      await proc.stdout("value 1\n");
      // The replaced file stays alive, so its own watch reports nothing. Only the directory reports the save.
      const old = openSync(dep, "r");
      try {
        writeFileSync(dep + ".tmp", `export const value = 2;`);
        renameSync(dep + ".tmp", dep);
        await proc.stdout("value 2\n");
        overwrite(dep, `export const value = 3;`);
        await proc.stdout("value 3\n");
      } finally {
        closeSync(old);
      }
    },
    timeout,
  );

  // A watch must not cost a descriptor for each directory either, or this program does not start.
  it.skipIf(!isLinux).concurrent(
    "--watch reloads with more module directories than the open-file limit",
    async () => {
      const count = 220;
      using dir = tempDir("watch-closed-early-directories", {
        "entry.js":
          Array.from({ length: count }, (_, i) => `import { value as v${i} } from "./d${i}/m.js";`).join("\n") +
          `\nconsole.log("value", v${count - 1});\nsetInterval(() => {}, 1 << 30);\n`,
      });
      const cwd = String(dir);
      for (let i = 0; i < count; i++) {
        mkdirSync(join(cwd, `d${i}`));
        writeFileSync(join(cwd, `d${i}`, "m.js"), `export const value = 1;`);
      }
      await using proc = run(200, cwd, ["--watch", "--no-clear-screen", "entry.js"]);
      await proc.stdout("value 1\n");
      overwrite(join(cwd, `d${count - 1}`, "m.js"), `export const value = 2;`);
      await proc.stdout("value 2\n");
    },
    timeout,
  );

  it.skipIf(!isLinux).concurrent(
    "test --watch runs again at an open-file limit of 200",
    async () => {
      const testFile = (tag: string) =>
        `import { test } from "bun:test";\nimport { value } from "./dep.js";\ntest("t", () => console.log("${tag}", value));\n`;
      using dir = tempDir("test-watch-closed-early", {
        "dep.js": `export const value = 1;`,
        "a.test.js": testFile("first"),
      });
      const cwd = String(dir);
      await using proc = run(200, cwd, ["test", "--watch", "--no-clear-screen"]);
      await proc.stdout("first 1\n");
      overwrite(join(cwd, "dep.js"), `export const value = 2;`);
      await proc.stdout("first 2\n");
      overwrite(join(cwd, "a.test.js"), testFile("again"));
      await proc.stdout("again 2\n");
    },
    timeout,
  );

  it.skipIf(!isLinux).concurrent(
    "build --watch builds again at an open-file limit of 200",
    async () => {
      using dir = tempDir("build-watch-closed-early", {
        "dep.js": `export const value = "dep-1";`,
        "entry.js": `import { value } from "./dep.js";\nconsole.log(value, "entry-1");\n`,
      });
      const cwd = String(dir);
      await using proc = run(200, cwd, ["build", "--watch", "--no-clear-screen", "entry.js", "--outdir", "out"]);
      // Each build prints one "(entry point)" line after it wrote the output.
      const built = async (needle: string) => {
        do await proc.stdout("(entry point)");
        while (!readFileSync(join(cwd, "out", "entry.js"), "utf8").includes(needle));
      };
      await built("dep-1");
      overwrite(join(cwd, "dep.js"), `export const value = "dep-2";`);
      await built("dep-2");
      overwrite(join(cwd, "entry.js"), `import { value } from "./dep.js";\nconsole.log(value, "entry-2");\n`);
      await built("entry-2");
    },
    timeout,
  );

  // The dev server of an HTML route has its own watcher, which registers the files of the bundle.
  it.skipIf(!isLinux).concurrent(
    "--hot with an HTML route serves a page edit and reloads a server module at an open-file limit of 200",
    async () => {
      using dir = tempDir("hot-html-closed-early", {
        "index.html": `<!doctype html><html><body><script type="module" src="./app.js"></script></body></html>`,
        "app.js": `import { value } from "./web/dep.js";\nconsole.log(value);\n`,
        "web/dep.js": `export const value = "dep-1";`,
        "api.js": `export const api = 1;`,
        "server.js": `
          import { writeFileSync } from "node:fs";
          import home from "./index.html";
          import { api } from "./api.js";
          globalThis.server ??= Bun.serve({ port: 0, development: true, routes: { "/": home } });
          writeFileSync("port", String(globalThis.server.port));
          console.log("api", api);
        `,
      });
      const cwd = String(dir);
      await using proc = run(200, cwd, ["--hot", "--no-clear-screen", "server.js"]);
      await proc.stdout("api 1\n");
      const origin = `http://127.0.0.1:${readFileSync(join(cwd, "port"), "utf8")}/`;
      // One save can reach the dev server as two builds, so this waits for the value and not for a log line.
      const bundled = async (needle: string) => {
        for (;;) {
          const html = await (await fetch(origin)).text();
          const script = await (await fetch(new URL(/src="([^"]+)"/.exec(html)![1], origin))).text();
          if (script.includes(needle)) return;
        }
      };
      await bundled("dep-1");
      overwrite(join(cwd, "web", "dep.js"), `export const value = "dep-2";`);
      await bundled("dep-2");
      // The second save finds the module watched again after its first reload.
      for (const round of [2, 3]) {
        overwrite(join(cwd, "api.js"), `export const api = ${round};`);
        await proc.stdout(`api ${round}\n`);
      }
      overwrite(join(cwd, "web", "dep.js"), `export const value = "dep-3";`);
      await bundled("dep-3");
    },
    timeout,
  );
});
