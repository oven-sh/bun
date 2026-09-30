// An LD_PRELOAD shim makes send() on the shell pipeline's socketpair fail with
// ENOMEM (a fatal, non-EPIPE write error). The IOWriter must report that error
// to every chunk enqueued afterwards instead of queueing onto the dead writer.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, tempDir } from "harness";
import { join } from "node:path";

const cc = Bun.which("cc") || Bun.which("gcc") || Bun.which("clang");

// SHELL_FAIL_SEND=1: every send() on a non-stdio AF_UNIX socket fails with
// ENOMEM. The shell's pipeline pipes are AF_UNIX socketpairs written with
// send(), so this faults exactly the pipeline write path and nothing else.
const SHIM_C = /* c */ `
#define _GNU_SOURCE
#include <dlfcn.h>
#include <errno.h>
#include <stdlib.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <unistd.h>

static ssize_t (*real_send)(int, const void *, size_t, int);
static int fail_send = -1;

static int is_unix_sock(int fd) {
  struct stat st;
  if (fstat(fd, &st) != 0 || !S_ISSOCK(st.st_mode)) return 0;
  int domain = 0;
  socklen_t len = sizeof(domain);
  return getsockopt(fd, SOL_SOCKET, SO_DOMAIN, &domain, &len) == 0 && domain == AF_UNIX;
}

ssize_t send(int fd, const void *buf, size_t len, int flags) {
  if (!real_send) {
    real_send = (ssize_t (*)(int, const void *, size_t, int))dlsym(RTLD_NEXT, "send");
    fail_send = getenv("SHELL_FAIL_SEND") != NULL;
  }
  if (fail_send && fd > 2 && is_unix_sock(fd)) {
    errno = ENOMEM;
    return -1;
  }
  return real_send(fd, buf, len, flags);
}
`;

// All three statements write to the same stdout IOWriter (the socketpair
// feeding \`cat\`). The first chunk's send() fails; the later enqueues must
// fail fast so the pipeline still finishes (cat sees EOF and exits 0).
const FIXTURE = /* js */ `
import { $ } from "bun";
const r = await $\`(echo one; echo two; echo three) | cat\`.quiet().nothrow();
console.log(JSON.stringify({ exitCode: r.exitCode, stdout: r.stdout.toString() }));
`;

let shimPath: string;
let dir: ReturnType<typeof tempDir> | undefined;

beforeAll(async () => {
  if (!isLinux || !cc) return;
  dir = tempDir("shell-write-fault", {
    "shim.c": SHIM_C,
    "fixture.js": FIXTURE,
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

test.concurrent.skipIf(!isLinux || !cc)(
  "shell finishes when send() on a pipeline pipe fails after the writer started",
  async () => {
    const existing = bunEnv.LD_PRELOAD;
    await using proc = Bun.spawn({
      // If the fixture does crash, skip the debug build's slow symbolized
      // backtrace so the failure surfaces as the panic message, not a test
      // timeout. The fixture ignores the extra argv entry.
      cmd: [bunExe(), "fixture.js", "--debug-crash-handler-use-trace-string"],
      cwd: String(dir),
      env: {
        ...bunEnv,
        LD_PRELOAD: existing ? `${shimPath}:${existing}` : shimPath,
        SHELL_FAIL_SEND: "1",
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const line = stdout.trim().split("\n").pop() ?? "";
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      parsed = line;
    }
    // One combined assertion so a crash surfaces stderr and the exit code in
    // the diff. `cat` is last in the pipeline, so the expression's exit code
    // is 0; the failed writer means nothing reached it.
    expect({ parsed, stderr, exitCode }).toEqual({
      parsed: { exitCode: 0, stdout: "" },
      stderr: expect.any(String),
      exitCode: 0,
    });
  },
);
