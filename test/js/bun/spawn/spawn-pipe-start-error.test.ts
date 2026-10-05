import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isDebug, isLinux, isWindows, tempDir } from "harness";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// On Windows, when the initial uv_read_start on a subprocess stdout/stderr
// pipe fails (observed from libuv as UV_EINVAL after a bad FileAccessInformation
// query on the pipe handle), SubprocessPipeReader::start() returned the Err
// straight from start_with_current_pipe(). The caller in the spawn bindings
// then threw and returned without tearing down either pipe: stdout still had
// the extra ref from the top of start(), and stderr had never been start()ed
// at all (refcount 1, process backref set, live uv.Pipe source).
//
// When the killed child's exit callback later fired, on_process_exit resumed
// reads on both pipes; the EOF that arrived on the unstarted stderr reached
// on_reader_done, whose trailing deref assumes the matching start() ref exists,
// so it dereferenced a freed PipeReader. Debug builds hit the RefCount
// MAGIC_VALID assert; release builds wrote through freed memory, which in
// practice manifested as a process stuck idle with no error and no exit.
//
// The fix routes the start_with_current_pipe() error through on_reader_error
// (matching what POSIX already does for register_poll failure), so the pipe is
// torn down and detached from the Subprocess before the exit callback runs.
//
// Triggering a real uv_read_start failure on a freshly-spawned stdio pipe is
// not possible from JS, so this uses a debug-only fault-injection env var.

test.skipIf(!isWindows || !isDebug)(
  "spawn: a failed stdio pipe start is torn down instead of leaving a dangling sibling reader (windows)",
  async () => {
    const fixture = `
try {
  const p = Bun.spawn({
    cmd: [process.execPath, "-e", "1"],
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, BUN_INTERNAL_FAIL_PIPE_READER_START: undefined },
  });
  await p.exited;
  process.stderr.write("OK\\n");
} catch (e) {
  // Before the fix the spawn threw here; printing lets the assertion below
  // name the exact error code when the post-throw crash is the real failure.
  process.stderr.write("THREW " + (e?.code ?? e?.message) + "\\n");
}
`;

    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", fixture],
      env: {
        ...bunEnv,
        // The injection point sits in start_with_current_pipe(), which is the
        // first call the non-lazy Windows start() path makes on the stdout pipe.
        BUN_INTERNAL_FAIL_PIPE_READER_START: "1",
      },
      stdout: "inherit",
      stderr: "pipe",
    });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

    // Without the fix stderr is "THREW EINVAL" followed by the RefCount
    // MAGIC_VALID debug panic, and exitCode is the debug crash handler's.
    expect(stderr.trim()).toBe("OK");
    expect(exitCode).toBe(0);
  },
);

// POSIX counterpart for the writers. When a pipe writer's start() fails to
// register its fd with the event loop, the writer no longer holds the fd and
// the caller that opened it closes it: the subprocess stdin FileSink
// (Writable::init), the buffered stdin StaticPipeWriter, and Bun.Terminal's
// pty writer each do so on their own error path. Each fixture provokes that
// failure and checks that the fd is closed exactly once (an fd left open shows
// up in /proc/self/fd, a second close of the same number trips the debug
// build's EBADF assertion on stderr) and that the object whose writer failed
// is still released: with nothing left to close, the writer never reports
// on_close, so the owner has to retire it on the error path itself, or a
// buffer stdin keeps its Subprocess wrapper alive as pending activity forever.
//
// Bun registers FilePolls through syscall(SYS_epoll_ctl, ...) rather than the
// epoll_ctl() wrapper, so the shim interposes syscall() and fails every
// EPOLL_CTL_ADD asking for writability with ENOSPC (what an exhausted
// fs.epoll.max_user_watches returns). Readable registrations, and uSockets,
// which uses the wrapper, are unaffected.
//
// FAIL_EPOLL_CTL=pty-reader-add or pty-reader-mod fails one readable
// registration of a pty master instead, and nothing else: the EPOLL_CTL_ADD
// that Bun.Terminal's reader makes when it starts, or the EPOLL_CTL_MOD that
// re-arms it after the first read. The kernel fails the ADD when watches or
// memory run out. It does not fail the MOD that way: that mode only stands in
// for any error that ends the reader during the constructor's first read.
//
// FAIL_EPOLL_CTL=pty-writer-mod fails a writable EPOLL_CTL_MOD of a pty master
// and nothing else: the re-arm that Bun.Terminal's writer makes from write()
// once it has bytes queued. FAIL_EPOLL_CTL_SKIP=n lets the first n of them
// through. The kernel does not fail that MOD either. The mode stands in for
// any error that ends the writer inside write(), such as EBADF after other
// code closed the writer's fd by number.
//
// FAIL_EPOLL_CTL=pidfd-add fails the EPOLL_CTL_ADD of a pidfd and nothing else:
// the registration that reports a child's exit. FAIL_EPOLL_CTL_SKIP=n lets the
// first n of them through. FAIL_EPOLL_CTL=pidfd-and-writer-add fails those and
// what no mode fails, which is nearer to what running out of watches does.
//
// FAIL_SIGKILL=1 refuses every kill(pid, SIGKILL) with EPERM, which is what the
// kernel answers for a child that runs as another user by now (sudo, su).
const cc = Bun.which("cc") || Bun.which("gcc") || Bun.which("clang");

