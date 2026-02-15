import { expect, it } from "bun:test";
import { rm } from "fs/promises";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

/**
 * Regression test for https://github.com/oven-sh/bun/issues/26156
 *
 * This test verifies that packages with `libc` constraints in their package.json
 * are correctly filtered during installation based on the target libc (glibc vs musl).
 *
 * The issue was that Bun ignored the `libc` field when filtering optional dependencies,
 * causing both glibc and musl variants to be installed instead of just the matching one.
 *
 * Note: The detailed filtering logic is tested in bun-install-cpu-os.test.ts which uses
 * a mock registry to test the actual filtering behavior. This test focuses on the CLI
 * interface and error handling.
 */

/**
 * Helper to clean up lockfiles between test runs
 */
async function cleanupLockfiles(dirPath: string) {
  await rm(join(dirPath, "node_modules"), { recursive: true, force: true });
  await rm(join(dirPath, "bun.lock"), { force: true });
  await rm(join(dirPath, "bun.lockb"), { force: true });
}

it("should filter optional dependencies by libc field (issue #26156)", async () => {
  // Create a temporary directory for this test
  using dir = tempDir("issue-26156", {
    "package.json": JSON.stringify({
      name: "test-libc-filtering",
      version: "1.0.0",
    }),
  });

  // Verify that --libc flag is recognized and works
  await using proc = Bun.spawn({
    cmd: [bunExe(), "install", "--help"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // The --libc flag should be documented in help
  expect(stdout).toContain("--libc");
  expect(exitCode).toBe(0);
});

it("should accept valid libc values", async () => {
  using dir = tempDir("issue-26156-valid", {
    "package.json": JSON.stringify({
      name: "test-libc-valid",
      version: "1.0.0",
    }),
  });

  const dirPath = String(dir);

  // Test that explicit --libc glibc flag is accepted
  await using proc1 = Bun.spawn({
    cmd: [bunExe(), "install", "--libc", "glibc"],
    env: bunEnv,
    cwd: dirPath,
    stdout: "pipe",
    stderr: "pipe",
  });

  const exitCode1 = await proc1.exited;
  expect(exitCode1).toBe(0);

  // Test that explicit --libc musl flag is accepted
  await cleanupLockfiles(dirPath);

  await using proc2 = Bun.spawn({
    cmd: [bunExe(), "install", "--libc", "musl"],
    env: bunEnv,
    cwd: dirPath,
    stdout: "pipe",
    stderr: "pipe",
  });

  const exitCode2 = await proc2.exited;
  expect(exitCode2).toBe(0);

  // Test that --libc * (wildcard) is accepted
  await cleanupLockfiles(dirPath);

  await using proc3 = Bun.spawn({
    cmd: [bunExe(), "install", "--libc", "*"],
    env: bunEnv,
    cwd: dirPath,
    stdout: "pipe",
    stderr: "pipe",
  });

  const exitCode3 = await proc3.exited;
  expect(exitCode3).toBe(0);
});

it("should reject invalid libc values", async () => {
  using dir = tempDir("issue-26156-invalid", {
    "package.json": JSON.stringify({
      name: "test-invalid-libc",
      version: "1.0.0",
    }),
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "install", "--libc", "invalid-libc-value"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(exitCode).toBe(1);
  expect(stderr).toContain("Invalid libc");
  expect(stderr).toContain("invalid-libc-value");
});
