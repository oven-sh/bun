// FUSE-backed filesystems (e.g. Android's SDCARD in Termux) do not support
// hard links and fail linkat with EACCES or EPERM instead of EXDEV. The
// hardlink install backend must fall back to copying files, like it already
// does for EXDEV. https://github.com/oven-sh/bun/issues/36852
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, isMusl, isWindows, tempDir } from "harness";
import { cpSync, readdirSync, rmSync, statSync } from "node:fs";
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

// Several bun processes may install the same packages into the same
// destination at once (e.g. parallel `bun x <tool>` invocations share one
// bunx install dir and one cache). On Windows the racing hardlinks used to
// surface as "EBUSY: failed copying files from cache to destination": a
// dest created by a peer was deleted and relinked instead of being accepted,
// and transient sharing violations were not retried.
describe("concurrent installs into the same destination", () => {
  const PKG_COUNT = 5;
  const FILE_COUNT = 60;
  const PROCESS_COUNT = 10;
  const ROUNDS = 3;

  test("tolerate each other instead of failing with EBUSY", async () => {
    const deps: Record<string, string> = {};
    for (let p = 0; p < PKG_COUNT; p++) {
      deps[`many-files-${p}`] = `file:./many-files-${p}.tgz`;
    }
    using dir = tempDir("concurrent-install", {
      "package.json": JSON.stringify({ name: "concurrent-install-test", dependencies: deps }),
    });
    const filler = Buffer.alloc(256, "x").toString();
    for (let p = 0; p < PKG_COUNT; p++) {
      const files: Record<string, string> = {
        "package/package.json": JSON.stringify({ name: `many-files-${p}`, version: "1.0.0" }),
      };
      for (let f = 0; f < FILE_COUNT; f++) {
        files[`package/lib/file${f}.js`] = `module.exports = ${f}; // ${filler}`;
      }
      const tarball = await new Bun.Archive(files, { compress: "gzip" }).bytes();
      await Bun.write(join(String(dir), `many-files-${p}.tgz`), tarball);
    }

    const env = { ...bunEnv, BUN_INSTALL_CACHE_DIR: join(String(dir), "cache") };
    const cmd = [bunExe(), "install", "--backend", "hardlink"];

    // Warm the cache and the lockfile so the racing rounds below start at
    // the cache-to-node_modules copy phase together.
    {
      await using warm = Bun.spawn({ cmd, cwd: String(dir), env, stdout: "pipe", stderr: "pipe" });
      const [stdout, stderr, exitCode] = await Promise.all([warm.stdout.text(), warm.stderr.text(), warm.exited]);
      expect(stderr).not.toContain("error");
      expect(stdout).toMatch(/\d+ packages? installed/);
      expect(exitCode).toBe(0);
    }

    for (let round = 0; round < ROUNDS; round++) {
      rmSync(join(String(dir), "node_modules"), { recursive: true, force: true });
      if (round > 0 && isWindows) {
        // Cold cache: the processes also race extracting into the cache, not
        // just copying out of it. Windows-only for now: the POSIX extract
        // path can still delete a cache entry out from under a concurrent
        // reader when its publish rename collides (#36227), which is a
        // separate fix.
        rmSync(join(String(dir), "cache"), { recursive: true, force: true });
      }
      const procs = Array.from({ length: PROCESS_COUNT }, () =>
        Bun.spawn({ cmd, cwd: String(dir), env, stdout: "pipe", stderr: "pipe" }),
      );
      const results = await Promise.all(
        procs.map(async proc => {
          const [stdout, stderr, exitCode] = await Promise.all([
            proc.stdout.text(),
            proc.stderr.text(),
            proc.exited,
          ]);
          return { stdout, stderr, exitCode };
        }),
      );
      for (const { stdout, stderr, exitCode } of results) {
        expect(stderr).not.toContain("EBUSY");
        expect(stdout).not.toContain("Failed to install");
        expect(exitCode).toBe(0);
      }
      // The racing installs must still converge on a complete tree.
      for (let p = 0; p < PKG_COUNT; p++) {
        const lib = join(String(dir), "node_modules", `many-files-${p}`, "lib");
        expect(readdirSync(lib)).toHaveLength(FILE_COUNT);
      }
    }
  }, 120_000);
});
