// FUSE-backed filesystems (e.g. Android's SDCARD in Termux) do not support
// hard links and fail linkat with EACCES or EPERM instead of EXDEV. The
// hardlink install backend must fall back to copying files, like it already
// does for EXDEV. https://github.com/oven-sh/bun/issues/36852
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, isMusl, tempDir } from "harness";
import { cpSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const cc = Bun.which("cc") || Bun.which("gcc") || Bun.which("clang");

const shimC = (errno: string) => /* c */ `
#define _GNU_SOURCE
#include <errno.h>

int linkat(int olddirfd, const char *oldpath, int newdirfd, const char *newpath,
           int flags) {
  (void)olddirfd; (void)oldpath; (void)newdirfd; (void)newpath; (void)flags;
  errno = ${errno};
  return -1;
}

int link(const char *oldpath, const char *newpath) {
  (void)oldpath; (void)newpath;
  errno = ${errno};
  return -1;
}
`;

// bun-musl is statically linked, so LD_PRELOAD cannot intercept linkat.
describe.skipIf(!isLinux || isMusl || !cc)("hardlink backend falls back to copyfile", () => {
  for (const errno of ["EACCES", "EPERM"]) {
    for (const linker of ["hoisted", "isolated"]) {
      test.concurrent(`linkat fails with ${errno}, ${linker} linker`, async () => {
        using dir = tempDir(`hardlink-${errno}-${linker}`, {
          "shim.c": shimC(errno),
          "package.json": JSON.stringify({
            name: "hardlink-fallback-test",
            dependencies: { bar: "file:./bar-0.0.2.tgz", localdep: "file:./localdep" },
          }),
          "localdep/package.json": JSON.stringify({ name: "localdep", version: "1.2.3" }),
          "localdep/index.js": "module.exports = 1;",
        });
        cpSync(join(import.meta.dir, "bar-0.0.2.tgz"), join(String(dir), "bar-0.0.2.tgz"));

        {
          await using compile = Bun.spawn({
            cmd: [cc!, "-shared", "-fPIC", "-o", "shim.so", "shim.c"],
            cwd: String(dir),
            env: bunEnv,
            stdout: "pipe",
            stderr: "pipe",
          });
          const [compileOut, compileErr, compileExit] = await Promise.all([
            compile.stdout.text(),
            compile.stderr.text(),
            compile.exited,
          ]);
          if (compileExit !== 0) {
            throw new Error(`shim compile failed: ${compileOut}${compileErr}`);
          }
        }

        await using proc = Bun.spawn({
          cmd: [bunExe(), "install", "--backend", "hardlink", "--linker", linker],
          cwd: String(dir),
          env: {
            ...bunEnv,
            BUN_INSTALL_CACHE_DIR: join(String(dir), "cache"),
            LD_PRELOAD: [join(String(dir), "shim.so"), bunEnv.LD_PRELOAD].filter(Boolean).join(":"),
          },
          stderr: "pipe",
        });
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        expect(stderr).not.toContain(errno);
        expect(stdout).toMatch(/\d+ packages? installed/);
        expect(exitCode).toBe(0);
        const installed = join(String(dir), "node_modules", "bar", "package.json");
        expect(await Bun.file(installed).json()).toMatchObject({
          name: "bar",
          version: "0.0.2",
        });
        // A hardlink from the cache would have nlink >= 2; nlink === 1 proves
        // the copy fallback ran.
        expect(statSync(installed).nlink).toBe(1);

        // Folder dependencies take a separate path in the isolated linker
        // that reuses the folder's dir fd across the hardlink attempt and
        // the copy fallback; the contents must still be installed.
        const installedLocal = join(String(dir), "node_modules", "localdep", "package.json");
        expect(await Bun.file(installedLocal).json()).toMatchObject({
          name: "localdep",
          version: "1.2.3",
        });
        expect(statSync(installedLocal).nlink).toBe(1);
      });
    }
  }
});

// What the kernel does for a filesystem without symlinks: the path is looked up first.
const symlinkShimC = (errno: string) => /* c */ `
#define _GNU_SOURCE
#include <errno.h>
#include <libgen.h>
#include <string.h>
#include <sys/stat.h>

int symlink(const char *target, const char *linkpath) {
  (void)target;
  struct stat st;
  char parent[4096];
  if (lstat(linkpath, &st) == 0) {
    errno = EEXIST;
    return -1;
  }
  strncpy(parent, linkpath, sizeof(parent) - 1);
  parent[sizeof(parent) - 1] = 0;
  if (stat(dirname(parent), &st) != 0) return -1;
  errno = ${errno};
  return -1;
}
`;

// The same filesystems refuse symlinks, which is what node_modules/.bin consists of. A copy of the
// script there could not find its package, so the links are skipped. https://github.com/oven-sh/bun/issues/40143
describe.skipIf(!isLinux || isMusl || !cc)("bin links are skipped where symlinks cannot be created", () => {
  for (const errno of ["EACCES", "EPERM"]) {
    test.concurrent(`symlink fails with ${errno}`, async () => {
      const dep = (name: string) => ({
        [`${name}/package.json`]: JSON.stringify({ name, version: "1.2.3", bin: { [`${name}-bin`]: "cli.js" } }),
        [`${name}/cli.js`]: "#!/usr/bin/env node\n",
      });
      using dir = tempDir(`symlink-${errno}`, {
        "shim.c": symlinkShimC(errno),
        "package.json": JSON.stringify({
          name: "no-symlinks-test",
          dependencies: { dep1: "file:./dep1", dep2: "file:./dep2" },
        }),
        ...dep("dep1"),
        ...dep("dep2"),
      });

      {
        await using compile = Bun.spawn({
          cmd: [cc!, "-shared", "-fPIC", "-o", "shim.so", "shim.c"],
          cwd: String(dir),
          env: bunEnv,
          stdout: "pipe",
          stderr: "pipe",
        });
        const [compileOut, compileErr, compileExit] = await Promise.all([
          compile.stdout.text(),
          compile.stderr.text(),
          compile.exited,
        ]);
        if (compileExit !== 0) {
          throw new Error(`shim compile failed: ${compileOut}${compileErr}`);
        }
      }

      const binDir = join(String(dir), "node_modules", ".bin");
      const warning = `warn: ${errno}: symlinks cannot be created in ${binDir}, skipping the links to package binaries\n`;
      // The second run finds `.bin` in place.
      for (const run of ["fresh", "again"]) {
        await using proc = Bun.spawn({
          cmd: [bunExe(), "install", "--linker", "hoisted"],
          cwd: String(dir),
          env: {
            ...bunEnv,
            BUN_INSTALL_CACHE_DIR: join(String(dir), "cache"),
            LD_PRELOAD: [join(String(dir), "shim.so"), bunEnv.LD_PRELOAD].filter(Boolean).join(":"),
          },
          stdout: "pipe",
          stderr: "pipe",
        });
        const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        // Once, not once per bin.
        expect({ run, warnings: stderr.split(warning).length - 1, stderr }).toEqual({ run, warnings: 1, stderr });
        expect(stderr).not.toContain("Failed to link");
        expect(readdirSync(binDir)).toEqual([]);
        expect(await Bun.file(join(String(dir), "node_modules", "dep2", "package.json")).json()).toMatchObject({
          name: "dep2",
        });
        expect(exitCode).toBe(0);
      }
    });
  }
});