const SHIM_C = /* c */ `
#define _GNU_SOURCE
#include <dlfcn.h>
#include <errno.h>
#include <signal.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/epoll.h>
#include <sys/ioctl.h>
#include <sys/syscall.h>
#include <unistd.h>

static long (*real_syscall)(long, ...);
static int writer_mods;
static int pidfd_adds;

static int is_pidfd(int fd) {
  char path[32], target[32];
  snprintf(path, sizeof(path), "/proc/self/fd/%d", fd);
  ssize_t length = readlink(path, target, sizeof(target) - 1);
  if (length < 0) return 0;
  target[length] = 0;
  return strstr(target, "pidfd") != NULL;
}

static int should_fail(long op, int fd, struct epoll_event *event) {
  if (!event) return 0;
  const char *mode = getenv("FAIL_EPOLL_CTL");
  if (!mode) return op == EPOLL_CTL_ADD && (event->events & EPOLLOUT);
  int writers_too = strcmp(mode, "pidfd-and-writer-add") == 0;
  if (writers_too && op == EPOLL_CTL_ADD && (event->events & EPOLLOUT)) return 1;
  if (writers_too || strcmp(mode, "pidfd-add") == 0) {
    if (op != EPOLL_CTL_ADD || !is_pidfd(fd)) return 0;
    const char *skip = getenv("FAIL_EPOLL_CTL_SKIP");
    return pidfd_adds++ >= (skip ? atoi(skip) : 0);
  }
  // TIOCGPTN succeeds on a pty master only.
  unsigned int pty_number;
  if (strcmp(mode, "pty-writer-mod") == 0) {
    if (op != EPOLL_CTL_MOD || !(event->events & EPOLLOUT) || ioctl(fd, TIOCGPTN, &pty_number) != 0) return 0;
    const char *skip = getenv("FAIL_EPOLL_CTL_SKIP");
    return writer_mods++ >= (skip ? atoi(skip) : 0);
  }
  long failing_op = strcmp(mode, "pty-reader-add") == 0 ? EPOLL_CTL_ADD : EPOLL_CTL_MOD;
  return op == failing_op && (event->events & EPOLLIN) && ioctl(fd, TIOCGPTN, &pty_number) == 0;
}

long syscall(long number, ...) {
  va_list ap;
  va_start(ap, number);
  long a1 = va_arg(ap, long), a2 = va_arg(ap, long), a3 = va_arg(ap, long);
  long a4 = va_arg(ap, long), a5 = va_arg(ap, long), a6 = va_arg(ap, long);
  va_end(ap);
  if (number == SYS_epoll_ctl && should_fail(a2, (int)a3, (struct epoll_event *)a4)) {
    errno = ENOSPC;
    return -1;
  }
  if (!real_syscall) real_syscall = (long (*)(long, ...))dlsym(RTLD_NEXT, "syscall");
  return real_syscall(number, a1, a2, a3, a4, a5, a6);
}

int kill(pid_t pid, int signal) {
  static int (*real_kill)(pid_t, int);
  if (signal == SIGKILL && getenv("FAIL_SIGKILL")) {
    errno = EPERM;
    return -1;
  }
  if (!real_kill) real_kill = (int (*)(pid_t, int))dlsym(RTLD_NEXT, "kill");
  return real_kill(pid, signal);
}
`;

