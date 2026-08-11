// The hoisted install backends (PackageInstall.rs) walk the package and build
// each destination path, and for the symlink backend each link target, in a
// fixed PATH_MAX sized buffer. An entry that does not fit has to fail the
// package install with ENAMETOOLONG instead of writing past the buffer, and a
// directory the walker fails to create has to fail the install instead of
// being skipped while the install reports success.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isMacOS, isWindows, tempDir } from "harness";
import { existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// bun's PathBuffer is PATH_MAX bytes: 4096 on Linux, 1024 on macOS.
const PATH_MAX = isMacOS ? 1024 : 4096;
const DIR_NAME_LEN = 100;

/**
 * Path components (ASCII, so bytes == chars) whose "/"-joined length is exactly
 * `totalLen`. The last component is sized to make the total exact.
 */
function deepComponents(totalLen: number): string[] {
  const parts = [Buffer.alloc(DIR_NAME_LEN, "d").toString()];
  let remaining = totalLen - DIR_NAME_LEN;
  while (remaining > DIR_NAME_LEN + 1 + 8) {
    parts.push(Buffer.alloc(DIR_NAME_LEN, "d").toString());
    remaining -= DIR_NAME_LEN + 1;
  }
  parts.push(Buffer.alloc(remaining - 1, "f").toString());
  return parts;
}

/**
 * Creates `parts` as a chain of nested directories inside `packageDir`. When
 * `leafContent` is given the last part is created as a file.
 *
 * The chain is longer than PATH_MAX, so it cannot be created with absolute
 * paths. Each chunk of the chain is built under a short staging path, then the
 * chunks are nested from the deepest up with rename(), so no path handed to
 * the filesystem is longer than about PATH_MAX / 2 plus the staging prefix.
 */
function createDeepChain(stagingDir: string, packageDir: string, parts: string[], leafContent?: string) {
  const chunks: string[][] = [[]];
  for (const part of parts) {
    const chunk = chunks[chunks.length - 1];
    if (join(...chunk, part).length > PATH_MAX / 2) {
      chunks.push([part]);
    } else {
      chunk.push(part);
    }
  }

  // Staging location and name of the chunk assembled so far; it gets moved
  // under the deepest directory of the next (shallower) chunk.
  let assembled: { path: string; name: string } | undefined;
  for (let i = chunks.length - 1; i >= 0; i--) {
    const chunk = chunks[i];
    const chunkStaging = join(stagingDir, String(i));
    const isLeafChunk = leafContent !== undefined && i === chunks.length - 1;
    const dirs = isLeafChunk ? chunk.slice(0, -1) : chunk;
    const deepest = join(chunkStaging, ...dirs);
    mkdirSync(deepest, { recursive: true });
    if (isLeafChunk) {
      writeFileSync(join(deepest, chunk[chunk.length - 1]), leafContent);
    }
    if (assembled !== undefined) {
      renameSync(assembled.path, join(deepest, assembled.name));
    }
    assembled = { path: join(chunkStaging, chunk[0]), name: chunk[0] };
  }
  renameSync(assembled!.path, join(packageDir, assembled!.name));
}

async function install(projectDir: string, backend: string) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "install", "--linker=hoisted", `--backend=${backend}`],
    cwd: projectDir,
    env: { ...bunEnv, BUN_INSTALL_CACHE_DIR: join(projectDir, ".cache") },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

function project(name: string) {
  return tempDir(name, {
    "package.json": JSON.stringify({ name: "app", dependencies: { pkg: "file:./pkg" } }),
    "pkg/package.json": JSON.stringify({ name: "pkg", version: "1.0.0" }),
    "pkg/index.js": "module.exports = 1;",
  });
}

const EXPECTED_FAILURE = "ENAMETOOLONG: failed copying files from cache to destination for package pkg";

// Debug builds symbolize and print a stack trace for every failed package
// install, which takes several seconds per install on its own.
const FAILING_INSTALL_TIMEOUT = 60_000;

// The Windows backends use wide paths with a 32767 unit buffer; these limits
// are the POSIX ones.
describe.skipIf(isWindows)("install backends and paths near PATH_MAX", () => {
  test.concurrent(
    "symlink backend reports a link target longer than PATH_MAX",
    async () => {
      using dir = project("long-target");
      using staging = tempDir("long-target-staging", {});
      // The path relative to the package fits in PATH_MAX on its own; joined to
      // the absolute package directory (the link target) it does not.
      const parts = deepComponents(PATH_MAX - 1);
      createDeepChain(String(staging), join(String(dir), "pkg"), parts, "module.exports = 2;");

      const { stdout, stderr, exitCode } = await install(String(dir), "symlink");
      expect(stderr).toContain(EXPECTED_FAILURE);
      expect(stdout).toContain("Failed to install 1 package");
      expect(exitCode).toBe(1);
    },
    FAILING_INSTALL_TIMEOUT,
  );

  for (const backend of ["hardlink", "symlink"]) {
    test.concurrent(
      `${backend} backend reports a directory it could not create`,
      async () => {
        using dir = project(`deep-dir-${backend}`);
        using staging = tempDir(`deep-dir-${backend}-staging`, {});
        // An empty directory, so failing to create it is the only thing that
        // can fail the install.
        createDeepChain(String(staging), join(String(dir), "pkg"), deepComponents(PATH_MAX + DIR_NAME_LEN));

        const { stdout, stderr, exitCode } = await install(String(dir), backend);
        expect(stderr).toContain(EXPECTED_FAILURE);
        expect(stdout).toContain("Failed to install 1 package");
        expect(exitCode).toBe(1);
      },
      FAILING_INSTALL_TIMEOUT,
    );

    test.concurrent(`${backend} backend still installs nested directories that fit`, async () => {
      using dir = project(`nested-${backend}`);
      const nested = join(String(dir), "pkg", "a", "b", "c");
      mkdirSync(nested, { recursive: true });
      writeFileSync(join(nested, "leaf.js"), "module.exports = 3;");
      mkdirSync(join(String(dir), "pkg", "empty"));

      const { stdout, stderr, exitCode } = await install(String(dir), backend);
      expect(stderr).not.toContain("error");
      expect(stdout).toContain("1 package installed");
      expect(exitCode).toBe(0);
      const installed = join(String(dir), "node_modules", "pkg");
      expect(existsSync(join(installed, "a", "b", "c", "leaf.js"))).toBe(true);
      expect(existsSync(join(installed, "empty"))).toBe(true);
    });
  }
});
