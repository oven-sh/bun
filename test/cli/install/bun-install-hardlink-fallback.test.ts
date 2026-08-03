// FUSE-backed filesystems (e.g. Android's SDCARD in Termux) do not support
// hard links and fail linkat with EACCES or EPERM instead of EXDEV. The
// hardlink install backend must fall back to copying files, like it already
// does for EXDEV. https://github.com/oven-sh/bun/issues/36852
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, tempDir } from "harness";
import { cpSync } from "node:fs";
import { join } from "node:path";

const cc = Bun.which("cc") || Bun.which("gcc") || Bun.which("clang");

const SHIM_C = /* c */ `
#define _GNU_SOURCE
#include <errno.h>

int linkat(int olddirfd, const char *oldpath, int newdirfd, const char *newpath,
           int flags) {
  (void)olddirfd; (void)oldpath; (void)newdirfd; (void)newpath; (void)flags;
  errno = EACCES;
  return -1;
}

int link(const char *oldpath, const char *newpath) {
  (void)oldpath; (void)newpath;
  errno = EACCES;
  return -1;
}
`;

test.skipIf(!isLinux || !cc)("bun install falls back to copyfile when linkat fails with EACCES", async () => {
  using dir = tempDir("hardlink-eacces-fallback", {
    "shim.c": SHIM_C,
    "package.json": JSON.stringify({
      name: "hardlink-eacces-fallback",
      dependencies: { bar: "file:./bar-0.0.2.tgz" },
    }),
  });
  cpSync(join(import.meta.dir, "bar-0.0.2.tgz"), join(String(dir), "bar-0.0.2.tgz"));

  {
    await using compile = Bun.spawn({
      cmd: [cc!, "-shared", "-fPIC", "-o", "shim.so", "shim.c"],
      cwd: String(dir),
      env: bunEnv,
      stderr: "pipe",
    });
    expect(await compile.stderr.text()).toBe("");
    expect(await compile.exited).toBe(0);
  }

  await using proc = Bun.spawn({
    cmd: [bunExe(), "install"],
    cwd: String(dir),
    env: {
      ...bunEnv,
      BUN_INSTALL_CACHE_DIR: join(String(dir), "cache"),
      LD_PRELOAD: join(String(dir), "shim.so"),
    },
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).not.toContain("EACCES");
  expect(stdout).toContain("1 package installed");
  expect(exitCode).toBe(0);
  expect(await Bun.file(join(String(dir), "node_modules", "bar", "package.json")).json()).toMatchObject({
    name: "bar",
    version: "0.0.2",
  });
});
