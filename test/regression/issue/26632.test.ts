import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// https://github.com/oven-sh/bun/issues/26632
// Bun.file().text() on a non-existent file should throw ENOENT error, not silently exit
test("Bun.file().text() on nonexistent file throws ENOENT", async () => {
  using dir = tempDir("26632", {});

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", `await Bun.file("nonexistent-file-that-does-not-exist.txt").text();`],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toBe("");
  expect(stderr).toContain("ENOENT");
  expect(exitCode).not.toBe(0);
});

test("Bun.file().arrayBuffer() on nonexistent file throws ENOENT", async () => {
  using dir = tempDir("26632", {});

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", `await Bun.file("nonexistent-file-that-does-not-exist.txt").arrayBuffer();`],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toBe("");
  expect(stderr).toContain("ENOENT");
  expect(exitCode).not.toBe(0);
});

test("Bun.file().bytes() on nonexistent file throws ENOENT", async () => {
  using dir = tempDir("26632", {});

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", `await Bun.file("nonexistent-file-that-does-not-exist.txt").bytes();`],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toBe("");
  expect(stderr).toContain("ENOENT");
  expect(exitCode).not.toBe(0);
});
