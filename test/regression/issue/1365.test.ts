import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("running unsupported file types shows helpful error message instead of 'File not found'", async () => {
  using dir = tempDir("issue-1365", {
    "test.css": "body { color: red; }",
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test.css"],
    cwd: String(dir),
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toBe("");
  // Should NOT say "File not found" since the file exists
  expect(stderr).not.toContain("File not found");
  // Should indicate the file cannot be run
  expect(stderr).toContain("Cannot run");
  expect(stderr).toContain("test.css");
  // Should mention the file type
  expect(stderr).toContain("css");
  expect(exitCode).toBe(1);
});

test("actually missing files still show 'File not found'", async () => {
  using dir = tempDir("issue-1365-missing", {});

  await using proc = Bun.spawn({
    cmd: [bunExe(), "nonexistent.css"],
    cwd: String(dir),
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toBe("");
  expect(stderr).toContain("File not found");
  expect(stderr).toContain("nonexistent.css");
  expect(exitCode).toBe(1);
});
