import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// Test that "bun pm cache rm" works without a package.json
// https://github.com/oven-sh/bun/issues/26427
test("bun pm cache rm works without package.json", async () => {
  // Use a temp directory without a package.json
  using dir = tempDir("bun-test-26427", {});

  await using proc = Bun.spawn({
    cmd: [bunExe(), "pm", "cache", "rm"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

  // Should succeed and clear the cache without requiring -g flag
  expect(stdout).toContain("Cleared");
  expect(exitCode).toBe(0);
});

// Test that "bun pm cache" (print path) works without a package.json
test("bun pm cache works without package.json", async () => {
  // Use a temp directory without a package.json
  using dir = tempDir("bun-test-26427-cache", {});

  await using proc = Bun.spawn({
    cmd: [bunExe(), "pm", "cache"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

  // Should succeed and print an absolute path to the cache directory
  const trimmedOutput = stdout.trim();
  // Check that it's an absolute path (starts with / on Unix or drive letter on Windows)
  expect(trimmedOutput.startsWith("/") || /^[A-Za-z]:/.test(trimmedOutput)).toBe(true);
  expect(exitCode).toBe(0);
});
