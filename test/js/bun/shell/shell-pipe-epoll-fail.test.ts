// When epoll_ctl(EPOLL_CTL_ADD/MOD) fails for a shell pipe fd (ENOMEM, the
// documented kernel failure mode under memory pressure), the PipeReader error
// callback fires synchronously inside ShellSubprocess::spawn_async. That used
// to finish the Cmd and drive the interpreter trampoline re-entrantly, freeing
// the Cmd's arena slot plus the ShellSubprocess/PipeReader while
// Cmd::transition_to_exec still held them:
//   panic: expected Node::Cmd at Node#2, got Free
//   AddressSanitizer: heap-use-after-free ... PipeReader::start subproc.rs
// The command must instead finish with the pipe error as its exit code.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, tempDir } from "harness";
import { join } from "node:path";

const cc = Bun.which("cc") || Bun.which("gcc") || Bun.which("clang");

// Bun's spawn "pipes" are AF_UNIX socketpairs on Linux and are registered via
// the raw `syscall(SYS_epoll_ctl, ...)` wrapper, so both the `epoll_ctl`
// symbol and `syscall` are interposed. Every ADD/MOD on a pipe-like fd fails
// with ENOMEM; pidfds, sockets, and everything else pass through.
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

static int (*real_epoll_ctl)(int, int, int, struct epoll_event *);
static long (*real_syscall)(long, long, long, long, long, long, long);

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

static int should_fail(int op, int fd) {
  return (op == EPOLL_CTL_ADD || op == EPOLL_CTL_MOD) && is_pipe_like(fd);
}

int epoll_ctl(int epfd, int op, int fd, struct epoll_event *event) {
  if (!real_epoll_ctl)
    real_epoll_ctl = (int (*)(int, int, int, struct epoll_event *))dlsym(RTLD_NEXT, "epoll_ctl");
  if (should_fail(op, fd)) {
    errno = ENOMEM;
    return -1;
  }
  return real_epoll_ctl(epfd, op, fd, event);
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
  if (!real_syscall)
    real_syscall = (long (*)(long, long, long, long, long, long, long))dlsym(RTLD_NEXT, "syscall");
  if (number == SYS_epoll_ctl && should_fail((int)b, (int)c)) {
    errno = ENOMEM;
    return -1;
  }
  return real_syscall(number, a, b, c, d, e, f);
}
`;

// Every spawned command's stdout/stderr reader registration fails, so each
// command finishes with ENOMEM (12) as its exit code. The list and the
// pipeline allocate new interpreter nodes right after a command dies, which
// is what recycled the freed slot before the fix.
const FIXTURE = /* js */ `
import { $ } from "bun";
const one = await $\`/bin/echo hello\`.quiet().nothrow();
const list = await $\`/bin/echo a; /bin/echo b; /bin/echo c\`.quiet().nothrow();
const piped = await $\`/bin/echo hi | /bin/cat\`.quiet().nothrow();
console.log(JSON.stringify({ one: one.exitCode, list: list.exitCode, piped: piped.exitCode }));
`;

let shimPath: string;
let dir: ReturnType<typeof tempDir> | undefined;

beforeAll(async () => {
  if (!isLinux || !cc) return;
  dir = tempDir("shell-pipe-epoll-fail", {
    "shim.c": SHIM_C,
    "fixture.js": FIXTURE,
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

test.skipIf(!isLinux || !cc)("shell commands survive epoll_ctl failure on their pipes", async () => {
  const existing = bunEnv.LD_PRELOAD;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "fixture.js"],
    cwd: String(dir),
    env: { ...bunEnv, LD_PRELOAD: existing ? `${shimPath}:${existing}` : shimPath },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const line = stdout.trim().split("\n").pop() ?? "";
  expect({ stderr, line }).toEqual({ stderr: expect.any(String), line: expect.stringContaining("{") });
  // ENOMEM (12) from the failed pipe registration becomes the exit code.
  expect(JSON.parse(line)).toEqual({ one: 12, list: 12, piped: 12 });
  expect(exitCode).toBe(0);
});
