// FUSE-backed filesystems (e.g. Android's SDCARD in Termux) do not support
// hard links and fail linkat with EACCES or EPERM instead of EXDEV. The
// hardlink install backend must fall back to copying files, like it already
// does for EXDEV. https://github.com/oven-sh/bun/issues/36852
// Other file systems answer ENOTSUP or ENOSYS, and a file that has as many
// links as its file system allows answers EMLINK.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, isMacOS, isMusl, isWindows, tempDir } from "harness";
import { cpSync, linkSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { constants } from "node:os";
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
  for (const errno of ["EACCES", "EPERM", "EMLINK", "ENOTSUP", "ENOSYS"]) {
    for (const linker of ["hoisted", "isolated"]) {
      // The isolated linker copies a `file:` folder over the files of the last install, in place
      // (https://github.com/oven-sh/bun/issues/45194). Until that copy replaces them, a folder
      // falls back only for the errnos it already did.
      const folder = linker === "hoisted" || errno === "EACCES" || errno === "EPERM";
      test.concurrent(`linkat fails with ${errno}, ${linker} linker`, async () => {
        using dir = tempDir(`hardlink-${errno}-${linker}`, {
          "shim.c": shimC(errno),
          "package.json": JSON.stringify({
            name: "hardlink-fallback-test",
            dependencies: { bar: "file:./bar-0.0.2.tgz", ...(folder && { localdep: "file:./localdep" }) },
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

        if (!folder) return;
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
  // `linkat` fails with `errno` when `fail` (a C expression over `calls`,
  // `oldpath`, `newpath`) is true. Other calls go to the real `linkat`.
  const shimC = (fail: string, errno = "EXDEV") => /* c */ `
#define _GNU_SOURCE
#include <dlfcn.h>
#include <errno.h>
#include <string.h>

int linkat(int olddirfd, const char *oldpath, int newdirfd, const char *newpath,
           int flags) {
  static int calls = 0;
  calls++;
  if (${fail}) {
    errno = ${errno};
    return -1;
  }
  int (*real)(int, const char *, int, const char *, int) = dlsym(RTLD_NEXT, "linkat");
  return real(olddirfd, oldpath, newdirfd, newpath, flags);
}
`;

  async function installWithShim(dir: string, projectDir: string, expectedInstalled: string, errno = "EXDEV") {
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
    expect(stderr).not.toContain(errno);
    expect(stdout).toContain(expectedInstalled);
    expect(exitCode).toBe(0);
  }

  // The folder is on another file system: only this package falls back to
  // copying. Packages from the cache keep using hardlinks.
  // ENOTSUP, ENOSYS: a file system that has no hard links at all.
  for (const [spec, errno] of ["file:./aaa-local", "file:../aaa-local"].flatMap(spec =>
    ["EXDEV", "ENOTSUP", "ENOSYS"].map(errno => [spec, errno]),
  )) {
    test.concurrent(`does not switch the remaining packages to copyfile (${spec}, ${errno})`, async () => {
      // Packages install in name order: `aaa-local` is refused before `zzz-bar`
      // is linked from the cache.
      const local = spec === "file:./aaa-local" ? "project/aaa-local" : "aaa-local";
      using dir = tempDir("hardlink-xdev-folder", {
        "shim.c": shimC(`strstr(oldpath, "xdev-marker") || strstr(newpath, "xdev-marker")`, errno),
        "project/package.json": JSON.stringify({
          name: "hardlink-xdev-folder-test",
          dependencies: { "aaa-local": spec, "zzz-bar": "file:./bar-0.0.2.tgz" },
        }),
        [`${local}/package.json`]: JSON.stringify({ name: "aaa-local", version: "1.2.3" }),
        [`${local}/xdev-marker.js`]: "module.exports = 1;",
      });
      const projectDir = join(String(dir), "project");
      cpSync(join(import.meta.dir, "bar-0.0.2.tgz"), join(projectDir, "bar-0.0.2.tgz"));

      await installWithShim(String(dir), projectDir, "2 packages installed", errno);

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

const { EDQUOT, EIO, EMLINK, ENOMEM, ENOSPC, ENOTSUP, EOPNOTSUPP, EROFS } = constants.errno;

// LINK_SHIM_ERRNO=n      every linkat fails with errno n
// LINK_SHIM_AT=k         with LINK_SHIM_ERRNO: only the k-th link of the process fails
// LINK_SHIM_MAX_LINKS=n  a file system where a file can have n links: one more fails with EMLINK
const limitShimC = /* c */ `
#define _GNU_SOURCE
#include <dlfcn.h>
#include <errno.h>
#include <fcntl.h>
#include <stdlib.h>
#include <sys/stat.h>
#include <unistd.h>

static int links;

int linkat(int olddirfd, const char *oldpath, int newdirfd, const char *newpath, int flags) {
  int (*real)(int, const char *, int, const char *, int) = dlsym(RTLD_NEXT, "linkat");
  const char *refusal = getenv("LINK_SHIM_ERRNO");
  const char *at = getenv("LINK_SHIM_AT");
  const char *max = getenv("LINK_SHIM_MAX_LINKS");
  struct stat st;
  if (refusal && !at) {
    errno = atoi(refusal);
    return -1;
  }
  // Like the kernel: EEXIST and ENOENT are reported before the file system is asked.
  int rc = real(olddirfd, oldpath, newdirfd, newpath, flags);
  if (rc != 0) return rc;
  if (at && __sync_add_and_fetch(&links, 1) == atoi(at)) {
    unlinkat(newdirfd, newpath, 0);
    errno = atoi(refusal);
    return -1;
  }
  if (max && fstatat(newdirfd, newpath, &st, AT_SYMLINK_NOFOLLOW) == 0 && st.st_nlink > (nlink_t)atoi(max)) {
    unlinkat(newdirfd, newpath, 0);
    errno = EMLINK;
    return -1;
  }
  return rc;
}
`;

// A tarball of a package with these files and a package.json.
function tarball(name: string, files: Record<string, string>) {
  return new Bun.Archive(
    {
      "package/package.json": JSON.stringify({ name, version: "1.0.0" }),
      ...Object.fromEntries(Object.entries(files).map(([path, content]) => [`package/${path}`, content])),
    },
    { compress: "gzip" },
  ).bytes();
}

// The files below `dir`, the cache tag too.
function filesOf(dir: string) {
  return [...new Bun.Glob("**").scanSync({ cwd: dir, onlyFiles: true, dot: true })].sort();
}

// The link count of every file below `dir`, by relative path.
function linkCounts(dir: string) {
  return Object.fromEntries(filesOf(dir).map(file => [file.replaceAll("\\", "/"), statSync(join(dir, file)).nlink]));
}

// The cache directory of the package `name`.
function cachedPackage(cache: string, name: string) {
  for (const packageJson of new Bun.Glob("*/package.json").scanSync({ cwd: cache, absolute: true })) {
    if (JSON.parse(readFileSync(packageJson, "utf8")).name === name) return join(packageJson, "..");
  }
  throw new Error(`${name} is not in the cache`);
}

const packageFiles = { "index.js": "module.exports = 1;\n", "lib/a.txt": "a\n", "lib/b.txt": "b\n" };

describe.skipIf(!isLinux || isMusl || !cc)("hardlink backend, a link that the file system refuses", () => {
  let shimDir: ReturnType<typeof tempDir> | undefined;
  let shimPath = "";

  beforeAll(async () => {
    shimDir = tempDir("hardlink-limit-shim", { "shim.c": limitShimC });
    shimPath = join(String(shimDir), "shim.so");
    await using compile = Bun.spawn({
      cmd: [cc!, "-shared", "-fPIC", "-o", "shim.so", "shim.c", "-ldl"],
      cwd: String(shimDir),
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
  });

  afterAll(() => {
    shimDir?.[Symbol.dispose]();
  });

  async function install(cwd: string, linker: string, shim?: Record<string, number>) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "install", "--backend", "hardlink", "--linker", linker],
      cwd,
      env: {
        ...bunEnv,
        BUN_INSTALL_CACHE_DIR: join(cwd, "cache"),
        ...(shim && {
          ...Object.fromEntries(Object.entries(shim).map(([key, value]) => [key, String(value)])),
          LD_PRELOAD: [shimPath, bunEnv.LD_PRELOAD].filter(Boolean).join(":"),
        }),
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  // A copy fails for the same reason, so these stay errors.
  const fatal: [name: string, errno: number, linker: string][] = [
    ["ENOSPC", ENOSPC, "hoisted"],
    ["ENOSPC", ENOSPC, "isolated"],
    ["EDQUOT", EDQUOT, "isolated"],
    ["EIO", EIO, "isolated"],
    ["EROFS", EROFS, "isolated"],
    ["ENOMEM", ENOMEM, "isolated"],
  ];
  for (const [name, errno, linker] of fatal) {
    test.concurrent(`${name} still fails the package, ${linker} linker`, async () => {
      using dir = tempDir(`hardlink-${name}-${linker}`, {
        "package.json": JSON.stringify({
          name: "hardlink-fallback-test",
          dependencies: { bar: "file:./bar-0.0.2.tgz" },
        }),
      });
      cpSync(join(import.meta.dir, "bar-0.0.2.tgz"), join(String(dir), "bar-0.0.2.tgz"));

      const { stderr, exitCode } = await install(String(dir), linker, { LINK_SHIM_ERRNO: errno });
      expect(stderr).toContain(`${name}: `);
      expect(stderr).toMatch(/fail.* bar/);
      expect(exitCode).toBe(1);
    });
  }

  // Every install adds one link to each file of a cached package, so all of its files reach the
  // limit together. The package is copied. The backend stays: the other packages still link.
  for (const linker of ["hoisted", "isolated"]) {
    test.concurrent(
      `a package at the link limit is copied and the other packages still link, ${linker} linker`,
      async () => {
        // More packages than threads, and a full one at each end of the name order: whichever
        // end is linked first, most of the others start after a link was refused.
        const full = ["a-full", "zz-full"];
        const others = Array.from({ length: 6 }, (_, i) => `m-other-${i}`);
        using dir = tempDir(`hardlink-limit-${linker}`, {
          "package.json": JSON.stringify({
            name: "hardlink-fallback-test",
            dependencies: Object.fromEntries([...full, ...others].map(name => [name, `file:./${name}.tgz`])),
          }),
        });
        for (const name of [...full, ...others]) {
          await Bun.write(join(String(dir), `${name}.tgz`), await tarball(name, packageFiles));
        }

        // Fill the cache, then give each file of the full packages a second link, as another project does.
        expect((await install(String(dir), linker)).exitCode).toBe(0);
        rmSync(join(String(dir), "node_modules"), { recursive: true, force: true });
        mkdirSync(join(String(dir), "other-project"));
        for (const name of full) {
          const cached = cachedPackage(join(String(dir), "cache"), name);
          for (const [i, file] of filesOf(cached).entries()) {
            linkSync(join(cached, file), join(String(dir), "other-project", `${name}-${i}`));
          }
        }

        const { stdout, stderr, exitCode } = await install(String(dir), linker, {
          LINK_SHIM_MAX_LINKS: 2,
          UV_THREADPOOL_SIZE: 2,
        });
        expect(stderr).not.toContain("EMLINK");
        expect(stdout).toContain("8 packages installed");
        const counts = (nlink: number) =>
          Object.fromEntries(
            [".bun-tag", "package.json", ...Object.keys(packageFiles)].sort().map(file => [file, nlink]),
          );
        const installed = (names: string[]) => names.map(name => linkCounts(join(String(dir), "node_modules", name)));
        expect(installed(full)).toEqual(full.map(() => counts(1)));
        expect(installed(others)).toEqual(others.map(() => counts(2)));
        expect(exitCode).toBe(0);
      },
    );
  }

  // A link count that one file reached alone. The two files that were linked before it become
  // copies too, and nothing is written into the cache through those links.
  test.concurrent("EMLINK after two links copies the whole package, hoisted linker", async () => {
    using dir = tempDir("hardlink-partial-EMLINK", {
      "package.json": JSON.stringify({
        name: "hardlink-fallback-test",
        dependencies: { pkg: "file:./pkg.tgz" },
      }),
    });
    await Bun.write(join(String(dir), "pkg.tgz"), await tarball("pkg", packageFiles));

    expect((await install(String(dir), "hoisted")).exitCode).toBe(0);
    rmSync(join(String(dir), "node_modules"), { recursive: true, force: true });
    const cached = cachedPackage(join(String(dir), "cache"), "pkg");
    const written = () => filesOf(cached).map(file => statSync(join(cached, file), { bigint: true }).mtimeNs);
    const before = written();

    const { stdout, stderr, exitCode } = await install(String(dir), "hoisted", {
      LINK_SHIM_ERRNO: EMLINK,
      LINK_SHIM_AT: 3,
    });
    expect(stderr).not.toContain("EMLINK");
    expect(stdout).toContain("1 package installed");
    const counts = Object.fromEntries(
      [".bun-tag", "package.json", ...Object.keys(packageFiles)].sort().map(file => [file, 1]),
    );
    expect(linkCounts(join(String(dir), "node_modules", "pkg"))).toEqual(counts);
    expect(linkCounts(cached)).toEqual(counts);
    expect(written()).toEqual(before);
    expect(exitCode).toBe(0);
  });
});

// The same fallback on macOS, where the kernel reports ENOTSUP (45) and EOPNOTSUPP is another
// number (102). The hardlink backend is what a `file:` folder gets there by default.
describe.skipIf(!isMacOS || !cc)("hardlink backend falls back to copyfile on macOS", () => {
  const interposeC = /* c */ `
#include <errno.h>
#include <fcntl.h>
#include <stdlib.h>
#include <unistd.h>

static int refused_linkat(int olddirfd, const char *oldpath, int newdirfd, const char *newpath, int flags) {
  const char *refusal = getenv("LINK_SHIM_ERRNO");
  const char *log = getenv("LINK_SHIM_LOG");
  if (!refusal) return linkat(olddirfd, oldpath, newdirfd, newpath, flags);
  if (log) {
    int fd = open(log, O_WRONLY | O_CREAT | O_APPEND, 0644);
    if (fd >= 0) {
      write(fd, "refused\n", 8);
      close(fd);
    }
  }
  errno = atoi(refusal);
  return -1;
}

__attribute__((used, section("__DATA,__interpose"))) static const struct {
  const void *replacement, *original;
} interpose[] = {
  {(const void *)refused_linkat, (const void *)linkat},
};
`;

  let shimDir: ReturnType<typeof tempDir> | undefined;

  beforeAll(async () => {
    shimDir = tempDir("hardlink-interpose", { "shim.c": interposeC });
    await using compile = Bun.spawn({
      cmd: [cc!, "-dynamiclib", "-o", "shim.dylib", "shim.c"],
      cwd: String(shimDir),
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
  });

  afterAll(() => {
    shimDir?.[Symbol.dispose]();
  });

  const cells: [name: string, errno: number, linker: string, args: string[], dependency: string][] = [];
  for (const [name, errno] of [
    ["ENOTSUP", ENOTSUP],
    ["EOPNOTSUPP", EOPNOTSUPP],
  ] as const) {
    // No `--backend`: a folder is hard linked whatever the backend is.
    cells.push([name, errno, "hoisted", [], "file:./localdep"]);
    cells.push([name, errno, "isolated", ["--backend", "hardlink"], "file:./bar-0.0.2.tgz"]);
  }

  for (const [name, errno, linker, args, dependency] of cells) {
    test.concurrent(`linkat fails with ${name}, ${linker} linker, ${dependency}`, async () => {
      using dir = tempDir(`hardlink-macos-${name}-${linker}`, {
        "package.json": JSON.stringify({ name: "hardlink-fallback-test", dependencies: { dep: dependency } }),
        "localdep/package.json": JSON.stringify({ name: "localdep", version: "1.2.3" }),
        "localdep/index.js": "module.exports = 1;",
      });
      cpSync(join(import.meta.dir, "bar-0.0.2.tgz"), join(String(dir), "bar-0.0.2.tgz"));

      await using proc = Bun.spawn({
        cmd: [bunExe(), "install", "--linker", linker, ...args],
        cwd: String(dir),
        env: {
          ...bunEnv,
          BUN_INSTALL_CACHE_DIR: join(String(dir), "cache"),
          DYLD_INSERT_LIBRARIES: join(String(shimDir), "shim.dylib"),
          LINK_SHIM_ERRNO: String(errno),
          LINK_SHIM_LOG: join(String(dir), "links.log"),
        },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).not.toContain("ENOTSUP");
      expect(stdout).toContain("1 package installed");
      // The shim saw a link, so the copy is the fallback and not the backend that was asked for.
      expect(readFileSync(join(String(dir), "links.log"), "utf8")).toContain("refused");
      expect(statSync(join(String(dir), "node_modules", "dep", "package.json")).nlink).toBe(1);
      expect(exitCode).toBe(0);
    });
  }
});

// No injection: NTFS refuses one more link to a file that has 1023 of them.
test.skipIf(!isWindows)("a package at the NTFS link limit is copied, isolated linker", async () => {
  using dir = tempDir("hardlink-ntfs-limit", {
    "package.json": JSON.stringify({
      name: "hardlink-fallback-test",
      dependencies: { pkg: "file:./pkg.tgz" },
    }),
  });
  await Bun.write(join(String(dir), "pkg.tgz"), await tarball("pkg", packageFiles));
  const install = async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "install", "--linker", "isolated"],
      cwd: String(dir),
      env: { ...bunEnv, BUN_INSTALL_CACHE_DIR: join(String(dir), "cache") },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  };

  expect((await install()).exitCode).toBe(0);
  rmSync(join(String(dir), "node_modules"), { recursive: true, force: true });

  // Every file of the package, as the installs of many projects leave them.
  const cached = cachedPackage(join(String(dir), "cache"), "pkg");
  mkdirSync(join(String(dir), "links"));
  const files = filesOf(cached);
  files.forEach((file, f) => {
    for (let i = 0; i < 1100; i++) {
      try {
        linkSync(join(cached, file), join(String(dir), "links", `${f}-${i}`));
      } catch {
        break;
      }
    }
  });
  // The loop stopped at the limit of NTFS, not at some other error.
  expect(Object.values(linkCounts(cached))).toEqual(files.map(() => 1023));

  const { stdout, stderr, exitCode } = await install();
  expect(stderr).not.toContain("failed to link");
  expect(stdout).toContain("1 package installed");
  expect(Object.values(linkCounts(join(String(dir), "node_modules", "pkg")))).toEqual(files.map(() => 1));
  expect(exitCode).toBe(0);
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
  for (const errno of ["EACCES", "EPERM", "ENOSYS"]) {
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
