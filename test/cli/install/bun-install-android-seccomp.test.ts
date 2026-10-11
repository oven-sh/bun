import { expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, tempDir, tempDirWithFiles } from "harness";
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, statSync } from "node:fs";
import { join } from "node:path";

// Android's app seccomp policy denies openat2(2) and fchmodat2(2) with
// SECCOMP_RET_TRAP: the process is killed by SIGSYS instead of seeing ENOSYS,
// so the errno-based fallbacks never run and `bun install` dies while linking
// package bins (issue #39060, Termux). Bun detects Android at runtime (the
// ANDROID_ROOT/ANDROID_DATA env vars Android init sets for every process, or
// an "android" kernel release string) and skips those syscalls entirely.
// This test reproduces the Android policy with an equivalent seccomp filter.
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

// Android env vars are how bun's runtime detection recognizes Android here
// (the kernel release string of the test host obviously isn't Android's).
const androidEnv = { ...bunEnv, ANDROID_ROOT: "/system", ANDROID_DATA: "/data" };

test.skipIf(!isLinux)("bun install survives Android-style seccomp (openat2/fchmodat2 SIGSYS)", async () => {
  const helperBin = tryBuild();
  if (helperBin == null) {
    // bun:test has no runtime-skip; log loudly so CI output distinguishes
    // this from a real pass.
    console.warn("SKIP bun install android seccomp: cc or seccomp headers not available");
    return;
  }

  using dir = tempDir("install-android-seccomp", {
    "package.json": JSON.stringify({
      name: "app",
      version: "1.0.0",
      dependencies: { dep: "file:./dep" },
    }),
    "dep/package.json": JSON.stringify({
      name: "dep",
      version: "1.0.0",
      bin: { dep: "bin/dep.js" },
    }),
    // bin in a subdirectory so bin linking validates the parent dir with
    // openat2(RESOLVE_BENEATH), then chmods the target (fchmodat2).
    "dep/bin/dep.js": "#!/usr/bin/env node\nconsole.log('ok');\n",
  });

  await using proc = Bun.spawn({
    cmd: [helperBin, bunExe(), "install"],
    cwd: String(dir),
    env: androidEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  if (exitCode === 77) {
    console.warn("SKIP bun install android seccomp: seccomp not permitted in this environment");
    return;
  }

  // Without the runtime Android detection the install dies with SIGSYS
  // (exit 159) in bin linking.
  expect({ stdout, stderr, signalCode: proc.signalCode ?? null, exitCode }).toMatchObject({
    signalCode: null,
    exitCode: 0,
  });

  // The bin link was created and the target was made executable — proving
  // the lchmod fallback actually chmod'd instead of silently skipping.
  const binLink = join(String(dir), "node_modules", ".bin", "dep");
  expect(lstatSync(binLink).isSymbolicLink()).toBe(true);
  const targetMode = statSync(join(String(dir), "node_modules", "dep", "bin", "dep.js")).mode;
  expect(targetMode & 0o111).not.toBe(0);
});
