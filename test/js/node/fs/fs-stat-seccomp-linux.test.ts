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
async function runUnderSeccomp(
  bin: string,
  errno: number,
  snippet: string,
  args: string[] = [],
  env: Record<string, string> = {},
) {
  await using proc = Bun.spawn({
    cmd: [bin, String(errno), bunExe(), "-e", snippet, ...args],
    env: { ...bunEnv, ...env },
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

// The kernel is not bound to the errno table bun knows: a FUSE daemon can reply
// with any code below 512, and in-kernel drivers leak codes above that
// (ENOTSUPP, 524, from copy_file_range for one). Such a code must reach JS as
// node reports it, `errno` = the negated kernel number, with the `code` string
// bun uses for an unmapped errno (EUNKNOWN), on every native error path: the
// node:fs helpers that decode a return value through `GetErrno` (fsync,
// copyFile), the `bun_sys` wrappers that read the thread-local errno
// (ftruncate), and the Bun.write file-to-file copy loop.
describe.skipIf(!isLinux)("node:fs errno outside the SystemErrno table", () => {
  // One helper binary per blocked syscall; a case names the syscall it blocks.
  const helpers = new Map<string, string | null>();
  const helperFor = (blocked: string) => {
    if (!helpers.has(blocked)) helpers.set(blocked, tryBuildHelper(blocked));
    return helpers.get(blocked)!;
  };

  // Each snippet runs `bun -e` with argv[1] = an existing file; the copy cases
  // write argv[1] + ".copy". The result line is one JSON object.
  const report = `console.log(JSON.stringify({ threw: true, errno: e.errno, code: e.code, syscall: e.syscall, message: e.message }))`;
  // On a reflink-capable tmpdir (btrfs, XFS) fs.copyFile clones the file with
  // ioctl(FICLONE) and never reaches copy_file_range; turn that fast path off
  // so the blocked syscall is the one that runs.
  const noReflink = { BUN_CONFIG_DISABLE_ioctl_ficlonerange: "1" };
  const cases = [
    {
      name: "fs.fsyncSync",
      blocked: "__NR_fsync",
      syscall: "fsync",
      env: {},
      message: (_src: string) => "",
      snippet: `
        import * as fs from "node:fs";
        const fd = fs.openSync(process.argv[1], "r+");
        try { fs.fsyncSync(fd); console.log(JSON.stringify({ threw: false })); } catch (e) { ${report}; }
      `,
    },
    {
      name: "fs.ftruncateSync",
      blocked: "__NR_ftruncate",
      syscall: "ftruncate",
      env: {},
      message: (_src: string) => "",
      snippet: `
        import * as fs from "node:fs";
        const fd = fs.openSync(process.argv[1], "r+");
        try { fs.ftruncateSync(fd, 0); console.log(JSON.stringify({ threw: false })); } catch (e) { ${report}; }
      `,
    },
    {
      name: "fs.copyFileSync",
      blocked: "__NR_copy_file_range",
      syscall: "copyfile",
      env: noReflink,
      message: (src: string) => ` '${src}' -> '${src}.copy'`,
      snippet: `
        import * as fs from "node:fs";
        try { fs.copyFileSync(process.argv[1], process.argv[1] + ".copy"); console.log(JSON.stringify({ threw: false })); } catch (e) { ${report}; }
      `,
    },
    {
      name: "Bun.write(Bun.file, Bun.file)",
      blocked: "__NR_copy_file_range",
      syscall: "copy_file_range",
      env: noReflink,
      message: (_src: string) => "",
      snippet: `
        try { await Bun.write(Bun.file(process.argv[1] + ".copy"), Bun.file(process.argv[1])); console.log(JSON.stringify({ threw: false })); } catch (e) { ${report}; }
      `,
    },
  ];

  // Runs the case in a bun subprocess whose blocked syscall fails with `errno`.
  // Returns the parsed result line and the source path, or null on an
  // environment skip.
  async function callWithErrno(c: (typeof cases)[number], errno: number) {
    const helperBin = helperFor(c.blocked);
    if (helperBin == null) {
      console.warn(`SKIP ${c.name} seccomp: cc or seccomp headers not available`);
      return null;
    }
    using dir = tempDir("errno-seccomp-target", { "file.txt": "hello" });
    const src = join(String(dir), "file.txt");
    const out = await runUnderSeccomp(helperBin, errno, c.snippet, [src], c.env);
    if (out == null) {
      console.warn(`SKIP ${c.name} seccomp: seccomp not permitted in this environment`);
      return null;
    }
    // Don't assert empty stderr — ASAN builds emit a startup warning there.
    expect({ stdout: out.stdout.trim(), exitCode: out.exitCode }).toEqual({
      stdout: expect.stringContaining('{"threw":true'),
      exitCode: 0,
    });
    return { result: JSON.parse(out.stdout.trim()), src };
  }

  describe.each(cases)("$name", c => {
    test.concurrent("a code above the table keeps its number and reports EUNKNOWN", async () => {
      const out = await callWithErrno(c, ENOTSUPP);
      if (out == null) return;
      expect(out.result).toEqual({
        threw: true,
        errno: -ENOTSUPP,
        code: "EUNKNOWN",
        syscall: c.syscall,
        message: `EUNKNOWN: unknown error, ${c.syscall}${c.message(out.src)}`,
      });
    });

    test.concurrent("a code in the table keeps its name", async () => {
      const out = await callWithErrno(c, EACCES);
      if (out == null) return;
      expect(out.result).toEqual({
        threw: true,
        errno: -EACCES,
        code: "EACCES",
        syscall: c.syscall,
        message: `EACCES: permission denied, ${c.syscall}${c.message(out.src)}`,
      });
    });
  });
});
