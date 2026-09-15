import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isDebug, isLinux, isWindows, tempDir } from "harness";
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
// The fix routes the reader's start() error through on_reader_error
// (matching what POSIX already does for register_poll failure), so the pipe is
// torn down and detached from the Subprocess before the exit callback runs.
//
// Triggering a real read-start failure on a freshly-spawned stdio pipe is
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
        // The injection point sits in start_with_source(), which the Windows
        // start() path reaches for the stdout pipe before the stderr pipe.
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
const cc = Bun.which("cc") || Bun.which("gcc") || Bun.which("clang");

const SHIM_C = /* c */ `
#define _GNU_SOURCE
#include <dlfcn.h>
#include <errno.h>
#include <stdarg.h>
#include <stdlib.h>
#include <string.h>
#include <sys/epoll.h>
#include <sys/ioctl.h>
#include <sys/syscall.h>

static long (*real_syscall)(long, ...);
static int writer_mods;

static int should_fail(long op, int fd, struct epoll_event *event) {
  if (!event) return 0;
  const char *mode = getenv("FAIL_EPOLL_CTL");
  if (!mode) return op == EPOLL_CTL_ADD && (event->events & EPOLLOUT);
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
`;

// The argument selects what to construct; the report is the error it threw
// plus how many fds and Subprocess/Terminal wrappers outlive it, relative to a
// baseline taken just before. Both classes create their prototype (which
// heapStats counts under the class name) lazily, so the baseline is taken
// after materializing it. Releases that happen asynchronously (the child's
// pidfd once its exit is reaped, a wrapper that becomes collectable only then)
// get a bounded window; whatever is still there when it lapses is reported.
const FIXTURE = /* js */ `
import { readdirSync } from "node:fs";
import { heapStats } from "bun:jsc";
const kind = process.argv[2];
const openFds = () => readdirSync("/proc/self/fd").length;
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
try {
  switch (kind) {
    case "stdin-pipe":
      Bun.spawn({ cmd: ["true"], stdin: "pipe", stdout: "ignore", stderr: "ignore" });
      break;
    case "stdin-buffer":
      Bun.spawn({ cmd: ["true"], stdin: Buffer.from("data"), stdout: "ignore", stderr: "ignore" });
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
const deadline = performance.now() + 2000;
while ((openFds() > fdBaseline || wrappers() > wrapperBaseline) && performance.now() < deadline) {
  Bun.gc(true);
  await Bun.sleep(5);
}
console.log(JSON.stringify({ error, write, leakedFds: openFds() - fdBaseline, leakedWrappers: wrappers() - wrapperBaseline }));
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
        // The spawn bindings report a failed stdin setup generically, so only
        // the fact that it threw is pinned down here.
        report: { error: { message: expect.any(String) }, leakedFds: 0, leakedWrappers: 0 },
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

    test.concurrent("new Bun.Terminal() closes the pty fds exactly once", async () => {
      expect(await runFixture("terminal")).toEqual({
        report: { error: { message: "Failed to start terminal writer" }, leakedFds: 0, leakedWrappers: 0 },
        stderr: "",
        exitCode: 0,
      });
    });
  },
);

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
