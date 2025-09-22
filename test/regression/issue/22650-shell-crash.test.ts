import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("issue #22650 - shell crash with && operator followed by external command", async () => {
  // Minimal reproduction: echo && <external command>
  // This triggers the crash because after the first command succeeds,
  // the shell tries to spawn an external process but top_level_dir is not set
  await using proc = Bun.spawn({
    cmd: [bunExe(), "exec", "echo test && node --version"],
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // Should not have any errors
  expect(stderr).toBe("");

  // Should execute both commands successfully
  expect(stdout).toContain("test");
  expect(stdout).toMatch(/v\d+\.\d+\.\d+/); // Node version pattern
  expect(exitCode).toBe(0);
});
