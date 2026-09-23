import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isLinux, tempDir, tempDirWithFiles } from "harness";
import { spawnSync } from "node:child_process";
import { existsSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";

// Seccomp helper: installs a filter that makes one syscall (`BLOCK_SYSCALL`,
// a `-D` define) fail with the errno given in argv[1], then execs argv[2..].
// With `-DBLOCK_ARG1=value` only calls whose second argument is `value` fail.
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
#include <sys/resource.h>
#include <sys/syscall.h>
#include <unistd.h>

#if defined(__x86_64__)
  #define MY_AUDIT_ARCH AUDIT_ARCH_X86_64
#elif defined(__aarch64__)
  #define MY_AUDIT_ARCH AUDIT_ARCH_AARCH64
#else
  #define MY_AUDIT_ARCH 0
#endif

/* Linux 5.8; the same number on every architecture. */
#ifndef __NR_faccessat2
  #define __NR_faccessat2 439
#endif

/* instructions between the syscall-nr test and the errno return */
#ifdef BLOCK_ARG1
  #define ARG1_TEST_LEN 2
#else
  #define ARG1_TEST_LEN 0
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
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, BLOCK_SYSCALL, 0, 1 + ARG1_TEST_LEN),
#ifdef BLOCK_ARG1
    /* ... but only if the low word of args[1] == BLOCK_ARG1 (little-endian) */
    BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[1])),
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, BLOCK_ARG1, 0, 1),
#endif
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
const EINVAL = 22;
const ENOSYS = 38;
// Driver-internal code that leaks to userspace; above EHWPOISON (133), the
// last errno bun's SystemErrno table declares.
const ENOTSUPP = 524;

