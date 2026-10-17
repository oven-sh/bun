// FUSE-backed filesystems (e.g. Android's SDCARD in Termux) do not support
// hard links and fail linkat with EACCES or EPERM instead of EXDEV. The
// hardlink install backend must fall back to copying files, like it already
// does for EXDEV. https://github.com/oven-sh/bun/issues/36852
// Other file systems answer ENOTSUP or ENOSYS. A file that has as many links
// as the file system allows answers EMLINK, and only that file needs a copy.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, isMusl, isWindows, tempDir } from "harness";
import { cpSync, linkSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
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
  // 524 is ENOTSUPP: internal to the kernel, but NFS lets it out. bun's errno table has no name for it.
  for (const errno of ["EACCES", "EPERM", "EMLINK", "ENOTSUP", "ENOSYS", "524"]) {
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

  // The first file of the folder is hardlinked, then `linkat` fails. That file
  // stays a link, and the copy starts at the refused file: nothing is written
  // through the link into the source.
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

      const nlinks: number[] = [];
      for (const [name, content] of Object.entries(files)) {
        expect(await Bun.file(join(String(dir), "local", name)).text()).toBe(content);
        const installed = join(String(dir), "node_modules", "local", name);
        expect(await Bun.file(installed).text()).toBe(content);
        nlinks.push(statSync(installed).nlink);
      }
      expect(nlinks.sort()).toEqual([1, 1, 2]);
    },
  );
});

const { EDQUOT, EIO, EMLINK, ENOMEM, ENOSPC, EPERM, EROFS, EXDEV } = constants.errno;

// Refuses linkat with LINK_SHIM_ERRNO.
//   LINK_SHIM_FROM=n     refuse from the n-th link the process makes
//   LINK_SHIM_ONLY=path  refuse only a link whose new path ends with `path`
// With a selector the shim makes the link first and then takes it back. The
// kernel works in that order: it reports EEXIST and ENOENT before it asks the
// file system. Without a selector the shim refuses at once, before the kernel
// looks at the destination, the way a seccomp filter does.
const selectiveShimC = /* c */ `
#define _GNU_SOURCE
#include <dlfcn.h>
#include <errno.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

static int links;

static int selected(const char *newpath) {
  const char *from = getenv("LINK_SHIM_FROM");
  const char *only = getenv("LINK_SHIM_ONLY");
  if (from && __sync_add_and_fetch(&links, 1) < atoi(from)) return 0;
  if (only) {
    size_t n = strlen(newpath), m = strlen(only);
    if (n < m || strcmp(newpath + n - m, only) != 0) return 0;
  }
  return 1;
}

int linkat(int olddirfd, const char *oldpath, int newdirfd, const char *newpath, int flags) {
  int (*real)(int, const char *, int, const char *, int) = dlsym(RTLD_NEXT, "linkat");
  const char *refusal = getenv("LINK_SHIM_ERRNO");
  if (!refusal) return real(olddirfd, oldpath, newdirfd, newpath, flags);
  if (getenv("LINK_SHIM_FROM") || getenv("LINK_SHIM_ONLY")) {
    int rc = real(olddirfd, oldpath, newdirfd, newpath, flags);
    if (rc != 0 || !selected(newpath)) return rc;
    unlinkat(newdirfd, newpath, 0);
  }
  errno = atoi(refusal);
  return -1;
}
`;

type LinkShim = { LINK_SHIM_ERRNO: number; LINK_SHIM_FROM?: number; LINK_SHIM_ONLY?: string };

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

// The link count of every file below `dir`, by relative path. `dot` counts `.bun-tag` too.
function linkCounts(dir: string, dot = false) {
  const files = [...new Bun.Glob("**").scanSync({ cwd: dir, onlyFiles: true, dot })].sort();
  return Object.fromEntries(files.map(file => [file.replaceAll("\\", "/"), statSync(join(dir, file)).nlink]));
}

// The directory of the one package in the cache.
function cachedPackage(dir: string) {
  const [packageJson] = [...new Bun.Glob("*/package.json").scanSync({ cwd: join(dir, "cache"), absolute: true })];
  return join(packageJson, "..");
}

const twentyFiles = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`lib/f${i}.txt`, `file ${i}\n`]));

