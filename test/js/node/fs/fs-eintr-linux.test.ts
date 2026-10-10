// On an interruptible filesystem (NFS, CIFS, FUSE) a signal that arrives
// during getdents64(2) makes it return EINTR and no entries. Node never
// reports that: libuv runs an fs request again on EINTR. fs-eintr-darwin.test.ts
// covers the same rule on macOS. A signal cannot be aimed at one syscall of a
// directory read, so LD_PRELOAD a shim that fails one getdents64 of a marked
// directory with EINTR: the first read ("eintr-first-*") or the read that
// reports the end of the directory ("eintr-second-*"). The shim leaves a
// "<dir>.interrupted" file as proof that it did. bun issues getdents64 through
// libc's syscall(), the interposable symbol on this path, so this is
// glibc-only. readdir and opendir read with the node:fs iterator, Bun.Glob
// with the bun_sys one.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isGlibc, tempDir } from "harness";
import { join } from "node:path";

const cc = Bun.which("cc") || Bun.which("gcc") || Bun.which("clang");

test.skipIf(!isGlibc || !cc)("a directory read that a signal interrupts is read again", async () => {
  using dir = tempDir("readdir-eintr", {
    "shim.c": `
#define _GNU_SOURCE
#include <dlfcn.h>
#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <pthread.h>
#include <stdarg.h>
#include <stdio.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/syscall.h>
#include <unistd.h>

static long (*next_syscall)(long, ...);
static pthread_mutex_t lock = PTHREAD_MUTEX_INITIALIZER;
// Reads seen so far of each marked directory, by inode.
static struct { ino_t ino; int reads; } seen[64];
static int nseen;

static int reads_before_this_one(ino_t ino) {
  pthread_mutex_lock(&lock);
  int i = 0;
  while (i < nseen && seen[i].ino != ino) i++;
  if (i == nseen && nseen < 64) seen[nseen++].ino = ino;
  int n = i < 64 ? seen[i].reads++ : INT_MAX;
  pthread_mutex_unlock(&lock);
  return n;
}

long syscall(long nr, ...) {
  va_list ap;
  va_start(ap, nr);
  long a1 = va_arg(ap, long), a2 = va_arg(ap, long), a3 = va_arg(ap, long);
  long a4 = va_arg(ap, long), a5 = va_arg(ap, long), a6 = va_arg(ap, long);
  va_end(ap);
  if (!next_syscall) next_syscall = dlsym(RTLD_NEXT, "syscall");
  if (nr == SYS_getdents64) {
    int fd = (int)a1;
    char link[64], target[PATH_MAX], marker[PATH_MAX + 16];
    snprintf(link, sizeof link, "/proc/self/fd/%d", fd);
    ssize_t n = readlink(link, target, sizeof target - 1);
    struct stat st;
    if (n > 0 && fstat(fd, &st) == 0) {
      target[n] = 0;
      const char *base = strrchr(target, '/');
      base = base ? base + 1 : target;
      int fail_at = strncmp(base, "eintr-first-", 12) == 0 ? 0 : strncmp(base, "eintr-second-", 13) == 0 ? 1 : -1;
      if (fail_at >= 0 && reads_before_this_one(st.st_ino) == fail_at) {
        snprintf(marker, sizeof marker, "%s.interrupted", target);
        close(open(marker, O_CREAT | O_WRONLY, 0644));
        errno = EINTR;
        return -1;
      }
    }
  }
  return next_syscall(nr, a1, a2, a3, a4, a5, a6);
}
`,
  });

  const soPath = join(String(dir), "shim.so");
  const compile = Bun.spawnSync({
    cmd: [cc!, "-shared", "-fPIC", "-o", soPath, join(String(dir), "shim.c"), "-ldl"],
    env: bunEnv,
  });
  if (compile.exitCode !== 0) {
    throw new Error(`Failed to build getdents64 EINTR shim:\n${compile.stderr.toString()}`);
  }

  const existing = bunEnv.LD_PRELOAD;
  await using proc = Bun.spawn({
    cmd: [bunExe(), join(import.meta.dir, "fs-eintr-readdir-fixture.ts")],
    env: { ...bunEnv, LD_PRELOAD: existing ? `${soPath}:${existing}` : soPath },
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");

  // `interrupted` proves that the shim failed one read of that directory.
  const read = { entries: ["a.txt", "b.txt", "c.txt"], interrupted: true };
  const rows = { readdirSync: read, readdir: read, opendirSync: read, glob: read };
  expect(JSON.parse(stdout)).toEqual({ first: rows, second: rows });
  expect(exitCode).toBe(0);
});
