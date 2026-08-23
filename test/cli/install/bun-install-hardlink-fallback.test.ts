// FUSE-backed filesystems (e.g. Android's SDCARD in Termux) do not support
// hard links and fail linkat with EACCES or EPERM instead of EXDEV. The
// hardlink install backend must fall back to copying files, like it already
// does for EXDEV. https://github.com/oven-sh/bun/issues/36852
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, isMusl, tempDir } from "harness";
import { cpSync, lstatSync, statSync } from "node:fs";
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

const symlinkShimC = (errno: string) => /* c */ `
#define _GNU_SOURCE
#include <errno.h>

int symlink(const char *target, const char *linkpath) {
  (void)target; (void)linkpath;
  errno = ${errno};
  return -1;
}

int symlinkat(const char *target, int newdirfd, const char *linkpath) {
  (void)target; (void)newdirfd; (void)linkpath;
  errno = ${errno};
  return -1;
}
`;

// The same FUSE filesystems also reject symlink creation, which the bin
// linker uses for node_modules/.bin entries. It must fall back to copying
// the bin target. https://github.com/oven-sh/bun/issues/40143
describe.skipIf(!isLinux || isMusl || !cc)("bin linker falls back to copying when symlink fails", () => {
  const cliJs = "#!/usr/bin/env node\nconsole.log('localdep bin ran');\n";

  for (const errno of ["EACCES", "EPERM"]) {
    test.concurrent(`symlink fails with ${errno}`, async () => {
      using dir = tempDir(`symlink-${errno}`, {
        "shim.c": symlinkShimC(errno),
        "package.json": JSON.stringify({
          name: "symlink-fallback-test",
          dependencies: { localdep: "file:./localdep" },
        }),
        "localdep/package.json": JSON.stringify({
          name: "localdep",
          version: "1.2.3",
          bin: { "localdep-bin": "cli.js" },
        }),
        "localdep/cli.js": cliJs,
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

      const env = {
        ...bunEnv,
        BUN_INSTALL_CACHE_DIR: join(String(dir), "cache"),
        LD_PRELOAD: [join(String(dir), "shim.so"), bunEnv.LD_PRELOAD].filter(Boolean).join(":"),
      };

      // Run twice: the first install hits the fresh-install path (.bin does
      // not exist yet), the second hits the path where the destination
      // already exists as a regular file from the previous fallback copy.
      for (const run of ["fresh", "reinstall"]) {
        await using proc = Bun.spawn({
          cmd: [bunExe(), "install"],
          cwd: String(dir),
          env,
          stderr: "pipe",
        });
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        expect({ run, failedToLink: stderr.includes("Failed to link") || stderr.includes(errno) }).toEqual({
          run,
          failedToLink: false,
        });
        expect(exitCode).toBe(0);

        const bin = join(String(dir), "node_modules", ".bin", "localdep-bin");
        const stat = lstatSync(bin);
        expect(stat.isSymbolicLink()).toBe(false);
        expect(stat.isFile()).toBe(true);
        // The copy must be executable.
        expect(stat.mode & 0o100).toBe(0o100);
        expect(await Bun.file(bin).text()).toBe(cliJs);
      }
    });
  }
});
