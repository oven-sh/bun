// An LD_PRELOAD shim injects ENOMEM into the shell's stdout/stderr pipe setup
// so the error surfaces synchronously from inside ShellSubprocess::spawn_async.
// Two faults are covered, both of which used to free live objects out from
// under the still-running spawn call:
//
// 1. recv() fails: the eager read_all errors, Cmd::buffered_output_close
//    handed back a runnable Yield, and the trampoline reached Cmd::deinit,
//    freeing the ShellSubprocess the spawn frame still held:
//      AddressSanitizer: heap-use-after-free (READ)
//        Readable::start_pipe_reader            shell/subproc.rs:1247
//        ShellSubprocess::spawn_maybe_sync_impl shell/subproc.rs:888
//      freed by: Cmd::deinit <- Interpreter::deinit_node
//                <- PipeReader::run_yield_with <- PipeReader::on_reader_error
//
// 2. epoll_ctl() fails: register_poll inside PipeReader::start fires
//    on_reader_error, whose close_io drops the Readable::Pipe slot's Arc, and
//    start() then kept dereferencing the freed PipeReader:
//      AddressSanitizer: heap-use-after-free (READ)
//        PollOrFd::get_poll                     io/pipes.rs:41
//        PipeReader::start                      shell/subproc.rs:2015
//        Readable::start_pipe_reader            shell/subproc.rs:1254
//      freed by: Arc<PipeReader> drop (the on_reader_error guard)
//
// The command must instead finish cleanly with the syscall errno as its exit
// code (ENOMEM = 12 on Linux).
import { afterAll, beforeAll, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, tempDir } from "harness";
import { join } from "node:path";

const cc = Bun.which("cc") || Bun.which("gcc") || Bun.which("clang");

// SHELL_FAIL_RECV=1 makes every recv fail with ENOMEM. SHELL_FAIL_EPOLL=1
// makes every epoll_ctl ADD/MOD on a pipe-like fd fail with ENOMEM. Bun's
// spawn "pipes" are AF_UNIX socketpairs on Linux and FilePoll registers them
// through the raw syscall(SYS_epoll_ctl, ...) wrapper, not the libc epoll_ctl
// symbol, so syscall(2) is what the epoll mode interposes.
const SHIM_C = /* c */ `
#define _GNU_SOURCE
#include <dlfcn.h>
#include <errno.h>
#include <stdarg.h>
#include <stdlib.h>
#include <sys/epoll.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/syscall.h>
#include <sys/types.h>
#include <unistd.h>

static ssize_t (*real_recv)(int, void *, size_t, int);
static long (*real_syscall)(long, long, long, long, long, long, long);
static int fail_recv = -1;
static int fail_epoll = -1;

static void init_modes(void) {
  if (fail_recv < 0) fail_recv = getenv("SHELL_FAIL_RECV") != NULL;
  if (fail_epoll < 0) fail_epoll = getenv("SHELL_FAIL_EPOLL") != NULL;
}

static int is_pipe_like(int fd) {
  struct stat st;
  if (fstat(fd, &st) != 0) return 0;
  if (S_ISFIFO(st.st_mode)) return 1;
  if (S_ISSOCK(st.st_mode)) {
    int domain = 0;
    socklen_t len = sizeof(domain);
    if (getsockopt(fd, SOL_SOCKET, SO_DOMAIN, &domain, &len) == 0 && domain == AF_UNIX) return 1;
  }
  return 0;
}

ssize_t recv(int fd, void *buf, size_t len, int flags) {
  if (!real_recv) {
    real_recv = (ssize_t (*)(int, void *, size_t, int))dlsym(RTLD_NEXT, "recv");
    init_modes();
  }
  if (fail_recv) {
    errno = ENOMEM;
    return -1;
  }
  return real_recv(fd, buf, len, flags);
}

long syscall(long number, ...) {
  va_list ap;
  long a, b, c, d, e, f;
  va_start(ap, number);
  a = va_arg(ap, long);
  b = va_arg(ap, long);
  c = va_arg(ap, long);
  d = va_arg(ap, long);
  e = va_arg(ap, long);
  f = va_arg(ap, long);
  va_end(ap);
  if (!real_syscall) {
    real_syscall = (long (*)(long, long, long, long, long, long, long))dlsym(RTLD_NEXT, "syscall");
    init_modes();
  }
  if (number == SYS_epoll_ctl && fail_epoll) {
    int op = (int)b;
    if ((op == EPOLL_CTL_ADD || op == EPOLL_CTL_MOD) && is_pipe_like((int)c)) {
      errno = ENOMEM;
      return -1;
    }
  }
  return real_syscall(number, a, b, c, d, e, f);
}
`;

