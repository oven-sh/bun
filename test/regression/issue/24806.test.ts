import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("bun publish --help shows correct message for --dry-run", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "publish", "--help"],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // The --dry-run flag should have a generic description that works for all commands
  // It should NOT say "Don't install anything" when used with "bun publish"
  expect(stdout).toContain("--dry-run");
  expect(stdout).toContain("Perform a dry run without making changes");

  // Make sure it doesn't contain the old incorrect message
  expect(stdout).not.toContain("Don't install anything");

  expect(exitCode).toBe(0);
});