describe.skipIf(!isLinux || isMusl || !cc)("hardlink backend, a link that the file system refuses", () => {
  let shimDir: ReturnType<typeof tempDir> | undefined;
  let shimPath = "";

  beforeAll(async () => {
    shimDir = tempDir("hardlink-selective-shim", { "shim.c": selectiveShimC });
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

  async function install(cwd: string, args: string[], shim?: LinkShim) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "install", ...args],
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

  // A copy fails for the same reason, so the link error is the one to report.
  // Both linkers ask the same classifier. The isolated linker runs the whole list.
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

      const { stderr, exitCode } = await install(String(dir), ["--linker", linker], { LINK_SHIM_ERRNO: errno });
      expect(stderr).toContain(`${name}: `);
      expect(stderr).toMatch(/fail.* bar/);
      expect(exitCode).toBe(1);
    });
  }

  for (const linker of ["hoisted", "isolated"]) {
    // EMLINK is about one file. The file after it, and the other package, can still be linked.
    test.concurrent(`EMLINK copies the one full file and keeps linking, ${linker} linker`, async () => {
      using dir = tempDir(`hardlink-one-EMLINK-${linker}`, {
        "package.json": JSON.stringify({
          name: "hardlink-fallback-test",
          dependencies: { "a-first": "file:./a-first.tgz", "z-last": "file:./z-last.tgz" },
        }),
      });
      await Bun.write(
        join(String(dir), "a-first.tgz"),
        await tarball("a-first", { "index.js": "module.exports = 'a';\n", "lib/full.txt": "full\n", ...twentyFiles }),
      );
      await Bun.write(join(String(dir), "z-last.tgz"), await tarball("z-last", twentyFiles));

      const { stdout, stderr, exitCode } = await install(String(dir), ["--linker", linker], {
        LINK_SHIM_ERRNO: EMLINK,
        LINK_SHIM_ONLY: "lib/full.txt",
      });
      expect(stderr).not.toContain("EMLINK");
      expect(stdout).toContain("2 packages installed");

      const linked = Object.fromEntries(Object.keys(twentyFiles).map(file => [file, 2]));
      expect(linkCounts(join(String(dir), "node_modules", "a-first"))).toEqual({
        "index.js": 2,
        "lib/full.txt": 1,
        "package.json": 2,
        ...linked,
      });
      expect(linkCounts(join(String(dir), "node_modules", "z-last"))).toEqual({ "package.json": 2, ...linked });
      expect(readFileSync(join(String(dir), "node_modules", "a-first", "lib", "full.txt"), "utf8")).toBe("full\n");
      expect(exitCode).toBe(0);
    });

    // The files linked before the refusal stay linked. The copy goes on from the refused file.
    test.concurrent(`EXDEV from the tenth link copies the rest, ${linker} linker`, async () => {
      using dir = tempDir(`hardlink-tenth-EXDEV-${linker}`, {
        "package.json": JSON.stringify({
          name: "hardlink-fallback-test",
          dependencies: { pkg: "file:./pkg.tgz" },
        }),
      });
      await Bun.write(
        join(String(dir), "pkg.tgz"),
        await tarball("pkg", { "index.js": "module.exports = 'pkg';\n", ...twentyFiles }),
      );

      // Fill the cache, so that the second install only links from it.
      expect((await install(String(dir), ["--linker", linker])).exitCode).toBe(0);
      rmSync(join(String(dir), "node_modules"), { recursive: true, force: true });
      const cache = cachedPackage(String(dir));
      const written = (file: string) => statSync(join(cache, file), { bigint: true }).mtimeNs;
      const before = Object.keys(twentyFiles).map(written);

      const { stdout, stderr, exitCode } = await install(String(dir), ["--linker", linker], {
        LINK_SHIM_ERRNO: EXDEV,
        LINK_SHIM_FROM: 10,
      });
      expect(stderr).not.toContain("EXDEV");
      expect(stdout).toContain("1 package installed");

      const counts = Object.values(linkCounts(join(String(dir), "node_modules", "pkg"), true));
      expect(counts.length).toBeGreaterThanOrEqual(22);
      expect({
        links: counts.filter(nlink => nlink === 2).length,
        copies: counts.filter(nlink => nlink === 1).length,
      }).toEqual({ links: 9, copies: counts.length - 9 });
      for (const [file, content] of Object.entries(twentyFiles)) {
        expect(readFileSync(join(String(dir), "node_modules", "pkg", file), "utf8")).toBe(content);
        expect(readFileSync(join(cache, file), "utf8")).toBe(content);
      }
      // Nothing wrote to a cache file through a link made before the refusal.
      expect(Object.keys(twentyFiles).map(written)).toEqual(before);
      expect(exitCode).toBe(0);
    });
  }

  // The isolated linker links a `file:` folder from the folder itself, into the
  // files of the install before. It does that again when the two differ.
  describe("a reinstalled file: folder, isolated linker", () => {
    const first = "module.exports = 'the first version of this file';\n";
    const files = {
      "package.json": JSON.stringify({
        name: "hardlink-fallback-test",
        dependencies: { localdep: "file:./localdep" },
      }),
      "localdep/package.json": JSON.stringify({ name: "localdep", version: "1.2.3" }),
      "localdep/index.js": first,
    };

    test.concurrent("keeps its source when links are refused", async () => {
      using dir = tempDir("hardlink-folder-relink", files);
      const source = join(String(dir), "localdep", "index.js");
      const installed = join(String(dir), "node_modules", "localdep", "index.js");

      expect((await install(String(dir), ["--linker", "isolated"])).exitCode).toBe(0);
      expect(statSync(installed).ino).toBe(statSync(source).ino);

      // The installed file is a hard link of the source now. A copy that
      // opens it to write, and does not replace it, writes into the source.
      writeFileSync(join(String(dir), "localdep", "added.js"), "module.exports = 'added';\n");
      const { stdout, exitCode } = await install(String(dir), ["--linker", "isolated"], { LINK_SHIM_ERRNO: EPERM });
      expect(stdout).toContain("1 package installed");
      expect({
        source: readFileSync(source, "utf8"),
        installed: readFileSync(installed, "utf8"),
        sameFile: statSync(installed).ino === statSync(source).ino,
      }).toEqual({ source: first, installed: first, sameFile: false });
      expect(linkCounts(join(String(dir), "node_modules", "localdep"))).toEqual({
        "added.js": 1,
        "index.js": 1,
        "package.json": 1,
      });
      expect(exitCode).toBe(0);
    });

    test.concurrent("replaces a longer copy when links are refused", async () => {
      using dir = tempDir("hardlink-folder-recopy", files);
      const source = join(String(dir), "localdep", "index.js");
      const installed = join(String(dir), "node_modules", "localdep", "index.js");

      expect((await install(String(dir), ["--linker", "isolated"], { LINK_SHIM_ERRNO: EPERM })).exitCode).toBe(0);
      expect(readFileSync(installed, "utf8")).toBe(first);

      const second = "module.exports = 2;\n";
      writeFileSync(source, second);
      const { stdout, exitCode } = await install(String(dir), ["--linker", "isolated"], { LINK_SHIM_ERRNO: EPERM });
      expect(stdout).toContain("1 package installed");
      expect(readFileSync(installed, "utf8")).toBe(second);
      expect(exitCode).toBe(0);
    });

    // The folder is linked first, whatever the backend is.
    test.concurrent("installs with --backend=copyfile when links fail with EMLINK", async () => {
      using dir = tempDir("hardlink-folder-copyfile-EMLINK", files);

      const { stdout, stderr, exitCode } = await install(
        String(dir),
        ["--linker", "isolated", "--backend", "copyfile"],
        { LINK_SHIM_ERRNO: EMLINK },
      );
      expect(stderr).not.toContain("EMLINK");
      expect(stdout).toContain("1 package installed");
      expect(linkCounts(join(String(dir), "node_modules", "localdep"))).toEqual({ "index.js": 1, "package.json": 1 });
      expect(exitCode).toBe(0);
    });
  });
});

