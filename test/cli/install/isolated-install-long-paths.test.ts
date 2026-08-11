// The isolated linker copies a folder dependency with a directory walk that
// opens every directory relative to its parent, so the walk reaches entries
// whose path is longer than PATH_MAX, while the destination path for each
// entry is built in a PATH_MAX-sized buffer. Such a package has to fail with
// ENAMETOOLONG, as it does with the hoisted linker, instead of crashing the
// install.
//
// Skipped on Windows: the path buffers there hold 32767 UTF-16 units, which is
// also the limit of the filesystem, so a tree that overflows them cannot be
// created in the first place.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isMacOS, isWindows, tempDir } from "harness";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const PATH_MAX = isMacOS ? 1024 : 4096;
const SEGMENT = Buffer.alloc(100, "d").toString();
// Every mkdir/rename issued by createDeepChain names at most CHUNK_DEPTH + 1
// segments below the temp dir, which fits PATH_MAX on every platform.
const CHUNK_DEPTH = 4;
const CHUNK = Array(CHUNK_DEPTH).fill(SEGMENT).join("/");
const CHUNK_BYTES = CHUNK.length + 1;

const OVERFLOWING_CHUNKS = Math.ceil((PATH_MAX + 256) / CHUNK_BYTES);
const FITTING_CHUNKS = Math.floor(PATH_MAX / 2 / CHUNK_BYTES);

/**
 * Creates a straight chain of `chunks * CHUNK_DEPTH` directories in `pkgDir`,
 * optionally with a file at the bottom, and returns the chain relative to
 * `pkgDir`. The chunks are created side by side in `staging` and then renamed
 * into each other from the bottom up, so the finished chain can be longer than
 * PATH_MAX even though no single syscall sees more than one chunk of it.
 */
function createDeepChain(pkgDir: string, staging: string, chunks: number, leaf?: string): string {
  for (let i = 0; i < chunks; i++) {
    mkdirSync(join(staging, String(i), CHUNK), { recursive: true });
  }
  if (leaf !== undefined) {
    writeFileSync(join(staging, String(chunks - 1), CHUNK, leaf), "deep");
  }
  for (let i = chunks - 1; i > 0; i--) {
    renameSync(join(staging, String(i), SEGMENT), join(staging, String(i - 1), CHUNK, SEGMENT));
  }
  renameSync(join(staging, "0", SEGMENT), join(pkgDir, SEGMENT));
  return Array(chunks * CHUNK_DEPTH).fill(SEGMENT).join("/");
}

async function installFolderDependency(chunks: number, leaf?: string) {
  using dir = tempDir("isolated-long-paths", {
    "package.json": JSON.stringify({ name: "proj", dependencies: { pkg: "file:./pkg" } }),
    "pkg/package.json": JSON.stringify({ name: "pkg", version: "1.0.0" }),
  });
  const chain = createDeepChain(join(String(dir), "pkg"), join(String(dir), "staging"), chunks, leaf);

  await using proc = Bun.spawn({
    cmd: [bunExe(), "install", "--linker", "isolated"],
    cwd: String(dir),
    env: { ...bunEnv, BUN_INSTALL_CACHE_DIR: join(String(dir), "cache") },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const installedLeaf =
    exitCode === 0 && leaf !== undefined
      ? readFileSync(join(String(dir), "node_modules", "pkg", chain, leaf), "utf8")
      : undefined;
  return { stdout, stderr, exitCode, installedLeaf };
}

describe.skipIf(isWindows)("isolated linker and folder dependencies deeper than PATH_MAX", () => {
  test.concurrent("a file below PATH_MAX depth fails the package with ENAMETOOLONG", async () => {
    const { stderr, exitCode } = await installFolderDependency(OVERFLOWING_CHUNKS, "leaf.txt");
    expect(stderr).toContain("ENAMETOOLONG");
    expect(stderr).toContain("failed to link package: pkg@");
    expect(exitCode).toBe(1);
  });

  test.concurrent("a directory below PATH_MAX depth fails the package with ENAMETOOLONG", async () => {
    const { stderr, exitCode } = await installFolderDependency(OVERFLOWING_CHUNKS);
    expect(stderr).toContain("ENAMETOOLONG");
    expect(stderr).toContain("failed to link package: pkg@");
    expect(exitCode).toBe(1);
  });

  test.concurrent("a deep tree that fits PATH_MAX still installs", async () => {
    const { stdout, stderr, exitCode, installedLeaf } = await installFolderDependency(FITTING_CHUNKS, "leaf.txt");
    expect(stderr).not.toContain("ENAMETOOLONG");
    expect(stdout).toMatch(/\d+ packages? installed/);
    expect(exitCode).toBe(0);
    expect(installedLeaf).toBe("deep");
  });
});