// Compile the seccomp helper for one syscall (and, with `arg1`, one value of
// its second argument). Returns the binary path, or null if the host
// genuinely can't build it (no cc, missing kernel headers). Any other compile
// failure throws so a source regression isn't silently hidden as a skip.
function tryBuildHelper(syscall: string, arg1?: string): string | null {
  const dir = tempDirWithFiles("seccomp-helper", {
    "block.c": helperSrc,
  });
  const src = join(dir, "block.c");
  const bin = join(dir, "block");
  const defines = [`-DBLOCK_SYSCALL=${syscall}`];
  if (arg1 !== undefined) defines.push(`-DBLOCK_ARG1=${arg1}`);
  const compile = spawnSync("cc", ["-O0", ...defines, "-o", bin, src], { stdio: "pipe" });

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

// Run `bun argv...` under the seccomp helper, with the blocked syscall failing
// with `errno`. Returns { stdout, stderr, exitCode } on success, or null if
// the environment refused to install the seccomp filter (skip).
async function runBunUnderSeccomp(
  bin: string,
  errno: number,
  argv: string[],
  options: { cwd?: string; env?: Record<string, string | undefined> } = {},
) {
  await using proc = Bun.spawn({
    cmd: [bin, String(errno), bunExe(), ...argv],
    env: options.env ?? bunEnv,
    cwd: options.cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  if (exitCode === 77) return null;
  return { stdout, stderr, exitCode };
}

// Run `bun -e snippet args...` under the seccomp helper.
function runUnderSeccomp(bin: string, errno: number, snippet: string, args: string[] = []) {
  return runBunUnderSeccomp(bin, errno, ["-e", snippet, ...args]);
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

  // `struct stat` has no birthtime. libuv (so node) reports ctime for it when
  // statx is unavailable (a kernel older than 4.11, or a seccomp profile
  // written before the call existed). The first call goes through the statx
  // fallback, the later ones skip statx altogether.
  const birthtimeSnippet = `
    const fs = require("node:fs");
    const path = process.argv[1];
    const fd = fs.openSync(path, "r");
    const stats = {
      statSync: fs.statSync(path),
      lstatSync: fs.lstatSync(path),
      fstatSync: fs.fstatSync(fd),
      bigint: fs.statSync(path, { bigint: true }),
      promises: await fs.promises.stat(path),
    };
    fs.closeSync(fd);
    const result = {};
    for (const [name, s] of Object.entries(stats)) {
      result[name] = s.birthtimeMs === s.ctimeMs ? "ctime" : Number(s.birthtimeMs) === 0 ? "epoch" : "other";
    }
    console.log(JSON.stringify(result));
  `;

  for (const [name, errno] of [
    ["ENOSYS", ENOSYS],
    ["EPERM", EPERM],
    ["EINVAL", EINVAL],
  ] as const) {
    test.concurrent(`birthtime is ctime when statx fails with ${name}`, async () => {
      if (helperBin == null) {
        console.warn("SKIP birthtime seccomp: cc or seccomp headers not available");
        return;
      }
      using targetDir = tempDir("stat-seccomp-birthtime", { "file.txt": "hello" });
      const out = await runUnderSeccomp(helperBin, errno, birthtimeSnippet, [join(String(targetDir), "file.txt")]);
      if (out == null) {
        console.warn("SKIP birthtime seccomp: seccomp not permitted in this environment");
        return;
      }
      expect({ stdout: out.stdout.trim(), exitCode: out.exitCode }).toEqual({
        stdout: JSON.stringify({
          statSync: "ctime",
          lstatSync: "ctime",
          fstatSync: "ctime",
          bigint: "ctime",
          promises: "ctime",
        }),
        exitCode: 0,
      });
    });
  }
});

// glibc 2.33+ faccessat() issues faccessat2 first, even with no flags, and
// falls back to faccessat on ENOSYS only. When a seccomp filter answers
// faccessat2 with EPERM or EINVAL, every "does this exist" check made through
// the libc wrapper says no: a hoisted install could not see a package that
// was in the cache. bun 1.3 made the flag-less syscall itself and passed.
describe.skipIf(!isLinux)("bun install when faccessat2 is blocked by seccomp", () => {
  const helperBin = tryBuildHelper("__NR_faccessat2");

  for (const [name, errno] of [
    ["EPERM", EPERM],
    ["EINVAL", EINVAL],
  ] as const) {
    test.concurrent(`hoisted install finds a package in a warm cache (${name})`, async () => {
      if (helperBin == null) {
        console.warn("SKIP faccessat2 seccomp: cc or seccomp headers not available");
        return;
      }

      const tarball = await new Bun.Archive(
        {
          "package/package.json": JSON.stringify({ name: "dep", version: "1.0.0" }),
          "package/index.js": "module.exports = 1;",
        },
        { compress: "gzip" },
      ).bytes();
      await using registry = Bun.serve({
        port: 0,
        fetch(request) {
          const { origin, pathname } = new URL(request.url);
          if (pathname === "/dep-1.0.0.tgz") return new Response(tarball);
          if (pathname !== "/dep") return new Response("not found", { status: 404 });
          return Response.json({
            name: "dep",
            "dist-tags": { latest: "1.0.0" },
            versions: { "1.0.0": { name: "dep", version: "1.0.0", dist: { tarball: `${origin}/dep-1.0.0.tgz` } } },
          });
        },
      });

      using dir = tempDir("faccessat2-seccomp", {
        "package.json": JSON.stringify({ name: "app", version: "1.0.0", dependencies: { dep: "1.0.0" } }),
        "bunfig.toml": `[install]\nregistry = "${registry.url.href}"\nlinker = "hoisted"\n`,
      });
      const cwd = String(dir);
      const env = { ...bunEnv, BUN_INSTALL_CACHE_DIR: join(cwd, ".bun-cache") };
      const installed = join(cwd, "node_modules", "dep", "package.json");

      // Cold: downloads and extracts into the cache.
      const cold = await runBunUnderSeccomp(helperBin, errno, ["install"], { cwd, env });
      if (cold == null) {
        console.warn("SKIP faccessat2 seccomp: seccomp not permitted in this environment");
        return;
      }
      expect({ stderr: cold.stderr, installed: existsSync(installed), exitCode: cold.exitCode }).toEqual({
        stderr: expect.not.stringContaining("error:"),
        installed: true,
        exitCode: 0,
      });

      // Warm: node_modules is gone, the package is in the cache.
      rmSync(join(cwd, "node_modules"), { recursive: true, force: true });
      const warm = await runBunUnderSeccomp(helperBin, errno, ["install"], { cwd, env });
      expect({ stderr: warm!.stderr, installed: existsSync(installed), exitCode: warm!.exitCode }).toEqual({
        stderr: expect.not.stringContaining("error:"),
        installed: true,
        exitCode: 0,
      });
    });
  }
});

// glibc implements getrlimit() with prlimit64. bun raises RLIMIT_NOFILE at
// startup and used to panic ("unreachable: Sys(EPERM)") when it could not read
// the limit. Node ignores that failure. This filter matches RLIMIT_NOFILE
// only, so that JavaScriptCore and the ASAN runtime can still read
// RLIMIT_STACK. The next block denies the whole syscall.
describe.skipIf(!isLinux)("startup when getrlimit(RLIMIT_NOFILE) fails", () => {
  const helperBin = tryBuildHelper("__NR_prlimit64", "RLIMIT_NOFILE");

  for (const [name, errno] of [
    ["ENOSYS", ENOSYS],
    ["EPERM", EPERM],
  ] as const) {
    test.concurrent(`bun runs a script (${name})`, async () => {
      if (helperBin == null) {
        console.warn("SKIP prlimit64 seccomp: cc or seccomp headers not available");
        return;
      }
      // The relative import makes the resolver read the directory, which is
      // where the fd budget from RLIMIT_NOFILE is used.
      using dir = tempDir("prlimit64-seccomp", {
        "index.js": `import { message } from "./message.js";\nconsole.log(message);`,
        "message.js": `export const message = "bun ok";`,
      });
      const out = await runBunUnderSeccomp(helperBin, errno, ["index.js"], { cwd: String(dir) });
      if (out == null) {
        console.warn("SKIP prlimit64 seccomp: seccomp not permitted in this environment");
        return;
      }
      expect({ stdout: out.stdout.trim(), exitCode: out.exitCode }).toEqual({ stdout: "bun ok", exitCode: 0 });
    });
  }

  // It used to print whatever was in the uninitialized struct rlimit.
  test.concurrent("process.report leaves out the limit it cannot read, like node", async () => {
    if (helperBin == null) {
      console.warn("SKIP prlimit64 seccomp: cc or seccomp headers not available");
      return;
    }
    const out = await runUnderSeccomp(
      helperBin,
      EPERM,
      `const { userLimits } = process.report.getReport();
       console.log(JSON.stringify({ open_files: "open_files" in userLimits, stack_size_bytes: "stack_size_bytes" in userLimits }));`,
    );
    if (out == null) {
      console.warn("SKIP prlimit64 seccomp: seccomp not permitted in this environment");
      return;
    }
    expect({ stdout: out.stdout.trim(), exitCode: out.exitCode }).toEqual({
      stdout: JSON.stringify({ open_files: false, stack_size_bytes: true }),
      exitCode: 0,
    });
  });
});

// With the whole syscall denied, JavaScriptCore still cannot start: glibc's
// pthread_getattr_np needs getrlimit(RLIMIT_STACK) to tell it the main
// thread's stack bounds. Commands that do not run JavaScript work. Not under
// ASAN: its runtime aborts on its own when getrlimit fails.
describe.skipIf(!isLinux || isASAN)("bun build when prlimit64 is blocked by seccomp", () => {
  const helperBin = tryBuildHelper("__NR_prlimit64");

  for (const [name, errno] of [
    ["ENOSYS", ENOSYS],
    ["EPERM", EPERM],
  ] as const) {
    test.concurrent(`bundles a file (${name})`, async () => {
      if (helperBin == null) {
        console.warn("SKIP prlimit64 seccomp: cc or seccomp headers not available");
        return;
      }
      using dir = tempDir("prlimit64-seccomp-build", {
        "index.js": `import { message } from "./message.js";\nconsole.log(message);`,
        "message.js": `export const message = "bun ok";`,
      });
      const cwd = String(dir);
      const out = await runBunUnderSeccomp(helperBin, errno, ["build", "index.js", "--outfile=out.js"], { cwd });
      if (out == null) {
        console.warn("SKIP prlimit64 seccomp: seccomp not permitted in this environment");
        return;
      }
      expect({ built: existsSync(join(cwd, "out.js")), exitCode: out.exitCode }).toEqual({
        built: true,
        exitCode: 0,
      });
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
