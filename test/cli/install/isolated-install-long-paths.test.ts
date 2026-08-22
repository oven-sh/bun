// The isolated linker installs a package with a directory walk that opens every
// directory relative to its parent, so it reaches entries whose path is longer
// than the buffer each entry's destination path is built in. Such an entry has
// to fail the package with ENAMETOOLONG (as it does with the hoisted linker)
// instead of crashing or exiting the install, whichever backend ends up
// materializing the package.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, isWindows, tempDir } from "harness";
import { cpSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Size of the buffers the destination paths are built in: PATH_MAX bytes on
// POSIX (bun_core::MAX_PATH_BYTES), 32767 UTF-16 units on Windows.
const PATH_BUFFER_LEN = isWindows ? 32767 : isLinux ? 4096 : 1024;
// Where the isolated linker materializes the `file:./pkg` dependency used
// below, relative to the project. The destination of an entry is this, a
// separator and the entry's path inside the package.
const STORE_PKG_DIR = join("node_modules", ".bun", "pkg@file+pkg", "node_modules", "pkg");

const SEGMENT_LEN = 100;
const SEGMENT = Buffer.alloc(SEGMENT_LEN, "d").toString();
// createDeepChain never names more directories of a chain than this in one
// path, which keeps everything it hands to the filesystem well below the 1024
// bytes of macOS.
const CHUNK_DEPTH = 4;

type Leaf = { name: string; contents: string };
const LEAF: Leaf = { name: "leaf.js", contents: "module.exports = 'deep';" };

/** Directory names whose joined relative path is exactly `joinedLen` long. */
function chainDirs(joinedLen: number): string[] {
  const dirs: string[] = [];
  let remaining = joinedLen;
  while (remaining > 2 * SEGMENT_LEN + 1) {
    dirs.push(SEGMENT);
    remaining -= SEGMENT_LEN + 1;
  }
  dirs.push(Buffer.alloc(remaining, "e").toString());
  expect(dirs.join("/")).toHaveLength(joinedLen);
  return dirs;
}

/**
 * Nests `dirs` inside `pkgDir`, optionally with a file in the deepest one. The
 * chain may be longer than any path the filesystem accepts: it is created as
 * chunks of CHUNK_DEPTH directories side by side in `staging`, and the chunks
 * are renamed into each other from the deepest one up, so no single operation
 * names more than one chunk of it.
 */
function createDeepChain(pkgDir: string, staging: string, dirs: string[], leaf?: Leaf) {
  const chunks: string[][] = [];
  for (let i = 0; i < dirs.length; i += CHUNK_DEPTH) {
    chunks.push(dirs.slice(i, i + CHUNK_DEPTH));
  }
  for (let i = 0; i < chunks.length; i++) {
    mkdirSync(join(staging, String(i), ...chunks[i]), { recursive: true });
  }
  if (leaf !== undefined) {
    const deepest = chunks.length - 1;
    writeFileSync(join(staging, String(deepest), ...chunks[deepest], leaf.name), leaf.contents);
  }
  for (let i = chunks.length - 1; i > 0; i--) {
    renameSync(join(staging, String(i), chunks[i][0]), join(staging, String(i - 1), ...chunks[i - 1], chunks[i][0]));
  }
  renameSync(join(staging, "0", chunks[0][0]), join(pkgDir, chunks[0][0]));
}

/** A project depending on `file:./pkg`, with `dirs` (and `leaf`) inside pkg. */
function projectWithDeepFolderDependency(name: string, dirs: string[], leaf?: Leaf) {
  const dir = tempDir(name, {
    "package.json": JSON.stringify({ name: "proj", dependencies: { pkg: "file:./pkg" } }),
    "pkg/package.json": JSON.stringify({ name: "pkg", version: "1.0.0" }),
  });
  createDeepChain(join(String(dir), "pkg"), join(String(dir), "staging"), dirs, leaf);
  return dir;
}

async function bunInstall(projectDir: string, ...args: string[]) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "install", "--linker", "isolated", ...args],
    cwd: projectDir,
    env: { ...bunEnv, BUN_INSTALL_CACHE_DIR: join(projectDir, ".cache") },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

type InstallResult = Awaited<ReturnType<typeof bunInstall>>;

function expectInstalled({ stdout, stderr, exitCode }: InstallResult) {
  expect(stderr).not.toContain("ENAMETOOLONG");
  expect(stdout).toMatch(/\d+ packages? installed/);
  expect(exitCode).toBe(0);
}

function expectPackageFailure({ stdout, stderr, exitCode }: InstallResult, packageName: string) {
  expect(stderr).toContain("ENAMETOOLONG");
  expect(stderr).toContain(`failed to link package: ${packageName}@`);
  expect(stdout).toContain("Failed to install 1 package");
  expect(exitCode).toBe(1);
}

/**
 * Reads an installed file by its project-relative path from a process running
 * in the project, for files whose path joined to the project directory is
 * longer than what this process may hand to the filesystem.
 */
async function readInstalledFile(projectDir: string, relativePath: string) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", `process.stdout.write(require("fs").readFileSync(${JSON.stringify(relativePath)}, "utf8"))`],
    cwd: projectDir,
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
  return stdout;
}

