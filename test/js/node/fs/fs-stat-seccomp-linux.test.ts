import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, tempDir, tempDirWithFiles } from "harness";
import { spawnSync } from "node:child_process";
import { existsSync, symlinkSync } from "node:fs";
import { join } from "node:path";

// Seccomp helper: installs a filter that makes one syscall (`BLOCK_SYSCALL`,
// a `-D` define) fail with the errno given in argv[1], then execs argv[2..].
// Shared by the describe blocks below.
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

  struct sock_filter filter[] = {
    /* arch check */
    BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, arch)),
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, MY_AUDIT_ARCH, 1, 0),
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW),
    /* load syscall nr */
    BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, nr)),
    /* if nr == BLOCK_SYSCALL → return the requested errno */
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, BLOCK_SYSCALL, 0, 1),
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ERRNO | (err & SECCOMP_RET_DATA)),
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

  execvp(argv[2], &argv[2]);
  perror("execvp");
  return 127;
}
`;

// Linux errno values (identical on x86_64 and aarch64).
const EPERM = 1;
const EACCES = 13;
// Driver-internal code that leaks to userspace; above EHWPOISON (133), the
// last errno bun's SystemErrno table declares.
const ENOTSUPP = 524;

// Compile the seccomp helper for one syscall. Returns the binary path, or
// null if the host genuinely can't build it (no cc, missing kernel headers).
// Any other compile failure throws so a source regression isn't silently
// hidden as a skip.
function tryBuildHelper(syscall: string): string | null {
  const dir = tempDirWithFiles("seccomp-helper", {
    "block.c": helperSrc,
  });
  const src = join(dir, "block.c");
  const bin = join(dir, "block");
  const compile = spawnSync("cc", ["-O0", `-DBLOCK_SYSCALL=${syscall}`, "-o", bin, src], { stdio: "pipe" });

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
}

// Run `bun -e snippet args...` under the seccomp helper, with the blocked
// syscall failing with `errno`. Returns { stdout, stderr, exitCode } on
// success, or null if the environment refused to install the seccomp filter
// (skip).
async function runUnderSeccomp(bin: string, errno: number, snippet: string, args: string[] = []) {
  await using proc = Bun.spawn({
    cmd: [bin, String(errno), bunExe(), "-e", snippet, ...args],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  if (exitCode === 77) return null;
  return { stdout, stderr, exitCode };
}

// Reproduces the seccomp class of failures documented in libuv's
// deps/uv/src/unix/fs.c: statx under a seccomp filter that does not
// whitelist it returns EPERM (libseccomp < 2.3.3, docker < 18.04, various
// CI sandboxes). Before the fix, fs.stat would throw EPERM here.
// After the fix, statxImpl falls back to fstat/lstat/stat.
//
// Each stat variant runs in its OWN subprocess so the per-process
// `supports_statx_on_linux` flag is still `true` on entry — otherwise the
// first call would flip the flag and subsequent calls would bypass
// statxImpl/statxFallback entirely and go straight to Syscall.lstat/fstat.
describe.skipIf(!isLinux)("fs.stat seccomp statx fallback", () => {
  const helperBin = tryBuildHelper("__NR_statx");

  // `lstatSync` targets a symlink so the SYMLINK_NOFOLLOW branch of
  // statxFallback is actually distinguishable from the stat() branch: if
  // the condition were inverted the subprocess would follow the link and
  // report isSymbolicLink:false / isFile:true.
  const cases: Array<{
    name: string;
    target: (dir: string) => string;
    snippet: (target: string) => string;
    expected: string;
  }> = [
    {
      name: "statSync",
      target: dir => join(dir, "file.txt"),
      snippet: target => `
        const fs = require("node:fs");
        const s = fs.statSync(${JSON.stringify(target)});
        console.log(JSON.stringify({ size: s.size, isFile: s.isFile(), isSymbolicLink: s.isSymbolicLink() }));
      `,
      expected: JSON.stringify({ size: 5, isFile: true, isSymbolicLink: false }),
    },
    {
      name: "lstatSync",
      target: dir => join(dir, "link.txt"),
      snippet: target => `
        const fs = require("node:fs");
        const s = fs.lstatSync(${JSON.stringify(target)});
        console.log(JSON.stringify({ isFile: s.isFile(), isSymbolicLink: s.isSymbolicLink() }));
      `,
      // isFile:false + isSymbolicLink:true proves we used lstat, not stat.
      expected: JSON.stringify({ isFile: false, isSymbolicLink: true }),
    },
    {
      name: "fstatSync",
      target: dir => join(dir, "file.txt"),
      snippet: target => `
        const fs = require("node:fs");
        const fd = fs.openSync(${JSON.stringify(target)}, "r");
        try {
          const s = fs.fstatSync(fd);
          console.log(JSON.stringify({ size: s.size, isFile: s.isFile(), isSymbolicLink: s.isSymbolicLink() }));
        } finally { fs.closeSync(fd); }
      `,
      expected: JSON.stringify({ size: 5, isFile: true, isSymbolicLink: false }),
    },
  ];

  for (const c of cases) {
    test(`${c.name} succeeds when statx is blocked by seccomp`, async () => {
      if (helperBin == null) {
        // bun:test has no runtime-skip; log loudly so CI output distinguishes
        // this from a real pass. Happens when cc or the seccomp headers are
        // missing on the test host.
        console.warn(`SKIP fs.${c.name} seccomp: cc or seccomp headers not available`);
        return;
      }

      await using targetDir = tempDir("stat-seccomp-target", { "file.txt": "hello" });
      // symlink created here rather than via tempDirWithFiles (which only
      // supports regular files).
      symlinkSync("file.txt", join(targetDir, "link.txt"));

      const out = await runUnderSeccomp(helperBin, EPERM, c.snippet(c.target(targetDir)));
      if (out == null) {
        console.warn(`SKIP fs.${c.name} seccomp: seccomp not permitted in this environment`);
        return;
      }

      // Don't assert empty stderr — ASAN builds emit a startup warning
      // there. exitCode is the crash/failure signal.
      expect(out.stdout.trim()).toBe(c.expected);
      expect(out.exitCode).toBe(0);
    });
  }
});

// The kernel is not bound to the errno table bun knows: FUSE filesystems and
// some drivers return codes above EHWPOISON (133). fs.fsyncSync decodes the
// errno through SystemErrno::from_raw; a code outside the table must report
// as EUNKNOWN instead of becoming an invalid enum value (a debug build used
// to die on an assertion there).
describe.skipIf(!isLinux)("node:fs errno outside the SystemErrno table", () => {
  const helperBin = tryBuildHelper("__NR_fsync");

  const snippet = `
    const fs = require("node:fs");
    const fd = fs.openSync(process.argv[1], "r");
    try {
      fs.fsyncSync(fd);
      console.log(JSON.stringify({ threw: false }));
    } catch (e) {
      console.log(JSON.stringify({ threw: true, errno: e.errno, code: e.code, syscall: e.syscall, message: e.message }));
    }
  `;

  // fs.fsyncSync in a bun subprocess whose fsync(2) fails with `errno`.
  // Returns the parsed result line, or null on an environment skip.
  async function fsyncWithErrno(errno: number) {
    if (helperBin == null) {
      console.warn("SKIP fsync seccomp: cc or seccomp headers not available");
      return null;
    }
    using dir = tempDir("fsync-seccomp-target", { "file.txt": "hello" });
    const out = await runUnderSeccomp(helperBin, errno, snippet, [join(String(dir), "file.txt")]);
    if (out == null) {
      console.warn("SKIP fsync seccomp: seccomp not permitted in this environment");
      return null;
    }
    // Don't assert empty stderr — ASAN builds emit a startup warning there.
    expect({ stdout: out.stdout.trim(), exitCode: out.exitCode }).toEqual({
      stdout: expect.stringContaining('{"threw":true'),
      exitCode: 0,
    });
    return JSON.parse(out.stdout.trim());
  }

  test.concurrent("a code above the table reports EUNKNOWN", async () => {
    const result = await fsyncWithErrno(ENOTSUPP);
    if (result == null) return;
    expect(result).toEqual({
      threw: true,
      errno: expect.any(Number),
      code: "EUNKNOWN",
      syscall: "fsync",
      message: "EUNKNOWN: unknown error, fsync",
    });
    expect(result.errno).toBeLessThan(0);
  });

  test.concurrent("a code in the table keeps its name", async () => {
    const result = await fsyncWithErrno(EACCES);
    if (result == null) return;
    expect(result).toEqual({
      threw: true,
      errno: -EACCES,
      code: "EACCES",
      syscall: "fsync",
      message: "EACCES: permission denied, fsync",
    });
  });
});
