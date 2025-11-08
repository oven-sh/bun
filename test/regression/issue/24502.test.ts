import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("24502 - bun list --all should not crash with invalid package IDs", async () => {
  // This test verifies that "bun list --all" doesn't crash when the lockfile
  // contains dependencies with invalid package IDs (e.g., unresolved optionalDependencies)
  const result = Bun.spawn({
    cmd: [bunExe(), "list", "--all"],
    cwd: import.meta.dir,
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });

  const [stdout, stderr, exitCode] = await Promise.all([result.stdout.text(), result.stderr.text(), result.exited]);

  // The command should not crash and should exit successfully
  expect(stderr).not.toContain("panic");
  expect(stderr).not.toContain("Segmentation fault");
  expect(exitCode).toBe(0);

  // Should produce some output
  expect(stdout.length).toBeGreaterThan(0);
});