test.concurrent("a folder dependency with a deep tree that fits installs", async () => {
  // Past the 260 characters of Windows' legacy MAX_PATH, well inside the buffer everywhere.
  const dirs = chainDirs(isWindows ? 4096 : PATH_BUFFER_LEN / 2);
  using dir = projectWithDeepFolderDependency("isolated-deep-fits", dirs, LEAF);

  expectInstalled(await bunInstall(String(dir)));
  expect(readFileSync(join(String(dir), "node_modules", "pkg", ...dirs, LEAF.name), "utf8")).toBe(LEAF.contents);
});

// On Windows the buffer holds as much as the filesystem does, so no tree that
// exists overflows it with a store-relative path; the Windows test at the
// bottom overflows with the absolute path instead.
describe.skipIf(isWindows)("a folder dependency with a tree deeper than PATH_MAX", () => {
  test.concurrent("fails with ENAMETOOLONG when a directory does not fit", async () => {
    using dir = projectWithDeepFolderDependency("isolated-deep-dir", chainDirs(PATH_BUFFER_LEN + 256));
    expectPackageFailure(await bunInstall(String(dir)), "pkg");
  });

  // The two trees below differ by one byte of destination path. Their
  // directories fit either way, so the file is the entry that decides.
  const leaf: Leaf = { name: "f", contents: LEAF.contents };
  const dirsForDestinationLength = (destinationLen: number) =>
    chainDirs(destinationLen - (STORE_PKG_DIR.length + 1) - (1 + leaf.name.length));

  test.concurrent("installs a file whose destination path is one byte short of PATH_MAX", async () => {
    const dirs = dirsForDestinationLength(PATH_BUFFER_LEN - 1);
    const destination = join(STORE_PKG_DIR, ...dirs, leaf.name);
    expect(destination).toHaveLength(PATH_BUFFER_LEN - 1);
    using dir = projectWithDeepFolderDependency("isolated-exact-fits", dirs, leaf);

    expectInstalled(await bunInstall(String(dir)));
    expect(await readInstalledFile(String(dir), destination)).toBe(leaf.contents);
  });

  test.concurrent("fails with ENAMETOOLONG for a file whose destination path is exactly PATH_MAX", async () => {
    const dirs = dirsForDestinationLength(PATH_BUFFER_LEN);
    expect(join(STORE_PKG_DIR, ...dirs, leaf.name)).toHaveLength(PATH_BUFFER_LEN);
    using dir = projectWithDeepFolderDependency("isolated-exact-over", dirs, leaf);

    expectPackageFailure(await bunInstall(String(dir)), "pkg");
  });
});

// Folder dependencies are always hardlinked; --backend selects how packages
// from the cache are materialized. Install once to populate the cache, add the
// deep tree to the cached copy, and reinstall from it.
describe.skipIf(isWindows)("a cached package with a tree deeper than PATH_MAX", () => {
  for (const backend of ["hardlink", "copyfile"]) {
    test.concurrent(`fails with ENAMETOOLONG with the ${backend} backend`, async () => {
      using dir = tempDir(`isolated-cached-${backend}`, {
        "package.json": JSON.stringify({ name: "proj", dependencies: { bar: "file:./bar-0.0.2.tgz" } }),
      });
      cpSync(join(import.meta.dir, "bar-0.0.2.tgz"), join(String(dir), "bar-0.0.2.tgz"));
      expectInstalled(await bunInstall(String(dir)));

      const cacheEntries = join(String(dir), ".cache", "bar");
      const [cachedPackage] = readdirSync(cacheEntries).map(entry => realpathSync(join(cacheEntries, entry)));
      createDeepChain(cachedPackage, join(String(dir), "staging"), chainDirs(PATH_BUFFER_LEN + 256), LEAF);
      rmSync(join(String(dir), "node_modules"), { recursive: true });

      expectPackageFailure(await bunInstall(String(dir), "--backend", backend), "bar");
    });
  }
});

// On Windows a file is linked by its absolute destination, `\??\`, the working
// directory and the store path, assembled in a buffer of PATH_BUFFER_LEN units
// after the store-relative part passed its own length check. The package's own
// paths are shorter than their destinations by the store prefix, so a package
// that exists on disk can still have a destination that does not fit. The
// entry below sits in the middle of that window.
test.skipIf(!isWindows)(
  "a folder dependency whose absolute destination does not fit fails with ENAMETOOLONG",
  async () => {
    using dir = tempDir("isolated-absolute-over", {
      "package.json": JSON.stringify({ name: "proj", dependencies: { pkg: "file:./pkg" } }),
      "pkg/package.json": JSON.stringify({ name: "pkg", version: "1.0.0" }),
    });
    const projectDir = realpathSync.native(String(dir));
    const destinationPrefix = `\\??\\${projectDir}\\${STORE_PKG_DIR}\\`;
    const sourcePrefix = `\\\\?\\${projectDir}\\pkg\\`;
    const entryLen = PATH_BUFFER_LEN - Math.ceil((destinationPrefix.length + sourcePrefix.length) / 2);
    expect(destinationPrefix.length + entryLen).toBeGreaterThanOrEqual(PATH_BUFFER_LEN);
    expect(sourcePrefix.length + entryLen).toBeLessThan(PATH_BUFFER_LEN);
    // A long file name keeps every directory of the chain addressable, so the
    // file is the entry that does not fit.
    const leaf: Leaf = { name: Buffer.alloc(SEGMENT_LEN, "f").toString(), contents: LEAF.contents };
    const dirs = chainDirs(entryLen - 1 - leaf.name.length);
    createDeepChain(join(String(dir), "pkg"), join(String(dir), "staging"), dirs, leaf);

    expectPackageFailure(await bunInstall(String(dir)), "pkg");
  },
);
