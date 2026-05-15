// https://github.com/oven-sh/bun/issues/30766
//
// Android's zygote installs a seccomp-bpf filter with SECCOMP_RET_TRAP that
// does not allowlist close_range(2) (syscall 436, Linux 5.9+). Before the
// fix, every close_range call in bun startup delivered SIGSYS and the binary
// died with "Bad system call" (exit 159 = 128 + 31) before reaching any user
// code — including `bun --version`.
//
// We can't run Android in CI, but we can reproduce the exact seccomp
// condition on any Linux host: install a filter that RET_TRAPs __NR_close_range
// in a small helper, then exec bun under it and check that bun's internal
// probe catches the SIGSYS and falls back to the fcntl/close loop.

import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, tempDirWithFiles } from "harness";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

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

#ifndef __NR_close_range
#define __NR_close_range 436
#endif

#if defined(__x86_64__)
  #define MY_AUDIT_ARCH AUDIT_ARCH_X86_64
#elif defined(__aarch64__)
  #define MY_AUDIT_ARCH AUDIT_ARCH_AARCH64
#else
  #define MY_AUDIT_ARCH 0
#endif

int main(int argc, char **argv) {
  if (argc < 2) return 2;
  if (MY_AUDIT_ARCH == 0) return 77; /* unsupported arch, skip */

  struct sock_filter filter[] = {
    /* arch check */
    BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, arch)),
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, MY_AUDIT_ARCH, 1, 0),
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW),
    /* load syscall nr */
    BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, nr)),
    /* if nr == __NR_close_range → SIGSYS trap (matches Android zygote) */
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, __NR_close_range, 0, 1),
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_TRAP),
    /* else → allow */
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

  execvp(argv[1], &argv[1]);
  perror("execvp");
  return 127;
}
`;

describe.skipIf(!isLinux)("issue #30766 — bun startup survives seccomp blocking close_range", () => {
  const tryBuild = (): string | null => {
    const dir = tempDirWithFiles("close-range-seccomp", {
      "trap_close_range.c": helperSrc,
    });
    const src = join(dir, "trap_close_range.c");
    const bin = join(dir, "trap_close_range");
    const compile = spawnSync("cc", ["-O0", "-o", bin, src], { stdio: "pipe" });

    // compiler not on PATH — expected skip
    if ((compile.error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") return null;

    if (compile.status !== 0) {
      const stderr = compile.stderr?.toString() ?? "";
      // missing linux/*.h on the host — expected skip
      if (/linux\/(seccomp|filter|audit)\.h|sys\/prctl\.h/.test(stderr)) return null;
      throw new Error(`failed to compile seccomp helper:\n${stderr}`);
    }
    if (!existsSync(bin)) {
      throw new Error("seccomp helper compiled successfully but output binary is missing");
    }
    return bin;
  };

  const helperBin = tryBuild();

  test("--version exits 0 under a seccomp filter that SIGSYS-traps close_range", async () => {
    if (helperBin == null) {
      console.warn("SKIP: cc or seccomp headers not available on this host");
      return;
    }

    await using proc = Bun.spawn({
      cmd: [helperBin, bunExe(), "--version"],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    if (exitCode === 77) {
      console.warn("SKIP: kernel refused to install seccomp filter");
      return;
    }

    // Pre-fix: bun is killed by SIGSYS during `bun_initialize_process` before
    // reaching --version. Exit is 159 (128 + 31, SIGSYS) and stderr is empty
    // (the kernel kills before any write). Post-fix: probe returns "blocked",
    // bun_close_range returns -1 with ENOSYS, and --version prints cleanly.
    expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
    expect(exitCode).toBe(0);
  });

  test("-e 'console.log(1)' runs under the same seccomp filter", async () => {
    // A second callsite in bun_initialize_process is exercised the same way;
    // this also covers the fact that a trivial script path still runs (so the
    // probe isn't accidentally breaking later fd-cleanup paths).
    if (helperBin == null) {
      console.warn("SKIP: cc or seccomp headers not available on this host");
      return;
    }

    await using proc = Bun.spawn({
      cmd: [helperBin, bunExe(), "-e", "console.log(1+2)"],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    if (exitCode === 77) {
      console.warn("SKIP: kernel refused to install seccomp filter");
      return;
    }

    expect(stdout.trim()).toBe("3");
    expect(exitCode).toBe(0);
  });
});