// The argument selects what to construct; the report is the error it threw
// plus how many fds and Subprocess/Terminal wrappers outlive it, relative to a
// baseline taken just before. Both classes create their prototype (which
// heapStats counts under the class name) lazily, so the baseline is taken
// after materializing it. Releases that happen asynchronously (the child's
// pidfd once its exit is reaped, a wrapper that becomes collectable only then)
// get a bounded window; whatever is still there when it lapses is reported.
const FIXTURE = /* js */ `
import { readdirSync, readFileSync } from "node:fs";
import { heapStats } from "bun:jsc";
const kind = process.argv[2];
const openFds = () => readdirSync("/proc/self/fd").length;
// Running or zombie. The kernel lists them per spawning thread, which is this one, unless it was built without
// CONFIG_PROC_CHILDREN. Then every process is asked for its parent, the field after its parenthesized name and state.
const children = () => {
  try {
    return readFileSync("/proc/self/task/" + process.pid + "/children", "utf8").split(" ").filter(Boolean);
  } catch {}
  return readdirSync("/proc").filter(pid => {
    if (!/^\\d+$/.test(pid)) return false;
    try {
      const stat = readFileSync("/proc/" + pid + "/stat", "utf8");
      return stat.slice(stat.lastIndexOf(")") + 2).split(" ")[1] === String(process.pid);
    } catch {
      return false;
    }
  });
};
const wrappers = () => {
  const counts = heapStats().objectTypeCounts;
  return (counts.Subprocess ?? 0) + (counts.Terminal ?? 0);
};

// Parked on globalThis so the baseline keeps counting it: a local that is never
// read again is not kept alive across the awaits below.
globalThis.anchor = [];
if (kind.includes("terminal")) {
  globalThis.anchor.push(Bun.Terminal.prototype);
}
if (kind !== "terminal") {
  const child = Bun.spawn({ cmd: ["true"], stdin: "ignore", stdout: "ignore", stderr: "ignore" });
  globalThis.anchor.push(child);
  await child.exited;
}
// The first spawnSync of a process creates the loop it waits on, which stays. Without pipes: theirs are closed on
// the work pool, some time after the call.
const quiet = { cmd: ["true"], stdin: "ignore", stdout: "ignore", stderr: "ignore" };
if (kind.includes("unwatchable") || kind.startsWith("sync-") || kind.endsWith("-running")) Bun.spawnSync(quiet);
const fdBaseline = openFds();
const wrapperBaseline = wrappers();

// The terminal is reachable only from this call, so once it returns nothing
// but the terminal's own root on its wrapper can keep it.
function writeToTerminal(writes) {
  const seen = { closed: null, drains: 0 };
  const terminal = new Bun.Terminal({ data() {}, exit() {}, drain() { seen.drains++; } });
  for (let i = 0; i < writes; i++) terminal.write("x");
  seen.closed = terminal.closed;
  return seen;
}

let error = null;
let write;
let sync;
let onExit;
let shell;
try {
  switch (kind) {
    case "stdin-pipe":
      Bun.spawn({ cmd: ["true"], stdin: "pipe", stdout: "ignore", stderr: "ignore" });
      break;
    case "stdin-pipe-running":
      Bun.spawn({ cmd: ["sleep", "1000"], stdin: "pipe", stdout: "ignore", stderr: "ignore" });
      break;
    case "stdin-buffer":
      Bun.spawn({ cmd: ["true"], stdin: Buffer.from("data"), stdout: "ignore", stderr: "ignore" });
      break;
    case "stdin-buffer-running":
      // Nobody dies of SIGURG.
      Bun.spawn({
        cmd: ["sleep", "1000"],
        stdin: Buffer.from("data"),
        stdout: "ignore",
        stderr: "ignore",
        killSignal: "SIGURG",
      });
      break;
    case "sync-stdin-buffer":
      // The child outlives the call unless the call ends it.
      Bun.spawnSync({ cmd: ["sleep", "1000"], stdin: Buffer.from("data"), stdout: "pipe", stderr: "pipe" });
      break;
    // Each of these children outlives the call unless the call ends it, however late the call gets to watching it.
    case "unwatchable":
      await Bun.spawn({ cmd: ["sleep", "1000"], stdin: "ignore", stdout: "ignore", stderr: "ignore" }).exited;
      break;
    case "unwatchable-stdin-buffer":
      onExit = 0;
      Bun.spawn({
        cmd: ["sleep", "1000"],
        stdin: Buffer.from("data"),
        stdout: "pipe",
        stderr: "pipe",
        onExit() {
          onExit++;
        },
      });
      break;
    case "shell-unwatchable":
      shell = (await Bun.$\`sleep 1000\`.nothrow().quiet()).exitCode;
      break;
    case "shell-stdin-buffer-running":
      shell = (await Bun.$\`sleep 1000 < \${Buffer.from("data")}\`.nothrow().quiet()).exitCode;
      break;
    case "sync-unwatchable-stdin":
      // More than its pipes hold, so that it is still being written.
      Bun.spawnSync({ cmd: ["cat"], stdin: Buffer.alloc(4_000_000), stdout: "pipe", stderr: "pipe" });
      break;
    case "sync-unwatchable-output":
      // More than a pipe holds.
      Bun.spawnSync({ cmd: ["sh", "-c", "head -c 1000000 /dev/zero; exec sleep 1000"], stdout: "pipe", stderr: "pipe" });
      break;
    case "sync-unwatchable-timeout":
      Bun.spawnSync({ cmd: ["sleep", "1000"], stdin: "ignore", stdout: "ignore", stderr: "ignore", timeout: 1 });
      break;
    case "terminal":
      new Bun.Terminal({});
      break;
    case "spawn-terminal":
      Bun.spawn({ cmd: ["true"], terminal: {} });
      break;
    case "terminal-write":
      write = writeToTerminal(1);
      break;
    case "terminal-write-twice":
      write = writeToTerminal(2);
      break;
  }
} catch (e) {
  error = { code: e.code, message: e.message };
}
if (kind === "sync-stdin-buffer") {
  // Read before anything else runs: spawnSync has no later moment to clean up in.
  sync = {
    children: children().length,
    next: Bun.spawnSync({ cmd: ["echo", "next"], stderr: "pipe" }).stdout.toString(),
  };
} else if (kind === "stdin-buffer-running") {
  // This one is watched, so the event loop is what reaps it.
  const deadline = performance.now() + 2000;
  while (children().length > 0 && performance.now() < deadline) await Bun.sleep(5);
  sync = { children: children().length, next: Bun.spawnSync(quiet).exitCode };
} else if (kind.includes("unwatchable") || kind.endsWith("-running")) {
  // A call without pipes or a timeout waits for its child without registering it.
  sync = { children: children().length, next: Bun.spawnSync(quiet).exitCode };
}
// What the call left behind. FAIL_SIGKILL=1 goes for this too.
for (const pid of children()) process.kill(Number(pid), process.env.FAIL_SIGKILL ? "SIGTERM" : "SIGKILL");
const deadline = performance.now() + 2000;
while ((openFds() > fdBaseline || wrappers() > wrapperBaseline) && performance.now() < deadline) {
  Bun.gc(true);
  await Bun.sleep(5);
}
console.log(JSON.stringify({ error, write, sync, onExit, shell, leakedFds: openFds() - fdBaseline, leakedWrappers: wrappers() - wrapperBaseline }));
`;

