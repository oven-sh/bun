import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

// https://github.com/oven-sh/bun/issues/28215
// On WSL2, local ext4 filesystems can be slow enough to trigger the
// "Slow filesystem detected" warning. The fix uses statfs() to check
// whether the filesystem is actually a network filesystem before warning.
test("bun install should not warn about slow filesystem on local filesystems", async () => {
  using dir = tempDir("issue-28215", {
    "package.json": JSON.stringify({
      name: "issue-28215",
      dependencies: {},
    }),
  });

  const cacheDir = join(String(dir), ".cache");
  const tmpDir = join(String(dir), ".tmp");

  await using proc = Bun.spawn({
    cmd: [bunExe(), "install"],
    cwd: String(dir),
    env: {
      ...bunEnv,
      BUN_INSTALL_CACHE_DIR: cacheDir,
      BUN_TMPDIR: tmpDir,
    },
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stderr, stdout, exitCode] = await Promise.all([proc.stderr.text(), proc.stdout.text(), proc.exited]);

  // On a local filesystem, the "Slow filesystem" warning should never appear
  expect(stderr).not.toContain("Slow filesystem detected");

  expect(exitCode).toBe(0);
});
