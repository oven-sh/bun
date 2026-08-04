// RealFS::kind() opens a symlink's target, then fstat()s and reads the fd's
// realpath. When the resolver was asked to cache the fd (store_fd, set by
// --hot / --watch), the cleanup guard wrote the fd into a stack-local
// EntryCache instead of closing it. On the success path that EntryCache is
// returned and the fd reaches the resolver's Entry cache; on the error path
// the EntryCache is dropped and the fd leaks.
//
// On Linux the realpath step is readlink("/proc/self/fd/N"), called through
// libc, so an LD_PRELOAD shim can make it fail with EIO for fds whose target
// contains a marker string. The inner process runs under --hot (store_fd=true),
// resolves one symlink per target, then counts open fds that still point at a
// marker target.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, isMusl, tempDir } from "harness";
import { symlinkSync } from "node:fs";
import { join } from "node:path";

const cc = Bun.which("cc") || Bun.which("gcc") || Bun.which("clang");
const LINK_COUNT = 16;
const MARKER = "__KIND_FAIL__";

const SHIM_C = /* c */ `
#define _GNU_SOURCE
#include <dlfcn.h>
#include <errno.h>
#include <string.h>
#include <stdlib.h>
#include <unistd.h>

static ssize_t (*real_readlink)(const char *, char *, size_t);
static const char *off_path;

__attribute__((constructor)) static void init(void) {
  real_readlink = (ssize_t (*)(const char *, char *, size_t))dlsym(RTLD_NEXT, "readlink");
  off_path = getenv("SHIM_OFF_PATH");
}

ssize_t readlink(const char *path, char *buf, size_t bufsiz) {
  if (!real_readlink)
    real_readlink = (ssize_t (*)(const char *, char *, size_t))dlsym(RTLD_NEXT, "readlink");
  ssize_t n = real_readlink(path, buf, bufsiz);
  if (n <= 0) return n;
  if (off_path && access(off_path, F_OK) == 0) return n;
  if (strncmp(path, "/proc/self/fd/", 14) != 0) return n;
  size_t m = (size_t)n < bufsiz ? (size_t)n : bufsiz - 1;
  char saved = buf[m];
  buf[m] = 0;
  int hit = strstr(buf, "${MARKER}") != NULL;
  buf[m] = saved;
  if (hit) { errno = EIO; return -1; }
  return n;
}
`;

const INNER = /* ts */ `
import { readdirSync, readlinkSync, writeFileSync } from "node:fs";
const N = ${LINK_COUNT};
let failed = 0;
for (let i = 0; i < N; i++) {
  try {
    require.resolve("./link" + i + ".js");
  } catch {
    failed++;
  }
}
// Disarm the shim so the leak count can readlink the fds it is counting.
writeFileSync(process.env.SHIM_OFF_PATH!, "");
let leaked = 0;
for (const name of readdirSync("/proc/self/fd")) {
  try {
    if (readlinkSync("/proc/self/fd/" + name).includes("${MARKER}")) leaked++;
  } catch {}
}
console.log("FAILED=" + failed + " LEAKED=" + leaked);
process.exit(0);
`;

let dir: ReturnType<typeof tempDir>;
let shimPath: string;
let offPath: string;

beforeAll(async () => {
  if (!isLinux || isMusl || !cc) return;
  const files: Record<string, string> = {
    "shim.c": SHIM_C,
    "inner.ts": INNER,
    "package.json": "{}",
  };
  for (let i = 0; i < LINK_COUNT; i++) files[`targets${MARKER}/t${i}.js`] = `export {};\n`;
  dir = tempDir("resolver-kind-fail-leak", files);
  for (let i = 0; i < LINK_COUNT; i++) {
    symlinkSync(join(String(dir), `targets${MARKER}`, `t${i}.js`), join(String(dir), `link${i}.js`));
  }
  shimPath = join(String(dir), "shim.so");
  offPath = join(String(dir), "SHIM_OFF");
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
// statically, so the shim cannot intercept readlink() there.
test.skipIf(!isLinux || isMusl || !cc)(
  "resolver closes the symlink-target fd when get_fd_path fails after a successful open (store_fd)",
  async () => {
    const existing = bunEnv.LD_PRELOAD;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "--hot", "inner.ts"],
      cwd: String(dir),
      env: {
        ...bunEnv,
        LD_PRELOAD: existing ? `${shimPath}:${existing}` : shimPath,
        SHIM_OFF_PATH: offPath,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    // FAILED=0: Entry::kind swallows the error and falls back to File, so the
    // resolves still succeed. If bun stops routing get_fd_path through libc
    // readlink() the shim goes inert and this test measures nothing; LEAKED=0
    // is the only load-bearing assertion.
    expect({ stdout: stdout.trim(), stderr, exitCode }).toEqual({
      stdout: `FAILED=0 LEAKED=0`,
      stderr: "",
      exitCode: 0,
    });
  },
);
