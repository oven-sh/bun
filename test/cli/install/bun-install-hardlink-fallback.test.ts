// FUSE-backed filesystems (e.g. Android's SDCARD in Termux) do not support
// hard links and fail linkat with EACCES or EPERM instead of EXDEV. The
// hardlink install backend must fall back to copying files, like it already
// does for EXDEV. https://github.com/oven-sh/bun/issues/36852
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, isMusl, isWindows, runBunInstall, tempDir, unprivilegedSpawnOptions } from "harness";
import { chmodSync, cpSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { installEnv, TestRegistry } from "registry";

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

  async function installWithShim(dir: string, projectDir: string, expectedInstalled: string) {
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
      cwd: projectDir,
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
  for (const spec of ["file:./aaa-local", "file:../aaa-local"]) {
    test.concurrent(`does not switch the remaining packages to copyfile (${spec})`, async () => {
      // Packages install in name order: `aaa-local` hits EXDEV before `zzz-bar`
      // is linked from the cache.
      const local = spec === "file:./aaa-local" ? "project/aaa-local" : "aaa-local";
      using dir = tempDir("hardlink-xdev-folder", {
        "shim.c": shimC(`strstr(oldpath, "xdev-marker") || strstr(newpath, "xdev-marker")`),
        "project/package.json": JSON.stringify({
          name: "hardlink-xdev-folder-test",
          dependencies: { "aaa-local": spec, "zzz-bar": "file:./bar-0.0.2.tgz" },
        }),
        [`${local}/package.json`]: JSON.stringify({ name: "aaa-local", version: "1.2.3" }),
        [`${local}/xdev-marker.js`]: "module.exports = 1;",
      });
      const projectDir = join(String(dir), "project");
      cpSync(join(import.meta.dir, "bar-0.0.2.tgz"), join(projectDir, "bar-0.0.2.tgz"));

      await installWithShim(String(dir), projectDir, "2 packages installed");

      // The folder was copied, its source is as it was: nlink === 1.
      expect(statSync(join(projectDir, "node_modules", "aaa-local", "xdev-marker.js")).nlink).toBe(1);
      expect(await Bun.file(join(String(dir), local, "xdev-marker.js")).text()).toBe("module.exports = 1;");
      // The package after it is still hardlinked from the cache: nlink >= 2.
      const fromCache = join(projectDir, "node_modules", "zzz-bar", "package.json");
      expect(await Bun.file(fromCache).json()).toMatchObject({ name: "bar", version: "0.0.2" });
      expect(statSync(fromCache).nlink).toBeGreaterThanOrEqual(2);
    });
  }

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

      await installWithShim(String(dir), String(dir), "1 package installed");

      for (const [name, content] of Object.entries(files)) {
        expect(await Bun.file(join(String(dir), "local", name)).text()).toBe(content);
        const installed = join(String(dir), "node_modules", "local", name);
        expect(await Bun.file(installed).text()).toBe(content);
        expect(statSync(installed).nlink).toBe(1);
      }
    },
  );
});

// A `mkdir` that fails says nothing about hard links. Only the package that needs the directory fails.
describe.skipIf(isWindows)("hardlink backend, a directory that cannot be created", () => {
  const registry = new TestRegistry();
  beforeAll(() => registry.start());
  afterAll(() => registry.stop());

  // Serial: `unprivilegedSpawnOptions` may change and restore the modes of directories above the test's own.
  test.serial("does not switch the remaining packages to copyfile", async () => {
    const { packageJson, packageDir } = await registry.createTestDir({ bunfigOpts: { linker: "isolated" } });
    await Bun.write(
      packageJson,
      JSON.stringify({
        name: "hardlink-mkdir-test",
        dependencies: { axios: "1.7.2", "no-deps": "1.0.0", "a-dep": "1.0.1" },
      }),
    );
    await runBunInstall(installEnv(packageDir), packageDir);

    const store = join(packageDir, "node_modules", ".bun");
    const entry = join(store, "axios@1.7.2", "node_modules");
    // Without its package.json, axios is linked again. `dist` holds only directories, so the `mkdir` of `dist/node`
    // is the first call that fails in it.
    rmSync(join(entry, "axios", "package.json"));
    rmSync(join(entry, "axios", "dist", "node"), { recursive: true });
    // The other two packages are not in the cache, so they are linked after a download, when axios has failed.
    const cache = join(packageDir, ".bun-cache");
    for (const name of ["no-deps@1.0.0", "a-dep@1.0.1"]) rmSync(join(store, name), { recursive: true });
    for (const name of readdirSync(cache)) {
      if (/^(no-deps|a-dep)(@|$)/.test(name)) rmSync(join(cache, name), { recursive: true });
    }

    // The old copy of axios cannot be moved out of `entry`, so the package is linked into it.
    const readOnly = [entry, join(entry, "axios", "dist")];
    for (const dir of readOnly) chmodSync(dir, 0o555);
    try {
      using unprivileged = unprivilegedSpawnOptions(packageDir);
      await using proc = Bun.spawn({
        cmd: [bunExe(), "install", "--frozen-lockfile", "--backend=hardlink"],
        cwd: packageDir,
        env: installEnv(packageDir),
        stdout: "pipe",
        stderr: "pipe",
        ...unprivileged,
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toContain("failed to link package: axios@1.7.2");
      expect(stdout).toContain("Failed to install 1 package");
      expect(exitCode).toBe(1);
    } finally {
      for (const dir of readOnly) chmodSync(dir, 0o755);
    }

    const isHardlinked = ["no-deps@1.0.0/node_modules/no-deps", "a-dep@1.0.1/node_modules/a-dep"].map(
      name => statSync(join(store, name, "package.json")).nlink > 1,
    );
    expect(isHardlinked).toEqual([true, true]);
  });
});

// This is what the kernel does for a file system without symlinks: the path is looked up first.
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
      const warning = `warn: ${errno}: cannot create symlinks in ${binDir}, skipping bin links\n`;
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
        expect(stderr).not.toContain("failed to link");
        expect(readdirSync(binDir)).toEqual([]);
        expect(await Bun.file(join(String(dir), "node_modules", "dep2", "package.json")).json()).toMatchObject({
          name: "dep2",
        });
        expect(exitCode).toBe(0);
      }
    });
  }
});
