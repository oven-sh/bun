// The hoisted install backends (PackageInstall.rs) walk the package and build
// each destination path, and for the symlink backend each link target, in a
// fixed size path buffer. An entry that does not fit has to fail the package
// install with ENAMETOOLONG instead of writing past the buffer.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isMacOS, isWindows, MAX_PATH_BYTES, tempDir } from "harness";
import { existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// PathBuffer is PATH_MAX bytes on POSIX (4096 on Linux, 1024 on macOS); the
// Windows backends build wide paths in a 32767 unit WPathBuffer.
const PATH_BUFFER_LEN = isWindows ? 32767 : MAX_PATH_BYTES;
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

async function install(projectDir: string, backend?: string) {
  const bun = [bunExe(), "install", "--linker=hoisted", ...(backend ? [`--backend=${backend}`] : [])];
  await using proc = Bun.spawn({
    cmd: bun,
    cwd: projectDir,
    env: {
      ...bunEnv,
      BUN_INSTALL_CACHE_DIR: join(projectDir, ".cache"),
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
        // The copyfile backend leaves the file to the kernel, which reports the
        // same error from the open. It ends the whole install, not one package.
        if (backend === "copyfile") {
          expect(stderr).toContain("ENAMETOOLONG: copying file");
        } else {
          expect(stderr).toContain(EXPECTED_FAILURE);
          expect(stdout).toContain("Failed to install 1 package");
        }
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
});