let dir: ReturnType<typeof tempDir> | undefined;

beforeAll(async () => {
  if (!isLinux || !cc) return;
  dir = tempDir("poll-start-error", { "shim.c": SHIM_C, "fixture.js": FIXTURE });
  await using ccProc = Bun.spawn({
    cmd: [cc, "-shared", "-fPIC", "-o", join(String(dir), "shim.so"), join(String(dir), "shim.c"), "-ldl"],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [ccOut, ccErr, ccExit] = await Promise.all([ccProc.stdout.text(), ccProc.stderr.text(), ccProc.exited]);
  if (ccExit !== 0) throw new Error(`shim compile failed: ${ccErr || ccOut}`);
});

afterAll(() => {
  dir?.[Symbol.dispose]();
});

async function runFixture(kind: string, env: Record<string, string> = {}) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "fixture.js", kind],
    cwd: String(dir),
    env: { ...bunEnv, ...env, LD_PRELOAD: join(String(dir), "shim.so") },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  let report: unknown = stdout;
  try {
    report = JSON.parse(stdout);
  } catch {}
  return { report, stderr, exitCode };
}

describe.skipIf(!isLinux || !cc)(
  "a pipe writer whose event loop registration fails leaves its fd to the caller",
  () => {
    test.concurrent("Bun.spawn with stdin: 'pipe' closes the stdin pipe exactly once", async () => {
      expect(await runFixture("stdin-pipe")).toEqual({
        report: {
          error: { code: "ENOSPC", message: "ENOSPC: no space left on device, epoll_ctl" },
          leakedFds: 0,
          leakedWrappers: 0,
        },
        stderr: "",
        exitCode: 0,
      });
    });

    test.concurrent("Bun.spawn with stdin: 'pipe' ends its child", async () => {
      expect(await runFixture("stdin-pipe-running")).toEqual({
        report: {
          error: { code: "ENOSPC", message: "ENOSPC: no space left on device, epoll_ctl" },
          sync: { children: 0, next: 0 },
          leakedFds: 0,
          leakedWrappers: 0,
        },
        stderr: "",
        exitCode: 0,
      });
    });

    test.concurrent(
      "Bun.spawn with a buffer stdin closes the stdin pipe exactly once and releases the Subprocess",
      async () => {
        // On Linux a buffer stdin normally travels through a memfd and never gets
        // a writer; disabling that takes the pipe writer path every other
        // platform uses.
        expect(await runFixture("stdin-buffer", { BUN_FEATURE_FLAG_DISABLE_MEMFD: "1" })).toEqual({
          report: {
            error: { code: "ENOSPC", message: "ENOSPC: no space left on device, epoll_ctl" },
            leakedFds: 0,
            leakedWrappers: 0,
          },
          stderr: "",
          exitCode: 0,
        });
      },
    );

    // The call throws, so nobody is handed the child to end it another way than with its killSignal.
    test.concurrent("Bun.spawn with a buffer stdin ends a child that its killSignal does not", async () => {
      expect(await runFixture("stdin-buffer-running", { BUN_FEATURE_FLAG_DISABLE_MEMFD: "1" })).toEqual({
        report: {
          error: { code: "ENOSPC", message: "ENOSPC: no space left on device, epoll_ctl" },
          sync: { children: 0, next: 0 },
          leakedFds: 0,
          leakedWrappers: 0,
        },
        stderr: "",
        exitCode: 0,
      });
    });

    // A sync Subprocess has no wrapper for the GC to finalize, and the call that made it is the only one that can reap
    // its child. What it left registered on spawnSync's loop was still there for the next call.
    test.concurrent("Bun.spawnSync with a buffer stdin ends its child and releases its pipes", async () => {
      expect(await runFixture("sync-stdin-buffer", { BUN_FEATURE_FLAG_DISABLE_MEMFD: "1" })).toEqual({
        report: {
          error: { code: "ENOSPC", message: "ENOSPC: no space left on device, epoll_ctl" },
          sync: { children: 0, next: "next\n" },
          leakedFds: 0,
          leakedWrappers: 0,
        },
        stderr: "",
        exitCode: 0,
      });
    });

    test.concurrent("new Bun.Terminal() closes the pty fds exactly once", async () => {
      expect(await runFixture("terminal")).toEqual({
        report: { error: { message: "Failed to start terminal writer" }, leakedFds: 0, leakedWrappers: 0 },
        stderr: "",
        exitCode: 0,
      });
    });
  },
);

