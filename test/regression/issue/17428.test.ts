import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// https://github.com/oven-sh/bun/issues/17428
// `bun publish --dry-run` should not require authentication
test("bun publish --dry-run works without authentication", async () => {
  using dir = tempDir("publish-dry-run-no-auth", {
    "package.json": JSON.stringify({
      name: "dry-run-no-auth-test",
      version: "1.0.0",
    }),
    "index.js": "module.exports = {};",
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "publish", "--dry-run"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).not.toContain("missing authentication");
  expect(stdout).toContain("dry-run-no-auth-test");
  expect(stdout).toContain("(dry-run)");
  expect(exitCode).toBe(0);
});
