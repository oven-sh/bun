import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";
import { join } from "path";

test("yarn.lock should properly quote dependencies with special characters like workspace:", async () => {
  const dir = tempDirWithFiles("20774", {
    "package.json": JSON.stringify({
      name: "test-workspace",
      private: true,
      workspaces: ["packages/*"],
      dependencies: {
        "opencode": "workspace:*",
        "lodash": "^4.17.21",
      },
    }),
    "packages/opencode/package.json": JSON.stringify({
      name: "opencode",
      version: "1.0.0",
    }),
  });

  // Generate yarn.lock with --yarn flag
  await using proc = Bun.spawn({
    cmd: [bunExe(), "install", "--yarn"],
    env: bunEnv,
    cwd: dir,
    stderr: "pipe",
    stdout: "pipe",
  });

  await proc.exited;

  // Read the generated yarn.lock file
  const yarnLockPath = join(dir, "yarn.lock");
  const yarnLockExists = await Bun.file(yarnLockPath).exists();
  expect(yarnLockExists).toBe(true);

  const yarnLockContent = await Bun.file(yarnLockPath).text();

  // Check that dependencies with special characters are properly quoted
  // For workspace: protocol (this should be quoted with our fix)
  expect(yarnLockContent).toMatch(/"opencode@workspace:\*":/);

  // Regular packages should still work
  expect(yarnLockContent).toMatch(/lodash@/);

  // Make sure the generated file doesn't have the bug (unquoted workspace:)
  expect(yarnLockContent).not.toMatch(/opencode@workspace:\*:/);
});
