// https://github.com/oven-sh/bun/issues/47085
// A seccomp policy that denies the socket syscalls (sendto/recvfrom) but
// allows read/write must not break stdio on a socketpair. Node only uses
// read/write on a stream handle, so it keeps working in such a sandbox.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, tempDirWithFiles } from "harness";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

// Same helper as test/js/node/fs/fs-stat-seccomp-linux.test.ts: installs a
// filter that makes `BLOCK_SYSCALL` fail with the errno in argv[1] (0 raises
// SIGSYS instead), then execs argv[2..]. The filter covers the whole process.
const helperSrc = `
#define _GNU_SOURCE
#include <errno.h>
#include <linux/audit.h>
#include <linux/filter.h>
#include <linux/seccomp.h>
#include <stddef.h>
#include <stdio.h>
#include <stdlib.h>
#include <sys/prctl.h>
#include <sys/syscall.h>
#include <unistd.h>

#if defined(__x86_64__)
  #define MY_AUDIT_ARCH AUDIT_ARCH_X86_64
#elif defined(__aarch64__)
  #define MY_AUDIT_ARCH AUDIT_ARCH_AARCH64
#else
  #define MY_AUDIT_ARCH 0
#endif

/* usage: block <errno> <cmd> [args...] */
int main(int argc, char **argv) {
  if (argc < 3) return 2;
  if (MY_AUDIT_ARCH == 0) return 77; /* unsupported arch, skip */
  unsigned int err = (unsigned int)atoi(argv[1]);
  unsigned int action = err == 0 ? SECCOMP_RET_TRAP : SECCOMP_RET_ERRNO | (err & SECCOMP_RET_DATA);

  struct sock_filter filter[] = {
    BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, arch)),
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, MY_AUDIT_ARCH, 1, 0),
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW),
    BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, nr)),
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, BLOCK_SYSCALL, 0, 1),
    BPF_STMT(BPF_RET | BPF_K, action),
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW),
  };
  struct sock_fprog prog = {
    .len = (unsigned short)(sizeof(filter) / sizeof(filter[0])),
    .filter = filter,
  };

  if (prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) != 0) {
    perror("prctl(PR_SET_NO_NEW_PRIVS)");
    return 77; /* cannot install filter, skip */
  }
  if (syscall(__NR_seccomp, SECCOMP_SET_MODE_FILTER, 0, &prog) != 0) {
    perror("seccomp");
    return 77; /* cannot install filter, skip */
  }

  execvp(argv[2], &argv[2]);
  perror("execvp");
  return 127;
}
`;

const TRAP = 0;
const EPERM = 1;
const EACCES = 13;
const ENOSYS = 38;

// Returns the binary path, or null when the host cannot build it (no cc, no
// kernel headers). Any other compile failure throws.
function tryBuildHelper(syscall: string): string | null {
  const dir = tempDirWithFiles("seccomp-helper", { "block.c": helperSrc });
  const src = join(dir, "block.c");
  const bin = join(dir, "block");
  const compile = spawnSync("cc", ["-O0", `-DBLOCK_SYSCALL=${syscall}`, "-o", bin, src], { stdio: "pipe" });
  if ((compile.error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") return null;
  if (compile.status !== 0) {
    const stderr = compile.stderr?.toString() ?? "";
    if (/linux\/(seccomp|filter|audit)\.h|sys\/prctl\.h/.test(stderr)) return null;
    throw new Error(`failed to compile seccomp helper:\n${stderr}`);
  }
  if (!existsSync(bin)) throw new Error("seccomp helper compiled but the binary is missing");
  return bin;
}

const fixture = join(import.meta.dir, "47085-fixture.js");

// Runs the fixture under the helper.
async function runUnderSeccomp(bin: string, errno: number, mode: string, stdin?: string) {
  await using proc = Bun.spawn({
    cmd: [bin, String(errno), bunExe(), fixture, mode],
    env: bunEnv,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  if (stdin !== undefined) proc.stdin.write(stdin);
  proc.stdin.end();
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

describe.skipIf(!isLinux)("stdio on a socketpair when seccomp denies the socket syscalls", () => {
  const sendto = tryBuildHelper("__NR_sendto");
  const recvfrom = tryBuildHelper("__NR_recvfrom");
  // Some runners forbid a nested seccomp filter. The helper exits 77 then.
  const seccompAllowed = sendto != null && spawnSync(sendto, [String(EPERM), "true"], { stdio: "ignore" }).status === 0;
  const skip = sendto == null || recvfrom == null || !seccompAllowed;
  const skipReason = sendto == null || recvfrom == null ? "no cc or seccomp headers" : "seccomp not permitted here";

  const cases: Array<{ name: string; helper: string | null; mode: string; stdin?: string; expected: object }> = [
    {
      name: "process.stdout.write when sendto is denied",
      helper: sendto,
      mode: "stdout",
      expected: { stdout: "SA", stderr: "callback:ok", exitCode: 0 },
    },
    {
      name: "a subprocess's stdin when sendto is denied",
      helper: sendto,
      mode: "spawn-stdin",
      expected: { stdout: "got:hello", stderr: "", exitCode: 0 },
    },
    {
      name: "process.stdin when recvfrom is denied",
      helper: recvfrom,
      mode: "stdin",
      stdin: "hello",
      expected: { stdout: "got:hello", stderr: "", exitCode: 0 },
    },
    {
      name: "Bun.stdin.text() when recvfrom is denied",
      helper: recvfrom,
      mode: "bun-stdin",
      stdin: "hello",
      expected: { stdout: "got:hello", stderr: "", exitCode: 0 },
    },
    {
      name: "spawnSync captures a child's output when recvfrom is denied",
      helper: recvfrom,
      mode: "spawn-sync",
      expected: { stdout: JSON.stringify({ status: 0, stdout: "from child", error: null }), stderr: "", exitCode: 0 },
    },
  ];

  // EPERM is what a SECCOMP_RET_ERRNO policy returns, EACCES what systemd's
  // SystemCallErrorNumber=EACCES returns. ENOSYS is what bun's SIGSYS handler
  // reports for a SECCOMP_RET_TRAP policy (TRAP exercises that handler, ENOSYS
  // the errno on its own).
  for (const [errnoName, errno] of [
    ["EPERM", EPERM],
    ["EACCES", EACCES],
    ["ENOSYS", ENOSYS],
    ["TRAP", TRAP],
  ] as const) {
    for (const c of cases) {
      test.concurrent.skipIf(skip)(`${c.name} with ${errnoName}${skip ? ` (${skipReason})` : ""}`, async () => {
        expect(await runUnderSeccomp(c.helper!, errno, c.mode, c.stdin)).toEqual(c.expected);
      });
    }
  }
});