// A child whose exit cannot be registered for was reported as exited with that error while it was still running, and
// nothing reaped it afterwards. Bun.spawnSync blocked in wait4() instead, where nothing serves the child's stdio and
// no timeout applies: a child that reads its stdin or fills a pipe never exits. Either way the child is ended now.
describe.skipIf(!isLinux || !cc)(
  "a child whose pidfd fails to register with the event loop is ended and reaped",
  () => {
    test.concurrent.each([
      ["Bun.spawn", "unwatchable"],
      ["Bun.spawnSync of a child that reads its stdin", "sync-unwatchable-stdin"],
      ["Bun.spawnSync of a child that fills its stdout", "sync-unwatchable-output"],
      ["Bun.spawnSync with a timeout", "sync-unwatchable-timeout"],
    ])("%s", async (_, kind) => {
      // The one let through is the fixture's own child, which it takes its baseline after.
      const env = { FAIL_EPOLL_CTL: "pidfd-add", FAIL_EPOLL_CTL_SKIP: "1", BUN_FEATURE_FLAG_DISABLE_MEMFD: "1" };
      expect(await runFixture(kind, env)).toEqual({
        report: {
          error: { code: "ENOSPC", message: "ENOSPC: no space left on device, epoll_ctl" },
          sync: { children: 0, next: 0 },
          leakedFds: 0,
          leakedWrappers: 0,
        },
        stderr: "",
        exitCode: 0,
      });
    });
  },
);

