import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, tempDirWithFiles } from "harness";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

// Reproduces the seccomp class of failures documented in libuv's
// deps/uv/src/unix/fs.c: statx under a seccomp filter that does not
// whitelist it returns EPERM (libseccomp < 2.3.3, docker < 18.04, various
// CI sandboxes). Before the fix, fs.stat would throw EPERM here.
// After the fix, statxImpl falls back to fstatat.
describe.skipIf(!isLinux)("fs.stat seccomp statx fallback", () => {
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
    /* if nr == __NR_statx → return EPERM */
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, __NR_statx, 0, 1),
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ERRNO | (EPERM & SECCOMP_RET_DATA)),
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

  const tryBuild = () => {
    const dir = tempDirWithFiles("stat-seccomp", {
      "block_statx.c": helperSrc,
    });
    const src = join(dir, "block_statx.c");
    const bin = join(dir, "block_statx");
    const compile = spawnSync("cc", ["-O0", "-o", bin, src], { stdio: "pipe" });
    if (compile.status !== 0 || !existsSync(bin)) {
      return null;
    }
    return { dir, bin };
  };

  test("fs.statSync succeeds when statx is blocked by seccomp", async () => {
    const built = tryBuild();
    if (!built) return; // no compiler / seccomp headers available — skip

    const targetDir = tempDirWithFiles("stat-seccomp-target", {
      "file.txt": "hello",
    });
    const target = join(targetDir, "file.txt");

    // Sanity check: the blocker itself must actually block statx. If the
    // environment doesn't permit seccomp (exit 77), skip.
    await using proc = Bun.spawn({
      cmd: [
        built.bin,
        bunExe(),
        "-e",
        `
          const fs = require("node:fs");
          const s = fs.statSync(${JSON.stringify(target)});
          const l = fs.lstatSync(${JSON.stringify(target)});
          const fd = fs.openSync(${JSON.stringify(target)}, "r");
          const f = fs.fstatSync(fd);
          fs.closeSync(fd);
          console.log(JSON.stringify({ size: s.size, lsize: l.size, fsize: f.size, isFile: s.isFile() }));
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    if (exitCode === 77) {
      // Helper couldn't install seccomp in this environment — skip.
      console.log("skip: seccomp not permitted in this environment:", stderr.trim());
      return;
    }

    expect(stdout.trim()).toBe(JSON.stringify({ size: 5, lsize: 5, fsize: 5, isFile: true }));
    expect(exitCode).toBe(0);
  });
});
