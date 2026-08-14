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
// failure and checks that the fd is closed exactly once: an fd left open shows
// up in /proc/self/fd, a second close of the same number trips the debug
// build's EBADF assertion on stderr.
//
// Bun registers FilePolls through syscall(SYS_epoll_ctl, ...) rather than the
// epoll_ctl() wrapper, so the shim interposes syscall() and fails every
// EPOLL_CTL_ADD asking for writability with ENOSPC (what an exhausted
// fs.epoll.max_user_watches returns). Readable registrations, and uSockets,
// which uses the wrapper, are unaffected.
const cc = Bun.which("cc") || Bun.which("gcc") || Bun.which("clang");

const SHIM_C = /* c */ `
#define _GNU_SOURCE
#include <dlfcn.h>
#include <errno.h>
#include <stdarg.h>
#include <sys/epoll.h>
#include <sys/syscall.h>

static long (*real_syscall)(long, ...);

long syscall(long number, ...) {
  va_list ap;
  va_start(ap, number);
  long a1 = va_arg(ap, long), a2 = va_arg(ap, long), a3 = va_arg(ap, long);
  long a4 = va_arg(ap, long), a5 = va_arg(ap, long), a6 = va_arg(ap, long);
  va_end(ap);
  if (number == SYS_epoll_ctl && a2 == EPOLL_CTL_ADD && a4 != 0 &&
      (((struct epoll_event *)a4)->events & EPOLLOUT)) {
    errno = ENOSPC;
    return -1;
  }
  if (!real_syscall) real_syscall = (long (*)(long, ...))dlsym(RTLD_NEXT, "syscall");
  return real_syscall(number, a1, a2, a3, a4, a5, a6);
}
`;

// The argument selects what to construct; the report is the error it threw
// and how many fds are still open afterwards, compared to before. Fds that
// the error path releases asynchronously (the child's pidfd once its exit is
// reaped, anything owned by a wrapper that is only released by its finalizer)
// get a bounded window to go away; a leaked fd is reported once it lapses.
const FIXTURE = /* js */ `
const fs = require("node:fs");
const openFds = () => fs.readdirSync("/proc/self/fd").length;
const before = openFds();
let error = null;
try {
  switch (process.argv[2]) {
    case "stdin-pipe":
      Bun.spawn({ cmd: ["true"], stdin: "pipe", stdout: "ignore", stderr: "ignore" });
      break;
    case "stdin-buffer":
      Bun.spawn({ cmd: ["true"], stdin: Buffer.from("data"), stdout: "ignore", stderr: "ignore" });
      break;
    case "terminal":
      new Bun.Terminal({});
      break;
  }
} catch (e) {
  error = { code: e.code, message: e.message };
}
const deadline = performance.now() + 2000;
while (openFds() > before && performance.now() < deadline) {
  Bun.gc(true);
  await Bun.sleep(5);
}
console.log(JSON.stringify({ error, leaked: openFds() - before }));
`;

describe.skipIf(!isLinux || !cc)(
  "a pipe writer whose event loop registration fails leaves its fd to the caller",
  () => {
    let dir: ReturnType<typeof tempDir>;

    beforeAll(async () => {
      dir = tempDir("writer-start-error", { "shim.c": SHIM_C, "fixture.js": FIXTURE });
      await using ccProc = Bun.spawn({
        cmd: [cc!, "-shared", "-fPIC", "-o", join(String(dir), "shim.so"), join(String(dir), "shim.c"), "-ldl"],
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

    test.concurrent("Bun.spawn with stdin: 'pipe' closes the stdin pipe exactly once", async () => {
      expect(await runFixture("stdin-pipe")).toEqual({
        // The spawn bindings report a failed stdin setup generically, so only
        // the fact that it threw is pinned down here.
        report: { error: { message: expect.any(String) }, leaked: 0 },
        stderr: "",
        exitCode: 0,
      });
    });

    test.concurrent("Bun.spawn with a buffer stdin closes the stdin pipe exactly once", async () => {
      // On Linux a buffer stdin normally travels through a memfd and never gets
      // a writer; disabling that takes the pipe writer path every other
      // platform uses.
      expect(await runFixture("stdin-buffer", { BUN_FEATURE_FLAG_DISABLE_MEMFD: "1" })).toEqual({
        report: { error: { code: "ENOSPC", message: "ENOSPC: no space left on device, epoll_ctl" }, leaked: 0 },
        stderr: "",
        exitCode: 0,
      });
    });

    test.concurrent("new Bun.Terminal() closes the pty fds exactly once", async () => {
      expect(await runFixture("terminal")).toEqual({
        report: { error: { message: "Failed to start terminal writer" }, leaked: 0 },
        stderr: "",
        exitCode: 0,
      });
    });
  },
);
