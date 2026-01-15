import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// Regression test for https://github.com/oven-sh/bun/issues/2342
// Git clone failures should include the actual git error output, not just a generic message
test("git clone failure should show actual git error output", async () => {
  using dir = tempDir("issue-2342", {
    "package.json": JSON.stringify({
      name: "test-git-error",
      version: "1.0.0",
      dependencies: {
        // Use a non-existent SSH URL to trigger a git clone failure with stderr
        "private-pkg": "git+ssh://git@bitbucket.org/nonexistent/nonexistent-repo-12345.git",
      },
    }),
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "install"],
    cwd: String(dir),
    env: { ...bunEnv, GIT_ASKPASS: "echo" },
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // The error message should contain the git clone failure with the actual git error details
  // Before the fix, this would only show: error: "git clone" for "private-pkg" failed
  // After the fix, it shows the actual git error like:
  //   error: "git clone" for "private-pkg" failed:
  //   git@bitbucket.org: Permission denied (publickey).
  //   fatal: Could not read from remote repository.
  expect(stderr).toContain('"git clone" for "private-pkg" failed');

  // The error should include the actual git stderr with "fatal:" message from git
  expect(stderr).toContain("fatal:");

  // The exit code should be non-zero
  expect(exitCode).not.toBe(0);
});