// Both at once. The exit was reported, which runs onExit, with the writer's error already thrown: onExit's call took the
// exception with it, and Bun.spawn returned nothing at all to a caller that went on to crash on it.
test.skipIf(!isLinux || !cc)(
  "Bun.spawn throws when neither its child's pidfd nor its stdin writer registers",
  async () => {
    const env = {
      FAIL_EPOLL_CTL: "pidfd-and-writer-add",
      FAIL_EPOLL_CTL_SKIP: "1",
      BUN_FEATURE_FLAG_DISABLE_MEMFD: "1",
    };
    expect(await runFixture("unwatchable-stdin-buffer", env)).toEqual({
      report: {
        error: { code: "ENOSPC", message: "ENOSPC: no space left on device, epoll_ctl" },
        sync: { children: 0, next: 0 },
        onExit: 1,
        leakedFds: 0,
        leakedWrappers: 0,
      },
      stderr: "",
      exitCode: 0,
    });
  },
);

// The shell did not finish a command whose exit came with an error, and left one it gave up on starting to its SIGTERM
// and unreaped.
describe.skipIf(!isLinux || !cc)("a shell command is ended, reaped and finished", () => {
  test.concurrent.each([
    ["whose pidfd fails to register", "shell-unwatchable", { FAIL_EPOLL_CTL: "pidfd-add", FAIL_EPOLL_CTL_SKIP: "1" }],
    ["whose stdin writer fails to register", "shell-stdin-buffer-running", { BUN_FEATURE_FLAG_DISABLE_MEMFD: "1" }],
  ])("%s", async (_, kind, env) => {
    expect(await runFixture(kind, env)).toEqual({
      report: { error: null, sync: { children: 0, next: 0 }, shell: 1, leakedFds: 0, leakedWrappers: 0 },
      stderr: "",
      exitCode: 0,
    });
  });
});

// The same goes for what the CLI runs: it reported the script as failed and exited, and the script ran on.
describe.skipIf(!isLinux || !cc)("a script whose pidfd fails to register with the event loop is ended", () => {
  test.concurrent.each(["run --parallel forever", "run --filter=* forever", "install"])("bun %s", async args => {
    using project = tempDir("unwatchable-script", { "watched": "" });
    // By then its parent is somebody else, so it is told by its command line.
    const watched = join(String(project), "watched");
    const forever = `exec tail -f ${watched}`;
    await Bun.write(
      join(String(project), "package.json"),
      JSON.stringify({ name: "unwatchable-script", scripts: { forever, postinstall: forever } }),
    );
    await using proc = Bun.spawn({
      cmd: [bunExe(), ...args.split(" ")],
      cwd: String(project),
      env: { ...bunEnv, FAIL_EPOLL_CTL: "pidfd-add", LD_PRELOAD: join(String(dir), "shim.so") },
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
    });
    const exitCode = await proc.exited;
    const left = readdirSync("/proc").filter(pid => {
      try {
        return /^\d+$/.test(pid) && readFileSync(`/proc/${pid}/cmdline`, "utf8").includes(watched);
      } catch {
        return false;
      }
    });
    for (const pid of left) process.kill(Number(pid), "SIGKILL");
    expect({ left: left.length, failed: exitCode !== 0 }).toEqual({ left: 0, failed: true });
  });
});

