// A sandbox that emulates getdents64(2) can return a record with a bad length. A normal filesystem can't,
// so an LD_PRELOAD shim corrupts the buffer after the real syscall returns. The directory's name selects
// the kind of corruption.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, tempDir } from "harness";
import { join } from "node:path";

const cc = Bun.which("cc") || Bun.which("gcc") || Bun.which("clang");

const shim = /* c */ `
#define _GNU_SOURCE
#include <dlfcn.h>
#include <limits.h>
#include <stdarg.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <sys/syscall.h>
#include <unistd.h>

// struct linux_dirent64 { u64 d_ino; s64 d_off; u16 d_reclen; u8 d_type; char d_name[]; }
enum { RECLEN_OFFSET = 16, NAME_OFFSET = 19 };

static long reclen_of(const unsigned char *record) {
  uint16_t value;
  memcpy(&value, record + RECLEN_OFFSET, sizeof value);
  return value;
}

static void set_reclen(unsigned char *record, long to) {
  uint16_t value = (uint16_t)to;
  memcpy(record + RECLEN_OFFSET, &value, sizeof value);
}

static long (*next_syscall)(long, ...);

long syscall(long nr, ...) {
  va_list ap;
  va_start(ap, nr);
  long a1 = va_arg(ap, long), a2 = va_arg(ap, long), a3 = va_arg(ap, long);
  long a4 = va_arg(ap, long), a5 = va_arg(ap, long), a6 = va_arg(ap, long);
  va_end(ap);
  if (!next_syscall) next_syscall = dlsym(RTLD_NEXT, "syscall");
  long rc = next_syscall(nr, a1, a2, a3, a4, a5, a6);
  if (nr != SYS_getdents64 || rc <= 0) return rc;

  char link[64], path[PATH_MAX];
  snprintf(link, sizeof link, "/proc/self/fd/%d", (int)a1);
  ssize_t n = readlink(link, path, sizeof path - 1);
  if (n <= 0) return rc;
  path[n] = 0;
  const char *mode = strrchr(path, '/') + 1;

  unsigned char *buf = (unsigned char *)a2;
  unsigned char *last = buf;
  while (last + reclen_of(last) < buf + rc) last += reclen_of(last);

  if (strcmp(mode, "reclen-zero") == 0) set_reclen(buf, 0);
  if (strcmp(mode, "reclen-below-header") == 0) set_reclen(buf, 8);
  if (strcmp(mode, "reclen-past-end") == 0) set_reclen(buf, rc + 8);
  if (strcmp(mode, "second-record") == 0) set_reclen(buf + reclen_of(buf), 0);
  if (strcmp(mode, "name-unterminated") == 0) memset(last + NAME_OFFSET, 'x', reclen_of(last) - NAME_OFFSET);
  if (strcmp(mode, "header-cut") == 0) return (last - buf) + 10;
  if (strcmp(mode, "count-above-buffer") == 0) return a3 + 64;
  return rc;
}
`;

const fixture = /* js */ `
const fs = require("node:fs");
for (const mode of fs.readdirSync("read").sort()) {
  for (const list of [dir => fs.readdirSync(dir), dir => [...new Bun.Glob("*").scanSync({ cwd: dir })]]) {
    try {
      console.log(mode, list("read/" + mode).sort().join());
    } catch (e) {
      console.log(mode, e.code);
    }
  }
}
`;

const damaged = [
  "count-above-buffer",
  "header-cut",
  "name-unterminated",
  "reclen-below-header",
  "reclen-past-end",
  "reclen-zero",
  "second-record",
];

test.skipIf(!isLinux || !cc)("readdir and Bun.Glob fail with EIO on a malformed directory record", async () => {
  const tree: Record<string, string> = { "shim.c": shim, "fixture.js": fixture };
  for (const mode of [...damaged, "intact"]) {
    for (const file of ["a.txt", "b.txt", "c.txt"]) tree[`read/${mode}/${file}`] = "";
  }
  using dir = tempDir("readdir-malformed-dirent", tree);
  const shimPath = join(String(dir), "shim.so");
  await using compile = Bun.spawn({
    cmd: [cc!, "-shared", "-fPIC", "-o", shimPath, join(String(dir), "shim.c"), "-ldl"],
    env: bunEnv,
    stderr: "inherit",
  });
  expect(await compile.exited).toBe(0);

  await using proc = Bun.spawn({
    cmd: [bunExe(), "fixture.js"],
    cwd: String(dir),
    env: { ...bunEnv, LD_PRELOAD: [shimPath, bunEnv.LD_PRELOAD].filter(Boolean).join(":") },
    stdout: "pipe",
    stderr: "inherit",
  });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  // Each mode prints one line for node:fs and one for Bun.Glob, which use different directory walkers.
  const expected = [...damaged.map(mode => `${mode} EIO`), "intact a.txt,b.txt,c.txt"].sort();
  expect(stdout.trim().split("\n")).toEqual(expected.flatMap(line => [line, line]));
  expect(exitCode).toBe(0);
});
