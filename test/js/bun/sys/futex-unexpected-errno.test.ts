// The thread pool blocks an idle worker with FUTEX_WAIT and wakes it with FUTEX_WAKE. A
// layer that filters or emulates system calls (a sandbox, a supervisor, an emulator) can
// answer them with an errno that a stock kernel never gives for the call. bun aborts on
// one, and the crash report has only the panic message to say which code it was.
//
// An LD_PRELOAD shim on libc's syscall() does the call and then reports FUTEX_ERRNO for it.
// A seccomp filter cannot do this test: glibc would see the errno for its own wakes, and
// glibc aborts on it before bun does.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, tempDir } from "harness";
import { join } from "node:path";

const cc = Bun.which("cc") || Bun.which("gcc") || Bun.which("clang");

// The futex constants are kernel ABI. <linux/futex.h> is not there on every CI image.
const SHIM_C = /* c */ `
#define _GNU_SOURCE
#include <dlfcn.h>
#include <errno.h>
#include <stdarg.h>
#include <stdlib.h>
#include <string.h>
#include <sys/syscall.h>
#include <unistd.h>

#define FUTEX_WAIT 0
#define FUTEX_WAKE 1
#define FUTEX_PRIVATE_FLAG 128

static long (*next_syscall)(long, ...);
static int fail_op, fail_errno, failed;

long syscall(long nr, ...) {
  va_list ap;
  va_start(ap, nr);
  long a1 = va_arg(ap, long), a2 = va_arg(ap, long), a3 = va_arg(ap, long);
  long a4 = va_arg(ap, long), a5 = va_arg(ap, long), a6 = va_arg(ap, long);
  va_end(ap);
  if (!next_syscall) {
    fail_errno = atoi(getenv("FUTEX_ERRNO"));
    fail_op = (strcmp(getenv("FUTEX_OP"), "FUTEX_WAKE") == 0 ? FUTEX_WAKE : FUTEX_WAIT) | FUTEX_PRIVATE_FLAG;
    next_syscall = (long (*)(long, ...))dlsym(RTLD_NEXT, "syscall");
  }
  long rc = next_syscall(nr, a1, a2, a3, a4, a5, a6);
  if (nr != SYS_futex || (int)a2 != fail_op) return rc;
  // Without this line a run where the shim changed no call could pass.
  if (!__atomic_exchange_n(&failed, 1, __ATOMIC_RELAXED)) {
    static const char proof[] = "shim: changed the result of a call\\n";
    if (write(1, proof, sizeof(proof) - 1) < 0) abort();
  }
  errno = fail_errno;
  return -1;
}
`;

// One read at a time: a worker is blocked when the pool gets the next read, so the pool
// has to wake it.
const FIXTURE = /* js */ `
import fs from "node:fs";
let n = 0;
for (let i = 0; i < 50; i++) {
  await fs.promises.readFile(import.meta.filename);
  n++;
}
console.log("done", n);
`;

let shimPath: string;
let dir: ReturnType<typeof tempDir> | undefined;

beforeAll(async () => {
  if (!isLinux || !cc) return;
  dir = tempDir("futex-unexpected-errno", {
    "shim.c": SHIM_C,
    "fixture.mjs": FIXTURE,
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

test.concurrent.skipIf(!isLinux || !cc).each([
  ["FUTEX_WAKE", 11, "futex_wake()", "EAGAIN"],
  ["FUTEX_WAIT", 38, "futex_wait()", "ENOSYS"],
] as const)("%s that reports errno %d aborts with the code in the panic message", async (op, errno, call, name) => {
  const existing = bunEnv.LD_PRELOAD;
  await using proc = Bun.spawn({
    // Skip the debug build's slow symbolized backtrace. The fixture ignores the extra
    // argv entry.
    cmd: [bunExe(), "fixture.mjs", "--debug-crash-handler-use-trace-string"],
    cwd: String(dir),
    env: {
      ...bunEnv,
      LD_PRELOAD: existing ? `${shimPath}:${existing}` : shimPath,
      FUTEX_OP: op,
      FUTEX_ERRNO: String(errno),
      // This crash is on purpose. It must not go to the crash reporter that CI sets.
      BUN_CRASH_REPORT_URL: "",
      BUN_ENABLE_CRASH_REPORTING: "0",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect({
    stdout,
    // The first one: the crash handler issues the same calls and can panic on them too.
    panic: stderr.split("\n").find(line => line.startsWith("panic: ")),
    aborted: exitCode !== 0,
  }).toEqual({
    stdout: "shim: changed the result of a call\n",
    panic: `panic: Unexpected ${call} return code: -${errno} - ${name}`,
    aborted: true,
  });
});
