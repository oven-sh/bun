// On POSIX, Bun backs a "pipe" child stdio with socketpair(2) and writes to it
// with send(2). When the child closes its end while a send is copying data in,
// the macOS kernel fails the send with ENOTCONN where a pipe reports EPIPE. Bun
// reports the socket the way a pipe would: EPIPE from "write". The race is
// timing dependent, so an LD_PRELOAD shim makes send() on the child's stdin
// socket fail with a chosen errno instead.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, tempDir } from "harness";
import { constants } from "node:os";
import { join } from "node:path";

const cc = Bun.which("cc") || Bun.which("gcc") || Bun.which("clang");

// STDIN_FAIL_SEND_ERRNO=<n>: every send() on a non-stdio AF_UNIX socket fails
// with errno n. The child's stdin is the only such socket the fixture writes.
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
static int fail_errno = -1;

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
    const char *value = getenv("STDIN_FAIL_SEND_ERRNO");
    fail_errno = value ? atoi(value) : 0;
  }
  if (fail_errno > 0 && fd > 2 && is_unix_sock(fd)) {
    errno = fail_errno;
    return -1;
  }
  return real_send(fd, buf, len, flags);
}
`;

// The child only has to exist long enough to own the other end of the stdin
// socketpair. It runs without the shim so the fault stays in the parent.
const FIXTURE = /* js */ `
import { spawn } from "node:child_process";
const env = { ...process.env };
delete env.LD_PRELOAD;
delete env.STDIN_FAIL_SEND_ERRNO;
const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 30_000)"], {
  stdio: ["pipe", "ignore", "ignore"],
  env,
});
const error = await new Promise(resolve => {
  child.stdin.on("error", err => resolve({ code: err.code, syscall: err.syscall, errno: err.errno }));
  child.stdin.end(Buffer.alloc(64 * 1024, 0x61));
});
child.kill();
console.log(JSON.stringify(error));
`;

describe.skipIf(!isLinux || !cc)("node:child_process stdin write error on a socketpair", () => {
  let shimPath: string;
  let dir: ReturnType<typeof tempDir>;

  beforeAll(async () => {
    dir = tempDir("child-stdin-send-errno", {
      "shim.c": SHIM_C,
      "fixture.mjs": FIXTURE,
    });
    shimPath = join(String(dir), "shim.so");
    await using ccProc = Bun.spawn({
      cmd: [cc!, "-shared", "-fPIC", "-o", shimPath, join(String(dir), "shim.c"), "-ldl"],
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

  // Node names every stream write failure "write". The errno is the one a pipe
  // gives for a reader that is gone, whatever the socket said.
  test.concurrent.each(["ENOTCONN", "EPIPE"] as const)(
    "send() failing with %s surfaces as EPIPE from write",
    async sendErrno => {
      const existing = bunEnv.LD_PRELOAD;
      await using proc = Bun.spawn({
        cmd: [bunExe(), "fixture.mjs"],
        cwd: String(dir),
        env: {
          ...bunEnv,
          LD_PRELOAD: existing ? `${shimPath}:${existing}` : shimPath,
          STDIN_FAIL_SEND_ERRNO: String(constants.errno[sendErrno]),
        },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      let error: unknown;
      try {
        error = JSON.parse(stdout.trim().split("\n").pop() ?? "");
      } catch {
        error = stdout;
      }
      expect({ error, stderr, exitCode }).toEqual({
        error: { code: "EPIPE", syscall: "write", errno: -constants.errno.EPIPE },
        stderr: "",
        exitCode: 0,
      });
    },
  );
});
