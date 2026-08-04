// The resolver opens a directory and then iterates it via getdents64. When the
// open succeeds but iteration fails, and the resolver was asked to cache the
// fd (store_fd, set by bun test / --hot / --watch / install), the fd must be
// closed on that error path. The guard that closes it used to be gated on the
// "don't store" condition, so a store_fd run leaked one directory fd per
// failed read.
//
// getdents64 is reached through libc's variadic syscall(), so an LD_PRELOAD
// shim can make it fail with EIO for fds whose /proc/self/fd target contains a
// marker string. The inner process runs under --hot (store_fd=true), resolves
// one path per marker directory, then counts open fds that still point at a
// marker directory.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, isMusl, tempDir } from "harness";
import { join } from "node:path";

const cc = Bun.which("cc") || Bun.which("gcc") || Bun.which("clang");
const DIR_COUNT = 16;
const MARKER = "__FAIL_GETDENTS__";

const SHIM_C = /* c */ `
#define _GNU_SOURCE
#include <dlfcn.h>
#include <errno.h>
#include <stdarg.h>
#include <stdio.h>
#include <string.h>
#include <unistd.h>
#include <sys/syscall.h>

static long (*real_syscall)(long, long, long, long, long, long, long);

long syscall(long number, ...) {
  va_list ap;
  long a, b, c, d, e, f;
  va_start(ap, number);
  a = va_arg(ap, long); b = va_arg(ap, long); c = va_arg(ap, long);
  d = va_arg(ap, long); e = va_arg(ap, long); f = va_arg(ap, long);
  va_end(ap);
  if (!real_syscall)
    real_syscall = (long (*)(long, long, long, long, long, long, long))dlsym(RTLD_NEXT, "syscall");
  if (number == SYS_getdents64) {
    char link[64], target[4096];
    snprintf(link, sizeof link, "/proc/self/fd/%ld", a);
    ssize_t n = readlink(link, target, sizeof(target) - 1);
    if (n > 0) {
      target[n] = 0;
      if (strstr(target, "${MARKER}")) {
        errno = EIO;
        return -1;
      }
    }
  }
  return real_syscall(number, a, b, c, d, e, f);
}
`;

const INNER = /* ts */ `
import { readdirSync, readlinkSync } from "node:fs";
const N = ${DIR_COUNT};
let failed = 0;
for (let i = 0; i < N; i++) {
  try {
    require.resolve("./d" + i + "${MARKER}/m.ts");
  } catch {
    failed++;
  }
}
let leaked = 0;
for (const name of readdirSync("/proc/self/fd")) {
  try {
    const target = readlinkSync("/proc/self/fd/" + name);
    if (target.includes("${MARKER}")) leaked++;
  } catch {}
}
console.log("FAILED=" + failed + " LEAKED=" + leaked);
process.exit(0);
`;

let dir: ReturnType<typeof tempDir>;
let shimPath: string;

beforeAll(async () => {
  if (!isLinux || isMusl || !cc) return;
  const files: Record<string, string> = {
    "shim.c": SHIM_C,
    "inner.ts": INNER,
    "package.json": "{}",
  };
  for (let i = 0; i < DIR_COUNT; i++) files[`d${i}${MARKER}/m.ts`] = `export {};\n`;
  dir = tempDir("resolver-readdir-fail-leak", files);
  shimPath = join(String(dir), "shim.so");
  await using ccProc = Bun.spawn({
    cmd: [cc, "-shared", "-fPIC", "-o", shimPath, join(String(dir), "shim.c"), "-ldl"],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [ccOut, ccErr, ccExit] = await Promise.all([ccProc.stdout.text(), ccProc.stderr.text(), ccProc.exited]);
  if (ccExit !== 0) throw new Error(`shim compile failed: ${ccErr || ccOut}`);
});

afterAll(() => {
  dir?.[Symbol.dispose]();
});

// LD_PRELOAD interposition requires a dynamic libc; the musl build links libc
// statically, so the shim cannot intercept syscall() there.
const skip = !isLinux || isMusl || !cc;

function shimEnv() {
  const existing = bunEnv.LD_PRELOAD;
  return { ...bunEnv, LD_PRELOAD: existing ? `${shimPath}:${existing}` : shimPath };
}

test.skipIf(skip)(
  "resolver closes the directory fd when readdir fails after a successful open (store_fd, fresh handle)",
  async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "--hot", "inner.ts"],
      cwd: String(dir),
      env: shimEnv(),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    // FAILED=DIR_COUNT proves the shim actually fired; if bun stops routing
    // getdents64 through libc's syscall() the resolves succeed and this trips.
    expect({ stdout: stdout.trim(), stderr, exitCode }).toEqual({
      stdout: `FAILED=${DIR_COUNT} LEAKED=0`,
      stderr: "",
      exitCode: 0,
    });
  },
);

// The `bun test` scanner opens each subdirectory itself and hands the fd to
// read_directory_with_iterator(Some(fd)), which is the had_handle=true arm of
// the same guard. The scanner's Dir guard is disarmed via into_raw(), so the
// function owns the fd on that path too.
test.skipIf(skip)("resolver closes a caller-supplied directory fd when readdir fails (bun test scanner)", async () => {
  const files: Record<string, string> = {
    "package.json": "{}",
    "count.test.ts": /* ts */ `
        import { test } from "bun:test";
        import { readdirSync, readlinkSync } from "node:fs";
        test("count", () => {
          let leaked = 0;
          for (const name of readdirSync("/proc/self/fd")) {
            try {
              if (readlinkSync("/proc/self/fd/" + name).includes("${MARKER}")) leaked++;
            } catch {}
          }
          console.log("LEAKED=" + leaked);
        });
      `,
  };
  for (let i = 0; i < DIR_COUNT; i++)
    files[`d${i}${MARKER}/unreachable.test.ts`] =
      `import { test } from "bun:test"; test("unreachable-marker", () => {});`;
  using scanDir = tempDir("resolver-readdir-scanner-leak", files);
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "."],
    cwd: String(scanDir),
    env: shimEnv(),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const m = stdout.match(/LEAKED=(\d+)/);
  // unreachable-marker stays undiscovered iff the shim made the marker dirs
  // unreadable; if bun stops routing getdents64 through libc syscall() this trips.
  expect({
    leaked: m?.[0],
    shimFired: !stderr.includes("unreachable-marker"),
    onePass: stderr.includes("1 pass"),
    exitCode,
  }).toEqual({
    leaked: "LEAKED=0",
    shimFired: true,
    onePass: true,
    exitCode: 0,
  });
});
