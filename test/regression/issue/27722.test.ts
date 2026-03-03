import { expect, test } from "bun:test";
import { readlinkSync, symlinkSync, unlinkSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";

// Regression test for https://github.com/oven-sh/bun/issues/27722
// When bun creates symlinks in /tmp/bun-node-{sha}/ for the fake "node" binary,
// it should replace stale symlinks that point to a non-existent path.
test.skipIf(isWindows)("stale node symlink is replaced when binary path changes", () => {
  using dir = tempDir("issue-27722", {
    "package.json": JSON.stringify({
      scripts: {
        "which-node": "which node",
        "test-node": `node -e "process.stdout.write('works')"`,
      },
    }),
  });

  // Step 1: Run once to create the bun-node directory with correct symlinks
  const whichResult = Bun.spawnSync({
    cmd: [bunExe(), "--bun", "run", "--silent", "which-node"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const nodeSymlink = whichResult.stdout.toString().trim();
  expect(nodeSymlink).toContain("bun-node");
  expect(whichResult.exitCode).toBe(0);

  // Step 2: Replace symlinks with stale ones pointing to a non-existent path
  const bunSymlink = nodeSymlink.replace(/\/node$/, "/bun");
  unlinkSync(nodeSymlink);
  symlinkSync("/nonexistent/path/to/bun", nodeSymlink);
  unlinkSync(bunSymlink);
  symlinkSync("/nonexistent/path/to/bun", bunSymlink);

  // Verify the symlinks are now stale
  expect(readlinkSync(nodeSymlink)).toBe("/nonexistent/path/to/bun");

  // Step 3: Run again - bun should detect and fix stale symlinks
  const testResult = Bun.spawnSync({
    cmd: [bunExe(), "--bun", "run", "--silent", "test-node"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  expect(testResult.stdout.toString()).toBe("works");
  expect(testResult.exitCode).toBe(0);

  // Verify both symlinks now point to the actual bun binary
  expect(readlinkSync(nodeSymlink)).not.toBe("/nonexistent/path/to/bun");
  expect(readlinkSync(bunSymlink)).not.toBe("/nonexistent/path/to/bun");
});
