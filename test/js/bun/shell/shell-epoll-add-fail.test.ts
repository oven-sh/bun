// An LD_PRELOAD shim makes epoll_ctl(EPOLL_CTL_ADD) fail with ENOSPC (what the
// kernel returns when fs.epoll.max_user_watches is exhausted) for the AF_UNIX
// SOCK_STREAM socketpair read ends Bun Shell registers for a spawned command's
// captured stdout/stderr.
//
// Before the fix this is a heap-use-after-free: PosixBufferedReader::start()
// reports the registration failure by synchronously firing on_reader_error,
// which drops the last Arc<PipeReader> strong ref (via on_close_io) while the
// PipeReader::start / Readable::start_pipe_reader call that owns it is still
// executing. Same LD_PRELOAD pattern as serve-epoll-add-fail.test.ts, except
// Bun issues epoll_ctl as a raw syscall(SYS_epoll_ctl, ...), so the shim has
// to interpose syscall() rather than epoll_ctl().
import { afterAll, beforeAll, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, tempDir } from "harness";
import { join } from "node:path";

const cc = Bun.which("cc") || Bun.which("gcc") || Bun.which("clang");

// Only non-listening AF_UNIX SOCK_STREAM fds above the standard streams are
// failed, so Bun's own startup registrations (eventfd/timerfd/pidfd) are
// unaffected; the only matching fds in these fixtures are the socketpair read
// ends Bun Shell holds for the spawned command's stdout/stderr.
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
#include <unistd.h>

static long (*real_syscall)(long, long, long, long, long, long, long);
static int (*real_epoll_ctl)(int, int, int, struct epoll_event *);
static int enabled = -1;

static void shim_init(void) {
    real_syscall = (long (*)(long, long, long, long, long, long, long)) dlsym(RTLD_NEXT, "syscall");
    real_epoll_ctl = (int (*)(int, int, int, struct epoll_event *)) dlsym(RTLD_NEXT, "epoll_ctl");
    enabled = getenv("FAIL_SHELL_EPOLL_ADD") != NULL;
}

static int should_fail(int fd) {
    struct stat st;
    int domain = 0, type = 0, acceptconn = 0;
    socklen_t len = sizeof(int);
    if (!enabled || fd <= 2) return 0;
    if (fstat(fd, &st) != 0 || !S_ISSOCK(st.st_mode)) return 0;
    if (getsockopt(fd, SOL_SOCKET, SO_DOMAIN, &domain, &len) != 0) return 0;
    len = sizeof(int);
    if (getsockopt(fd, SOL_SOCKET, SO_TYPE, &type, &len) != 0) return 0;
    len = sizeof(int);
    getsockopt(fd, SOL_SOCKET, SO_ACCEPTCONN, &acceptconn, &len);
    return domain == AF_UNIX && type == SOCK_STREAM && !acceptconn;
}

long syscall(long number, ...) {
    if (!real_syscall) shim_init();
    va_list ap;
    va_start(ap, number);
    long a = va_arg(ap, long), b = va_arg(ap, long), c = va_arg(ap, long);
    long d = va_arg(ap, long), e = va_arg(ap, long), f = va_arg(ap, long);
    va_end(ap);
    if (number == SYS_epoll_ctl && (int) b == EPOLL_CTL_ADD && should_fail((int) c)) {
        errno = ENOSPC;
        return -1;
    }
    return real_syscall(number, a, b, c, d, e, f);
}

int epoll_ctl(int epfd, int op, int fd, struct epoll_event *event) {
    if (!real_epoll_ctl) shim_init();
    if (op == EPOLL_CTL_ADD && should_fail(fd)) {
        errno = ENOSPC;
        return -1;
    }
    return real_epoll_ctl(epfd, op, fd, event);
}
`;

// A single external (non-builtin) command with captured stdout/stderr is
// enough: starting either PipeReader performs the EPOLL_CTL_ADD that fails.
const SINGLE_FIXTURE = /* js */ `
import { $ } from "bun";
const r = await $\`head -c 16 \${process.argv[2]}\`.quiet().nothrow();
console.log(JSON.stringify({ done: true, exitCode: r.exitCode }));
`;

// The fuzzer reproduction shape: an external-command pipeline, repeated, so
// both sides of the pipe go through start_pipe_reader on every iteration.
const PIPELINE_FIXTURE = /* js */ `
import { $ } from "bun";
const file = process.argv[2];
for (let i = 0; i < 8; i++) {
  await $\`head -c 256 \${file} | head -c 16\`.quiet().nothrow();
}
console.log(JSON.stringify({ done: true }));
`;

let shimPath: string;
let dir: ReturnType<typeof tempDir> | undefined;

beforeAll(async () => {
  if (!isLinux || !cc) return;
  dir = tempDir("shell-epoll-add-fail", {
    "shim.c": SHIM_C,
    "single.js": SINGLE_FIXTURE,
    "pipeline.js": PIPELINE_FIXTURE,
    "input.txt": Buffer.alloc(2048, "y").toString(),
  });
  shimPath = join(String(dir), "shim.so");
  await using ccProc = Bun.spawn({
    cmd: [cc, "-shared", "-fPIC", "-o", shimPath, join(String(dir), "shim.c"), "-ldl"],
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });
  const [ccOut, ccErr, ccExit] = await Promise.all([ccProc.stdout.text(), ccProc.stderr.text(), ccProc.exited]);
  if (ccExit !== 0) {
    throw new Error(`shim compile failed: ${ccErr || ccOut}`);
  }
});

afterAll(() => {
  dir?.[Symbol.dispose]();
});

async function runWithShim(script: string) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), script, join(String(dir), "input.txt")],
    cwd: String(dir),
    env: {
      ...bunEnv,
      LD_PRELOAD: bunEnv.LD_PRELOAD ? `${shimPath}:${bunEnv.LD_PRELOAD}` : shimPath,
      FAIL_SHELL_EPOLL_ADD: "1",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode, signalCode: proc.signalCode };
}

test.skipIf(!isLinux || !cc)(
  "Bun Shell survives epoll_ctl(EPOLL_CTL_ADD) failing for a spawned command's output pipe",
  async () => {
    const { stdout, stderr, exitCode, signalCode } = await runWithShim("single.js");
    const line = stdout.trim().split("\n").pop() ?? "";
    // stderr is included so an ASAN report / panic shows up in the failure message.
    expect({ stderr, line }).toEqual({ stderr: expect.any(String), line: expect.stringContaining("{") });
    expect(JSON.parse(line)).toEqual({ done: true, exitCode: expect.any(Number) });
    expect(signalCode).toBeNull();
    expect(exitCode).toBe(0);
  },
);

test.skipIf(!isLinux || !cc)(
  "Bun Shell survives epoll_ctl(EPOLL_CTL_ADD) failing inside a repeated external-command pipeline",
  async () => {
    const { stdout, stderr, exitCode, signalCode } = await runWithShim("pipeline.js");
    const line = stdout.trim().split("\n").pop() ?? "";
    expect({ stderr, line }).toEqual({ stderr: expect.any(String), line: expect.stringContaining("{") });
    expect(JSON.parse(line)).toEqual({ done: true });
    expect(signalCode).toBeNull();
    expect(exitCode).toBe(0);
  },
);
