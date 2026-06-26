// An LD_PRELOAD shim makes epoll_ctl(EPOLL_CTL_MOD) fail with ENOMEM (what the
// kernel returns under memory pressure) for the readable socketpairs backing a
// shell subprocess's stdout/stderr. The pipe reader reports the error
// synchronously, from inside ShellSubprocess::spawn_async, while
// Cmd::transition_to_exec is still on the stack. That callback must not tear
// the running Cmd down re-entrantly: doing so frees the Cmd's interpreter
// arena slot (and the subprocess) out from under the spawning frame, which
// then panics with "expected Node::Cmd at Node#N, got Free".
//
// Bun routes epoll_ctl through libc's syscall(SYS_epoll_ctl, ...), so the shim
// interposes syscall(), not epoll_ctl().
import { afterAll, beforeAll, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, tempDir } from "harness";
import { join } from "node:path";

const cc = Bun.which("cc") || Bun.which("gcc") || Bun.which("clang");

const SHIM_C = /* c */ `
#define _GNU_SOURCE
#include <dlfcn.h>
#include <errno.h>
#include <stdarg.h>
#include <stdlib.h>
#include <sys/epoll.h>
#include <sys/stat.h>
#include <sys/syscall.h>

typedef long (*syscall_fn)(long, long, long, long, long, long, long);
static syscall_fn real_syscall;
static int enabled = -1;

long syscall(long number, ...) {
  va_list ap;
  long a[6];
  va_start(ap, number);
  for (int i = 0; i < 6; i++) a[i] = va_arg(ap, long);
  va_end(ap);
  if (!real_syscall) {
    real_syscall = (syscall_fn)dlsym(RTLD_NEXT, "syscall");
    enabled = getenv("FAIL_PIPE_EPOLL_MOD") != NULL;
  }
  if (enabled == 1 && number == SYS_epoll_ctl && (int)a[1] == EPOLL_CTL_MOD) {
    struct epoll_event *ev = (struct epoll_event *)a[3];
    struct stat st;
    if (ev && (ev->events & EPOLLIN) && fstat((int)a[2], &st) == 0 && S_ISSOCK(st.st_mode)) {
      errno = ENOMEM;
      return -1;
    }
  }
  return real_syscall(number, a[0], a[1], a[2], a[3], a[4], a[5]);
}
`;

// `sleep` writes nothing, so both capture readers hit EAGAIN inside the spawn
// call and re-arm their polls there; the shim fails those re-arms.
const REPRO_JS = /* js */ `
import { $ } from "bun";
const r = await $\`sleep 30\`.quiet().nothrow();
console.log(JSON.stringify({ exitCode: r.exitCode }));
`;

let dir: ReturnType<typeof tempDir> | undefined;
let shimPath: string;

beforeAll(async () => {
  if (!isLinux || !cc) return;
  dir = tempDir("shell-spawn-poll-fail", {
    "shim.c": SHIM_C,
    "repro.js": REPRO_JS,
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

test.skipIf(!isLinux || !cc)(
  "$ spawn survives a poll registration failure on its stdout/stderr pipes",
  async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "repro.js"],
      cwd: String(dir),
      env: {
        ...bunEnv,
        LD_PRELOAD: bunEnv.LD_PRELOAD ? `${shimPath}:${bunEnv.LD_PRELOAD}` : shimPath,
        FAIL_PIPE_EPOLL_MOD: "1",
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    const line = stdout.trim().split("\n").pop() ?? "";
    expect({ line, exitCode }).toEqual({ line: expect.stringContaining("{"), exitCode: 0 });
    // The failed poll registration surfaces as a nonzero exit code for the
    // command (derived from the errno); asserting nonzero also proves the
    // fault injection fired (otherwise `sleep 30` would have exited 0).
    const result = JSON.parse(line);
    expect(result).toEqual({ exitCode: expect.any(Number) });
    expect(result.exitCode).not.toBe(0);
  },
);