// Ending such a child takes a SIGKILL, and reaping it a wait for that to take effect. One that cannot be signalled
// would be waited for until it exits by itself, with the thread blocked or no deadline to end the wait: it is left.
describe.skipIf(!isLinux || !cc)("a child that has to be ended and cannot be signalled is not waited for", () => {
  const unwatchable = { FAIL_EPOLL_CTL: "pidfd-add", FAIL_EPOLL_CTL_SKIP: "1" };
  test.concurrent.each([
    ["Bun.spawnSync of a child whose pidfd fails to register", "sync-unwatchable-timeout", unwatchable, 0],
    ["Bun.spawnSync whose stdin writer fails to register", "sync-stdin-buffer", {}, "next\n"],
  ])("%s", async (_, kind, env, next) => {
    expect(await runFixture(kind, { ...env, FAIL_SIGKILL: "1", BUN_FEATURE_FLAG_DISABLE_MEMFD: "1" })).toEqual({
      report: {
        error: { code: "ENOSPC", message: "ENOSPC: no space left on device, epoll_ctl" },
        sync: { children: 1, next },
        leakedFds: 0,
        leakedWrappers: 0,
      },
      stderr: "",
      exitCode: 0,
    });
  });
});

// The POSIX reader reports a failed registration by calling on_reader_error
// from inside start(), and start() still returns Ok. Terminal's reader
// callbacks end by releasing the reader's ref, which the constructor used to
// take only after start() returned: the release freed the Terminal while the
// constructor was still using it. A reader that ends during the constructor's
// first read (the injected EPOLL_CTL_MOD failure) did not free early. It left
// a constructed Terminal that was already dead and could never be collected.
describe.skipIf(!isLinux || !cc)("a Bun.Terminal whose reader fails to register with the event loop", () => {
  describe.each(["pty-reader-add", "pty-reader-mod"])("FAIL_EPOLL_CTL=%s", mode => {
    test.concurrent.each([
      ["new Bun.Terminal()", "terminal"],
      ["Bun.spawn() with terminal options", "spawn-terminal"],
    ])("%s throws and releases the pty", async (_, kind) => {
      expect(await runFixture(kind, { FAIL_EPOLL_CTL: mode })).toEqual({
        report: { error: { message: "Failed to start terminal reader" }, leakedFds: 0, leakedWrappers: 0 },
        stderr: "",
        exitCode: 0,
      });
    });
  });
});

// Here the writer starts fine. The registration that fails is the re-arm that
// write() makes after it queued the byte. The writer reports the error and the
// terminal closes itself inside write(), with the byte still queued. Those
// bytes can never drain: they must not root the closed terminal's wrapper
// again, and no drain may follow the exit callback.
describe.skipIf(!isLinux || !cc)("a Bun.Terminal whose writer fails to re-arm its poll inside write()", () => {
  test.concurrent.each([
    ["the first write", "terminal-write", "0"],
    // The first write re-arms fine, so its byte is queued and its drain is
    // owed when the second one fails.
    ["a write behind queued bytes", "terminal-write-twice", "1"],
  ])("%s releases the terminal", async (_, kind, skip) => {
    expect(await runFixture(kind, { FAIL_EPOLL_CTL: "pty-writer-mod", FAIL_EPOLL_CTL_SKIP: skip })).toEqual({
      report: { error: null, write: { closed: true, drains: 0 }, leakedFds: 0, leakedWrappers: 0 },
      stderr: "",
      exitCode: 0,
    });
  });
});
