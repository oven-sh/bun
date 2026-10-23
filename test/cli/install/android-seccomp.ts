import { isLinux, tempDirWithFiles } from "harness";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

// Android's app seccomp policy denies openat2(2) and fchmodat2(2) with
// SECCOMP_RET_TRAP: the process is killed by SIGSYS instead of seeing ENOSYS,
// so the errno-based fallbacks never run and `bun install` dies while linking
// package bins (issue #39060, Termux). Bun detects Android at runtime (an
// "android" kernel release string, or Android's dynamic linker under the
// ANDROID_ROOT Android init sets for every process) and skips those syscalls.
// The helper reproduces the Android policy with an equivalent seccomp filter.
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
    /* openat2 (437) and fchmodat2 (452) -> SIGSYS, like Android */
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, 437, 1, 0),
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, 452, 0, 1),
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_TRAP),
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

// Compile the seccomp helper. Returns the binary path, or null if the host
// genuinely can't build it (no cc, missing kernel headers). Any other compile
// failure throws so a source regression isn't silently hidden as a skip.
const tryBuild = (): string | null => {
  const dir = tempDirWithFiles("android-seccomp", {
    "sigsys_wrap.c": helperSrc,
  });
  const src = join(dir, "sigsys_wrap.c");
  const bin = join(dir, "sigsys_wrap");
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

// Decided before the test runs, so a host that cannot run it reports a skip and not a pass.
const helperBin = isLinux ? tryBuild() : null;
// The helper exits 77 where it is not allowed to install its filter.
const canFilter = helperBin != null && spawnSync(helperBin, ["true"], { stdio: "pipe" }).status !== 77;

/**
 * Runs the command that follows it under Android's seccomp policy for `openat2` and `fchmodat2`.
 * Null where it cannot be built or is not allowed to install its filter.
 */
export const androidSeccompWrap = canFilter ? helperBin : null;
