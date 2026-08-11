// The hoisted install backends (PackageInstall.rs) walk the package and build
// each destination path, and for the symlink backend each link target, in a
// fixed size path buffer. An entry that does not fit has to fail the package
// install with ENAMETOOLONG instead of writing past the buffer, a directory the
// walker fails to create has to fail the install instead of being skipped while
// the install reports success, and a file that cannot be installed has to fail
// the package (as it does with the hardlink backend) rather than exit bun.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, isMacOS, isWindows, tempDir } from "harness";
import {
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

// PathBuffer is PATH_MAX bytes on POSIX (4096 on Linux, 1024 on macOS); the
// Windows backends build wide paths in a 32767 unit WPathBuffer.
const PATH_BUFFER_LEN = isWindows ? 32767 : isMacOS ? 1024 : 4096;
const DIR_NAME_LEN = 100;

const EXPECTED_FAILURE = "ENAMETOOLONG: failed copying files from cache to destination for package pkg";

// Debug builds symbolize and print a stack trace for every failed package
// install, which takes several seconds per install on its own. The tests run
// concurrently, so the quick ones wait on the same CPU while that happens.
const INSTALL_TIMEOUT = 60_000;

/**
 * Directory names (ASCII, so bytes == UTF-16 units == chars) whose joined
 * relative path is exactly `joinedLen` long. The last name is sized to make
 * the total exact.
 */
function deepDirs(joinedLen: number): string[] {
  const dirs = [Buffer.alloc(DIR_NAME_LEN, "d").toString()];
  let remaining = joinedLen - DIR_NAME_LEN;
  while (remaining > DIR_NAME_LEN + 1 + 8) {
    dirs.push(Buffer.alloc(DIR_NAME_LEN, "d").toString());
    remaining -= DIR_NAME_LEN + 1;
  }
  dirs.push(Buffer.alloc(remaining - 1, "e").toString());
  return dirs;
}

/**
 * Creates the chain of nested directories `dirs` inside `packageDir` and puts
 * `leaves` (name -> file contents, or null for an empty directory) into the
 * deepest one.
 *
 * The chain is about as long as the path buffer, so it cannot be created with
 * absolute paths. Each chunk of the chain is built under a short staging path
 * and the chunks are nested from the deepest one up with rename(), so nothing
 * handed to the filesystem is longer than about half the buffer.
 */
function createDeepChain(
  stagingDir: string,
  packageDir: string,
  dirs: string[],
  leaves: Record<string, string | null>,
) {
  const chunks: string[][] = [[]];
  for (const dir of dirs) {
    const chunk = chunks[chunks.length - 1];
    if (join(...chunk, dir).length > PATH_BUFFER_LEN / 2) {
      chunks.push([dir]);
    } else {
      chunk.push(dir);
    }
  }

  // Staging location and name of the part assembled so far; it gets moved
  // under the deepest directory of the next (shallower) chunk.
  let assembled: { path: string; name: string } | undefined;
  for (let i = chunks.length - 1; i >= 0; i--) {
    const chunk = chunks[i];
    const chunkStaging = join(stagingDir, String(i));
    const deepest = join(chunkStaging, ...chunk);
    mkdirSync(deepest, { recursive: true });
    if (i === chunks.length - 1) {
      for (const [name, contents] of Object.entries(leaves)) {
        if (contents === null) mkdirSync(join(deepest, name));
        else writeFileSync(join(deepest, name), contents);
      }
    }
    if (assembled !== undefined) {
      renameSync(assembled.path, join(deepest, assembled.name));
    }
    assembled = { path: join(chunkStaging, chunk[0]), name: chunk[0] };
  }
  renameSync(assembled!.path, join(packageDir, assembled!.name));
}

/**
 * Entries whose relative path lengths run from `center - spread` to
 * `center + spread`. Their names share a prefix and grow by one unit each, so
 * directory enumeration (NTFS returns names sorted) yields the shortest first,
 * and the one that lands exactly on `center` is reached before any longer one.
 * Also returns the joined length the directory chain above them needs to have.
 */
function fanOfLeaves(center: number, spread: number, contents: string | null) {
  const shortestName = 16;
  const leaves: Record<string, string | null> = {};
  for (let i = 0; i <= 2 * spread; i++) {
    leaves[Buffer.alloc(shortestName + i, "f").toString()] = contents;
  }
  // The middle leaf (name length shortestName + spread) lands on `center`.
  return { leaves, dirsLen: center - 1 - shortestName - spread };
}

const isRoot = typeof process.getuid === "function" && process.getuid() === 0;

// Root ignores directory permissions. When the tests run as root on Linux the
// install that depends on them runs as `nobody` instead (like
// test/cli/run/env.test.ts does); the test is skipped as root elsewhere.
const canRunAsNobody = (() => {
  if (!isLinux || !Bun.which("runuser")) return false;
  try {
    return /^nobody:/m.test(readFileSync("/etc/passwd", "utf8"));
  } catch {
    return false;
  }
})();
const canInstallWithoutPrivileges = !isRoot || canRunAsNobody;

async function install(projectDir: string, backend?: string, { unprivileged = false } = {}) {
  const bun = [bunExe(), "install", "--linker=hoisted", ...(backend ? [`--backend=${backend}`] : [])];
  await using proc = Bun.spawn({
    cmd: unprivileged && isRoot ? ["runuser", "-u", "nobody", "--", ...bun] : bun,
    cwd: projectDir,
    env: {
      ...bunEnv,
      BUN_INSTALL_CACHE_DIR: join(projectDir, ".cache"),
      ...(unprivileged ? { HOME: projectDir } : {}),
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

const packageFiles = {
  "package.json": JSON.stringify({ name: "pkg", version: "1.0.0" }),
  "index.js": "module.exports = 1;",
};

/** A project depending on `pkg` inside it (`file:./pkg`). */
function projectWithLocalPackage(name: string) {
  const dir = tempDir(name, {
    "package.json": JSON.stringify({ name: "app", dependencies: { pkg: "file:./pkg" } }),
    "pkg/package.json": packageFiles["package.json"],
    "pkg/index.js": packageFiles["index.js"],
  });
  return { dir, projectDir: String(dir), packageDir: join(String(dir), "pkg") };
}

/**
 * A project depending on `pkg` next to it (`file:../pkg`). Folder dependencies
 * outside the project are always installed with the symlink backend, which is
 * how that backend is reached on Windows.
 */
function projectWithSiblingPackage(name: string) {
  const dir = tempDir(name, {
    "project/package.json": JSON.stringify({ name: "app", dependencies: { pkg: "file:../pkg" } }),
    "pkg/package.json": packageFiles["package.json"],
    "pkg/index.js": packageFiles["index.js"],
  });
  return { dir, projectDir: join(String(dir), "project"), packageDir: join(String(dir), "pkg") };
}

describe.skipIf(isWindows)("install backends on POSIX", () => {
  // The copyfile backend only materializes files (parents are created on
  // demand), the others also create the package's directories.
  const directoryBackends = ["hardlink", "symlink", ...(isMacOS ? ["clonefile_each_dir"] : [])];
  const backends = [...directoryBackends, "copyfile"];

  for (const backend of backends) {
    test.concurrent(
      `${backend} backend reports a file whose relative path exceeds PATH_MAX`,
      async () => {
        const { dir, projectDir, packageDir } = projectWithLocalPackage(`deep-file-${backend}`);
        using _ = dir;
        using staging = tempDir(`deep-file-${backend}-staging`, {});
        // The directories all fit, so the file is the entry that fails.
        createDeepChain(String(staging), packageDir, deepDirs(PATH_BUFFER_LEN - DIR_NAME_LEN), {
          [Buffer.alloc(2 * DIR_NAME_LEN, "f").toString()]: "module.exports = 2;",
        });

        const { stdout, stderr, exitCode } = await install(projectDir, backend);
        expect(stderr).toContain(EXPECTED_FAILURE);
        expect(stdout).toContain("Failed to install 1 package");
        expect(exitCode).toBe(1);
      },
      INSTALL_TIMEOUT,
    );

    test.concurrent(
      `${backend} backend still installs nested directories that fit`,
      async () => {
        const { dir, projectDir, packageDir } = projectWithLocalPackage(`nested-${backend}`);
        using _ = dir;
        mkdirSync(join(packageDir, "a", "b", "c"), { recursive: true });
        writeFileSync(join(packageDir, "a", "b", "c", "leaf.js"), "module.exports = 3;");
        mkdirSync(join(packageDir, "empty"));

        const { stdout, stderr, exitCode } = await install(projectDir, backend);
        expect(stderr).not.toContain("error");
        expect(stdout).toContain("1 package installed");
        expect(exitCode).toBe(0);
        const installed = join(projectDir, "node_modules", "pkg");
        expect(existsSync(join(installed, "a", "b", "c", "leaf.js"))).toBe(true);
        expect(existsSync(join(installed, "empty"))).toBe(directoryBackends.includes(backend));
      },
      INSTALL_TIMEOUT,
    );
  }

  test.concurrent(
    "symlink backend reports a link target longer than PATH_MAX",
    async () => {
      const { dir, projectDir, packageDir } = projectWithLocalPackage("long-target");
      using _ = dir;
      using staging = tempDir("long-target-staging", {});
      // The path relative to the package fits in PATH_MAX on its own; joined to
      // the absolute package directory (the link target) it does not.
      const leaf = "leaf.js";
      createDeepChain(String(staging), packageDir, deepDirs(PATH_BUFFER_LEN - 1 - 1 - leaf.length), {
        [leaf]: "module.exports = 2;",
      });

      const { stdout, stderr, exitCode } = await install(projectDir, "symlink");
      expect(stderr).toContain(EXPECTED_FAILURE);
      expect(stdout).toContain("Failed to install 1 package");
      expect(exitCode).toBe(1);
    },
    INSTALL_TIMEOUT,
  );

  for (const backend of directoryBackends) {
    test.concurrent(
      `${backend} backend reports a directory it could not create`,
      async () => {
        const { dir, projectDir, packageDir } = projectWithLocalPackage(`deep-dir-${backend}`);
        using _ = dir;
        using staging = tempDir(`deep-dir-${backend}-staging`, {});
        // Only directories, so failing to create one is the only thing that
        // can fail the install.
        createDeepChain(String(staging), packageDir, deepDirs(PATH_BUFFER_LEN + DIR_NAME_LEN), {});

        const { stdout, stderr, exitCode } = await install(projectDir, backend);
        expect(stderr).toContain(EXPECTED_FAILURE);
        expect(stdout).toContain("Failed to install 1 package");
        expect(exitCode).toBe(1);
      },
      INSTALL_TIMEOUT,
    );
  }

  // When the previous install cannot be renamed away (node_modules itself is
  // read-only here), the symlink backend replaces each existing file. The
  // replacement used to point at the file's own basename, i.e. at itself.
  test.concurrent.skipIf(!canInstallWithoutPrivileges)(
    "symlink backend replaces an existing file with a link to the source",
    async () => {
      const { dir, projectDir, packageDir } = projectWithLocalPackage("replace-symlink");
      using _ = dir;
      const installed = join(projectDir, "node_modules", "pkg");
      mkdirSync(installed, { recursive: true });
      writeFileSync(join(installed, "index.js"), "stale");
      writeFileSync(join(installed, "not-in-the-package"), "");
      // Readable (and, where bun writes, writable) for `nobody` too.
      chmodSync(projectDir, 0o777);
      chmodSync(packageDir, 0o755);
      for (const file of Object.keys(packageFiles)) chmodSync(join(packageDir, file), 0o644);
      chmodSync(installed, 0o777);
      chmodSync(join(projectDir, "node_modules"), 0o555);
      try {
        const { stdout, stderr, exitCode } = await install(projectDir, "symlink", { unprivileged: true });
        expect(stderr).not.toContain("error");
        expect(stdout).toContain("1 package installed");
        expect(exitCode).toBe(0);
      } finally {
        chmodSync(join(projectDir, "node_modules"), 0o755);
      }
      // The old directory was indeed installed into rather than replaced.
      expect(existsSync(join(installed, "not-in-the-package"))).toBe(true);
      expect(readlinkSync(join(installed, "index.js"))).toBe(join(realpathSync.native(packageDir), "index.js"));
      expect(readFileSync(join(installed, "index.js"), "utf8")).toBe(packageFiles["index.js"]);
    },
    INSTALL_TIMEOUT,
  );
});

describe.skipIf(!isWindows)("install backends on Windows", () => {
  /**
   * Relative length of an entry whose destination path exactly fills the
   * buffer, which used to put the NUL terminator one unit past it. The walkers
   * prefix every entry with the final path of node_modules (which
   * GetFinalPathNameByHandle reports in \\?\ form), the package name and
   * separators.
   */
  function overflowingEntryLength(projectDir: string) {
    return PATH_BUFFER_LEN - ("\\\\?\\" + realpathSync.native(projectDir) + "\\node_modules\\pkg\\").length;
  }

  // The fan also covers the prefix length being off by a unit or two; every
  // source path still stays within what the OS (and the cleanup) can address,
  // because the source prefix is shorter than the destination prefix.
  const SPREAD = 3;

  // The hardlink walker skips directories and collects link failures from its
  // worker threads, so the length check is the only thing that can stop the
  // walk before it reaches the overflowing entry.
  test.concurrent(
    "hardlink backend reports a file whose destination exactly fills the path buffer",
    async () => {
      const { dir, projectDir, packageDir } = projectWithLocalPackage("exact-hardlink");
      using _ = dir;
      using staging = tempDir("exact-hardlink-staging", {});
      const { leaves, dirsLen } = fanOfLeaves(overflowingEntryLength(projectDir), SPREAD, "module.exports = 2;");
      createDeepChain(String(staging), packageDir, deepDirs(dirsLen), leaves);

      const { stdout, stderr, exitCode } = await install(projectDir, "hardlink");
      expect(stderr).toContain(EXPECTED_FAILURE);
      expect(stdout).toContain("Failed to install 1 package");
      expect(exitCode).toBe(1);
    },
    INSTALL_TIMEOUT,
  );

  /**
   * Runs the install while a file inside `node_modules/pkg/<leftoverDir>` is
   * held open. A previous install of the package then cannot be moved out of
   * the way, so the walker runs into the existing directory and takes the
   * fallback paths that used to create directories relative to the cwd.
   */
  async function installOverLeftover(projectDir: string, leftoverDir: string, backend: string | undefined) {
    const leftover = join(projectDir, "node_modules", "pkg", leftoverDir);
    mkdirSync(leftover, { recursive: true });
    writeFileSync(join(leftover, "held-open.txt"), "");
    const held = openSync(join(leftover, "held-open.txt"), "r");
    try {
      return await install(projectDir, backend);
    } finally {
      closeSync(held);
    }
  }

  for (const [walker, project, backend] of [
    ["copyfile", projectWithLocalPackage, "copyfile"],
    ["symlink", projectWithSiblingPackage, undefined],
  ] as const) {
    // These two walkers create directories as they go, and the OS rejects
    // destinations this long a little before they stop fitting the buffer, so
    // the directory that could not be created is what fails the install (the
    // length check itself is the same line as in the hardlink walker). Before
    // the fix that failure was ignored, the fallback created the chain under
    // the cwd, and the walk went on to overflow.
    test.concurrent(
      `${walker} walker reports a directory it could not create`,
      async () => {
        const { dir, projectDir, packageDir } = project(`exact-${walker}`);
        using _ = dir;
        using staging = tempDir(`exact-${walker}-staging`, {});
        const { leaves, dirsLen } = fanOfLeaves(overflowingEntryLength(projectDir), SPREAD, null);
        const dirs = deepDirs(dirsLen);
        createDeepChain(String(staging), packageDir, dirs, leaves);

        const { stdout, stderr, exitCode } = await install(projectDir, backend);
        expect(stderr).toContain(EXPECTED_FAILURE);
        expect(stdout).toContain("Failed to install 1 package");
        expect(exitCode).toBe(1);
        expect(existsSync(join(projectDir, dirs[0]))).toBe(false);
      },
      INSTALL_TIMEOUT,
    );

    test.concurrent(
      `${walker} walker installs into a leftover directory without creating it under the cwd`,
      async () => {
        const { dir, projectDir, packageDir } = project(`leftover-${walker}`);
        using _ = dir;
        mkdirSync(join(packageDir, "sub"));
        writeFileSync(join(packageDir, "sub", "inner.js"), "module.exports = 2;");

        const { stdout, exitCode } = await installOverLeftover(projectDir, "sub", backend);
        expect(stdout).toContain("1 package installed");
        expect(exitCode).toBe(0);
        expect(existsSync(join(projectDir, "node_modules", "pkg", "sub", "inner.js"))).toBe(true);
        expect(existsSync(join(projectDir, "sub"))).toBe(false);
      },
      INSTALL_TIMEOUT,
    );

    // The package's `sub/entry` is a file, but the leftover has a directory
    // there, so installing the entry fails even after the retry that creates
    // its parent. The copyfile walker used to exit the process at this point.
    test.concurrent(
      `${walker} walker reports a file it could not install into a leftover directory`,
      async () => {
        const { dir, projectDir, packageDir } = project(`conflict-${walker}`);
        using _ = dir;
        mkdirSync(join(packageDir, "sub"));
        writeFileSync(join(packageDir, "sub", "entry"), "module.exports = 2;");

        const { stdout, exitCode } = await installOverLeftover(projectDir, join("sub", "entry"), backend);
        expect(stdout).toContain("Failed to install 1 package");
        expect(exitCode).toBe(1);
        expect(existsSync(join(projectDir, "sub"))).toBe(false);
      },
      INSTALL_TIMEOUT,
    );
  }
});
