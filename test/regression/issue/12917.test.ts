import { spawn } from "bun";
import { describe, expect, test } from "bun:test";
import { readdir, rm } from "fs/promises";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";

/**
 * Test for issue #12917: `bun install` occasionally fails with parallel runs
 *
 * The issue was that when multiple `bun install` processes run in parallel,
 * they would race when creating bin symlinks, resulting in "Failed to link: EEXIST" errors.
 *
 * The fix uses atomic symlink replacement (create temp symlink, then rename)
 * instead of the racy delete-then-create approach.
 */

// Skip on Windows as the fix is specific to POSIX symlink handling
describe.skipIf(isWindows)("parallel bun install bin linking", () => {
  test("multiple parallel installs with same bin should not fail with EEXIST", async () => {
    // Create 5 separate project directories that all depend on the same package with a bin
    const numParallelInstalls = 5;

    // We'll use a simple npm package that has a bin entry
    // Using 'cowsay' as it's a well-known package with a binary
    const packageJson = {
      name: "test-parallel-install",
      version: "1.0.0",
      dependencies: {
        cowsay: "1.6.0", // Pin version for reproducibility
      },
    };

    // Create project directories - store the tempDir handles to prevent cleanup
    const projectDirs: Array<{ dir: ReturnType<typeof tempDir>; path: string }> = [];
    for (let i = 0; i < numParallelInstalls; i++) {
      const dir = tempDir(`parallel-install-${i}`, {
        "package.json": JSON.stringify(packageJson, null, 2),
      });
      projectDirs.push({ dir, path: String(dir) });
    }

    try {
      // Run all installs in parallel
      const installPromises = projectDirs.map(async ({ path: projectDir }) => {
        const proc = spawn({
          cmd: [bunExe(), "install"],
          cwd: projectDir,
          env: bunEnv,
          stdout: "pipe",
          stderr: "pipe",
        });

        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

        return { projectDir, stdout, stderr, exitCode };
      });

      const results = await Promise.all(installPromises);

      // Check that all installs succeeded
      for (const result of results) {
        // Should not contain the EEXIST error
        expect(result.stderr).not.toContain("Failed to link");
        expect(result.stderr).not.toContain("EEXIST");
        expect(result.exitCode).toBe(0);
      }

      // Verify that the bin was actually created in each project
      for (const { path: projectDir } of projectDirs) {
        const files = await readdir(join(projectDir, "node_modules", ".bin")).catch(() => []);
        expect(files).toContain("cowsay");
      }
    } finally {
      // Cleanup
      for (const { path: projectDir } of projectDirs) {
        await rm(projectDir, { recursive: true, force: true }).catch(() => {});
      }
    }
  });

  test("repeated parallel installs in same directory should not fail", async () => {
    // This test runs multiple installs in the same directory concurrently
    // which is a common scenario in CI/CD where caching might cause concurrent runs
    using dir = tempDir("parallel-same-dir", {
      "package.json": JSON.stringify(
        {
          name: "test-parallel-same-dir",
          version: "1.0.0",
          dependencies: {
            cowsay: "1.6.0",
          },
        },
        null,
        2,
      ),
    });

    const projectDir = String(dir);

    // Run 3 installs concurrently in the same directory
    const installPromises = Array.from({ length: 3 }, async () => {
      const proc = spawn({
        cmd: [bunExe(), "install"],
        cwd: projectDir,
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      return { stdout, stderr, exitCode };
    });

    const results = await Promise.all(installPromises);

    // At least one should succeed (the first one to complete)
    // None should fail with EEXIST
    const successCount = results.filter(r => r.exitCode === 0).length;
    expect(successCount).toBeGreaterThanOrEqual(1);

    // None should have the EEXIST linking error
    for (const result of results) {
      // Check that we don't have the specific error pattern from the issue
      const hasEexistLinkError = result.stderr.includes("Failed to link") && result.stderr.includes("EEXIST");
      expect(hasEexistLinkError).toBe(false);
    }
  });
});