// No injection: NTFS refuses one more hard link to a file that has 1023 of them.
test.skipIf(!isWindows)(
  "a file at the NTFS link limit is copied and the rest stay linked, isolated linker",
  async () => {
    using dir = tempDir("hardlink-ntfs-limit", {
      "package.json": JSON.stringify({
        name: "hardlink-fallback-test",
        dependencies: { pkg: "file:./pkg.tgz" },
      }),
    });
    await Bun.write(
      join(String(dir), "pkg.tgz"),
      await tarball("pkg", {
        "index.js": "module.exports = 'pkg';\n",
        "lib/full.txt": "full\n",
        "lib/other.txt": "other\n",
      }),
    );
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

    const full = join(cachedPackage(String(dir)), "lib", "full.txt");
    mkdirSync(join(String(dir), "links"));
    let refused = false;
    for (let i = 0; i < 1100 && !refused; i++) {
      try {
        linkSync(full, join(String(dir), "links", String(i)));
      } catch {
        refused = true;
      }
    }

    const { stdout, exitCode } = await install();
    expect(stdout).toContain("1 package installed");
    expect(readFileSync(join(String(dir), "node_modules", "pkg", "lib", "full.txt"), "utf8")).toBe("full\n");
    // A file system other than NTFS may have no such limit. The install works on it too.
    if (refused) {
      expect(linkCounts(join(String(dir), "node_modules", "pkg"))).toEqual({
        "index.js": 2,
        "lib/full.txt": 1,
        "lib/other.txt": 2,
        "package.json": 2,
      });
    }
    expect(exitCode).toBe(0);
  },
);

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