// stderr is redirected away from the capture pipe, so the faulted stdout
// stream is the last open one: closing it finishes the Cmd from inside spawn.
const STDOUT_ONLY_FIXTURE = /* js */ `
import { $ } from "bun";
const r = await $\`head -c 64 /dev/zero 2> /dev/null\`.nothrow();
console.log(JSON.stringify({ exitCode: r.exitCode }));
`;

// Both stdout and stderr are capture pipes; the stderr fault (raised from
// inside spawn_async's own stack frame) is the one that finishes the Cmd.
const BOTH_PIPES_FIXTURE = /* js */ `
import { $ } from "bun";
const r = await $\`head -c 64 /dev/zero\`.nothrow();
console.log(JSON.stringify({ exitCode: r.exitCode }));
`;

let shimPath: string;
let dir: ReturnType<typeof tempDir> | undefined;

beforeAll(async () => {
  if (!isLinux || !cc) return;
  dir = tempDir("shell-pipe-read-fault", {
    "shim.c": SHIM_C,
    "stdout-only.js": STDOUT_ONLY_FIXTURE,
    "both-pipes.js": BOTH_PIPES_FIXTURE,
  });
  shimPath = join(String(dir), "shim.so");
  await using ccProc = Bun.spawn({
    cmd: [cc, "-shared", "-fPIC", "-o", shimPath, join(String(dir), "shim.c"), "-ldl"],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [ccOut, ccErr, ccExit] = await Promise.all([ccProc.stdout.text(), ccProc.stderr.text(), ccProc.exited]);
  if (ccExit !== 0) {
    throw new Error(`shim compile failed: ${ccErr || ccOut}`);
  }
});

afterAll(() => {
  dir?.[Symbol.dispose]();
});

async function runWithShim(script: string, mode: "SHELL_FAIL_RECV" | "SHELL_FAIL_EPOLL") {
  const existing = bunEnv.LD_PRELOAD;
  await using proc = Bun.spawn({
    cmd: [bunExe(), script],
    cwd: String(dir),
    env: {
      ...bunEnv,
      LD_PRELOAD: existing ? `${shimPath}:${existing}` : shimPath,
      [mode]: "1",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

// The shell surfaces the failed syscall's errno as the command's exit code.
const ENOMEM = 12;

function lastJsonLine(stdout: string, stderr: string) {
  const line = stdout.trim().split("\n").pop() ?? "";
  expect({ stderr, line }).toEqual({ stderr: expect.any(String), line: expect.stringContaining("{") });
  return JSON.parse(line);
}

test.concurrent.skipIf(!isLinux || !cc)(
  "shell survives a synchronous stdout pipe read error during spawn",
  async () => {
    const { stdout, stderr, exitCode } = await runWithShim("stdout-only.js", "SHELL_FAIL_RECV");
    expect(lastJsonLine(stdout, stderr)).toEqual({ exitCode: ENOMEM });
    expect(exitCode).toBe(0);
  },
);

test.concurrent.skipIf(!isLinux || !cc)(
  "shell survives synchronous stdout and stderr pipe read errors during spawn",
  async () => {
    const { stdout, stderr, exitCode } = await runWithShim("both-pipes.js", "SHELL_FAIL_RECV");
    expect(lastJsonLine(stdout, stderr)).toEqual({ exitCode: ENOMEM });
    expect(exitCode).toBe(0);
  },
);

test.concurrent.skipIf(!isLinux || !cc)(
  "shell survives a synchronous epoll_ctl failure registering the stdout pipe",
  async () => {
    const { stdout, stderr, exitCode } = await runWithShim("stdout-only.js", "SHELL_FAIL_EPOLL");
    expect(lastJsonLine(stdout, stderr)).toEqual({ exitCode: ENOMEM });
    expect(exitCode).toBe(0);
  },
);

test.concurrent.skipIf(!isLinux || !cc)(
  "shell survives synchronous epoll_ctl failures registering both pipes",
  async () => {
    const { stdout, stderr, exitCode } = await runWithShim("both-pipes.js", "SHELL_FAIL_EPOLL");
    expect(lastJsonLine(stdout, stderr)).toEqual({ exitCode: ENOMEM });
    expect(exitCode).toBe(0);
  },
);
