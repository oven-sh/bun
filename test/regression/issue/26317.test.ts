// Regression test for https://github.com/oven-sh/bun/issues/26317
// Bun's shell should pass literal glob patterns to commands when no files match,
// instead of failing with "no matches found" (bash-like behavior vs zsh failglob)

import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("bun run --shell=bun with unmatched glob should not error", async () => {
  // Create a temp directory with no dist folder
  using dir = tempDir("issue-26317", {
    "package.json": JSON.stringify({
      scripts: {
        // This script uses a glob pattern that won't match any files
        clean: "echo dist/*",
      },
    }),
  });

  // Run the script using bun's shell
  await using proc = Bun.spawn({
    cmd: [bunExe(), "run", "--shell=bun", "clean"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // The literal pattern should be passed to echo, not cause a "no matches found" error
  expect(stdout.trim()).toBe("dist/*");
  expect(stderr).not.toContain("no matches found");
  expect(exitCode).toBe(0);
});

test("bun shell glob with no matches passes literal pattern", async () => {
  const { stdout, stderr, exitCode } = await Bun.$`echo nonexistent/*.xyz`.quiet();

  // When no files match, the literal pattern should be passed to the command
  expect(stdout.toString().trim()).toBe("nonexistent/*.xyz");
  expect(stderr.toString()).not.toContain("no matches found");
  expect(exitCode).toBe(0);
});
