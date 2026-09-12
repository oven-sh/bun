import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, tempDirWithFiles } from "harness";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

// On kernels where close_range(2) is unavailable (Linux <5.9, seccomp-filtered
// containers) the fork-path spawn child falls back to an fd sweep. The sweep
// used to walk getdtablesize() clamped to 65536, which both cost ~65k fcntl
// calls serialized on the spawn critical path and missed fds above 65536. The
// fix enumerates /proc/self/fd in the parent so the child's sweep is bounded
// by the actual highest open fd.
//
// This test simulates the no-close_range environment with a seccomp filter
// returning ENOSYS, opens a non-CLOEXEC fd above the old 65536 clamp, spawns,
// and asserts the child did not inherit it.
describe.skipIf(!isLinux)("Bun.spawn close_range fallback fd sweep", () => {
  // Helper: raise RLIMIT_NOFILE, dup a /dev/null fd onto HIGH_FD without
  // CLOEXEC, install a seccomp filter that ENOSYS's close_range, exec argv.
  const HIGH_FD = 70000;
  const helperSrc = `
#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <linux/audit.h>
#include <linux/filter.h>
#include <linux/seccomp.h>
#include <stddef.h>
#include <stdio.h>
#include <stdlib.h>
#include <sys/prctl.h>
#include <sys/resource.h>
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
  if (MY_AUDIT_ARCH == 0) return 77;

  struct rlimit rl;
  if (getrlimit(RLIMIT_NOFILE, &rl) != 0) return 77;
  if (rl.rlim_max <= ${HIGH_FD}) return 77; /* hard limit too low, skip */
  rl.rlim_cur = rl.rlim_max;
  if (setrlimit(RLIMIT_NOFILE, &rl) != 0) return 77;

  int src = open("/dev/null", O_RDONLY);
  if (src < 0) return 77;
  /* F_DUPFD (not F_DUPFD_CLOEXEC): explicitly without CLOEXEC. */
  if (fcntl(src, F_DUPFD, ${HIGH_FD}) < 0) return 77;
  close(src);

  struct sock_filter filter[] = {
    BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, arch)),
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, MY_AUDIT_ARCH, 1, 0),
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW),
    BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, nr)),
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, __NR_close_range, 0, 1),
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ERRNO | (ENOSYS & SECCOMP_RET_DATA)),
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW),
  };
  struct sock_fprog prog = { .len = sizeof(filter)/sizeof(filter[0]), .filter = filter };
  if (prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) != 0) { perror("no_new_privs"); return 77; }
  if (syscall(__NR_seccomp, SECCOMP_SET_MODE_FILTER, 0, &prog) != 0) { perror("seccomp"); return 77; }
  /* Prove the filter took effect; otherwise the test would exercise the
     close_range fast path and pass vacuously. */
  errno = 0;
  if (syscall(__NR_close_range, ~0U, ~0U, 0) != -1 || errno != ENOSYS) return 77;

  execvp(argv[1], &argv[1]);
  perror("execvp");
  return 127;
}
`;

  const tryBuild = (): string | null => {
    const dir = tempDirWithFiles("spawn-closerange", { "block_close_range.c": helperSrc });
    const src = join(dir, "block_close_range.c");
    const bin = join(dir, "block_close_range");
    const compile = spawnSync("cc", ["-O0", "-o", bin, src], { stdio: "pipe" });
    if ((compile.error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") return null;
    if (compile.status !== 0) {
      const stderr = compile.stderr?.toString() ?? "";
      if (/linux\/(seccomp|filter|audit)\.h|sys\/prctl\.h/.test(stderr)) return null;
      throw new Error(`failed to compile seccomp helper:\n${stderr}`);
    }
    if (!existsSync(bin)) throw new Error("seccomp helper produced no output binary");
    return bin;
  };

  const helperBin = isLinux ? tryBuild() : null;

  test.skipIf(helperBin == null)("fd above the 65536 clamp does not leak into a spawned child", async () => {
    // Outer bun: verify HIGH_FD arrived from the helper, then Bun.spawn an
    // inner bun and report which /proc/self/fd entries it sees.
    const script = `
      const fs = require("node:fs");
      const outerHas = fs.readdirSync("/proc/self/fd").includes("${HIGH_FD}");
      const proc = Bun.spawn({
        cmd: [${JSON.stringify(bunExe())}, "-e",
          'process.stdout.write(require("fs").readdirSync("/proc/self/fd").join(","))'],
        stdout: "pipe", stderr: "inherit",
      });
      const inner = await proc.stdout.text();
      await proc.exited;
      const innerHas = inner.split(",").includes("${HIGH_FD}");
      console.log(JSON.stringify({ outerHas, innerHas }));
    `;

    await using proc = Bun.spawn({
      cmd: [helperBin!, bunExe(), "-e", script],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    if (exitCode === 77) {
      console.warn("SKIP: seccomp unavailable or RLIMIT_NOFILE hard limit too low");
      return;
    }

    expect(stderr).not.toContain("error");
    const result = JSON.parse(stdout.trim());
    // Precondition: the helper's non-CLOEXEC fd reached the outer bun. Bun's
    // startup close_range sweep is also ENOSYS'd by seccomp, so this holds.
    expect(result.outerHas).toBe(true);
    // The assertion under test: posix_spawn_bun's child sweep caught HIGH_FD.
    expect(result.innerHas).toBe(false);
    expect(exitCode).toBe(0);
  });
});
