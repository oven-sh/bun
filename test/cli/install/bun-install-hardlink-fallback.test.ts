// FUSE-backed filesystems (e.g. Android's SDCARD in Termux) do not support
// hard links and fail linkat with EACCES or EPERM instead of EXDEV. The
// hardlink install backend must fall back to copying files, like it already
// does for EXDEV. https://github.com/oven-sh/bun/issues/36852
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, isMusl, tempDir } from "harness";
import { cpSync, statSync } from "node:fs";
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

// A folder dependency is linked from its own directory, not from the cache.
describe.skipIf(!isLinux || isMusl || !cc)("hardlink backend, folder dependency that cannot be hardlinked", () => {
  // `linkat` fails with EXDEV when `fail` (a C expression over `calls`,
  // `oldpath`, `newpath`) is true. Other calls go to the real `linkat`.
  const shimC = (fail: string) => /* c */ `
#define _GNU_SOURCE
#include <dlfcn.h>
#include <errno.h>
#include <string.h>

int linkat(int olddirfd, const char *oldpath, int newdirfd, const char *newpath,
           int flags) {
  static int calls = 0;
  calls++;
  if (${fail}) {
    errno = EXDEV;
    return -1;
  }
  int (*real)(int, const char *, int, const char *, int) = dlsym(RTLD_NEXT, "linkat");
  return real(olddirfd, oldpath, newdirfd, newpath, flags);
}
`;

  async function installWithShim(dir: string, expectedInstalled: string) {
    {
      await using compile = Bun.spawn({
        cmd: [cc!, "-shared", "-fPIC", "-o", "shim.so", "shim.c", "-ldl"],
        cwd: dir,
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
      cmd: [bunExe(), "install", "--backend", "hardlink", "--linker", "hoisted"],
      cwd: dir,
      env: {
        ...bunEnv,
        BUN_INSTALL_CACHE_DIR: join(dir, "cache"),
        LD_PRELOAD: [join(dir, "shim.so"), bunEnv.LD_PRELOAD].filter(Boolean).join(":"),
      },
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).not.toContain("EXDEV");
    expect(stdout).toContain(expectedInstalled);
    expect(exitCode).toBe(0);
  }

  // The folder is on another file system: only this package falls back to
  // copying. Packages from the cache keep using hardlinks.
  test.concurrent("does not switch the remaining packages to copyfile", async () => {
    // Packages install in name order: `aaa-local` hits EXDEV before `zzz-bar`
    // is linked from the cache.
    using dir = tempDir("hardlink-xdev-folder", {
      "shim.c": shimC(`strstr(oldpath, "xdev-marker") || strstr(newpath, "xdev-marker")`),
      "package.json": JSON.stringify({
        name: "hardlink-xdev-folder-test",
        dependencies: { "aaa-local": "file:./aaa-local", "zzz-bar": "file:./bar-0.0.2.tgz" },
      }),
      "aaa-local/package.json": JSON.stringify({ name: "aaa-local", version: "1.2.3" }),
      "aaa-local/xdev-marker.js": "module.exports = 1;",
    });
    cpSync(join(import.meta.dir, "bar-0.0.2.tgz"), join(String(dir), "bar-0.0.2.tgz"));

    await installWithShim(String(dir), "2 packages installed");

    // The folder was copied: nlink === 1.
    expect(statSync(join(String(dir), "node_modules", "aaa-local", "xdev-marker.js")).nlink).toBe(1);
    // The package after it is still hardlinked from the cache: nlink >= 2.
    const fromCache = join(String(dir), "node_modules", "zzz-bar", "package.json");
    expect(await Bun.file(fromCache).json()).toMatchObject({ name: "bar", version: "0.0.2" });
    expect(statSync(fromCache).nlink).toBeGreaterThanOrEqual(2);
  });

  // The first file of the folder is hardlinked, then `linkat` fails. The copy
  // that follows must not truncate the source through that hardlink.
  test.concurrent(
    "keeps the source files intact when the fallback to copyfile starts after a partial link",
    async () => {
      const files = {
        "package.json": JSON.stringify({ name: "local", version: "1.2.3" }),
        "index.js": "module.exports = require('./other.js') + ' from index';",
        "other.js": "module.exports = 'other';",
      };
      using dir = tempDir("hardlink-partial-folder", {
        "shim.c": shimC("calls == 2"),
        "package.json": JSON.stringify({
          name: "hardlink-partial-folder-test",
          dependencies: { local: "file:./local" },
        }),
        ...Object.fromEntries(Object.entries(files).map(([name, content]) => [`local/${name}`, content])),
      });

      await installWithShim(String(dir), "1 package installed");

      for (const [name, content] of Object.entries(files)) {
        expect(await Bun.file(join(String(dir), "local", name)).text()).toBe(content);
        const installed = join(String(dir), "node_modules", "local", name);
        expect(await Bun.file(installed).text()).toBe(content);
        expect(statSync(installed).nlink).toBe(1);
      }
    },
  );
});
