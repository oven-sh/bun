import { expect, test } from "bun:test";
import { bunEnv, bunExe, isPosix } from "harness";

// https://github.com/oven-sh/bun/issues/2977
test.if(isPosix)("bun completions handles BrokenPipe gracefully", async () => {
  // Simulate piping to a command that closes stdin immediately (like `true`)
  // This tests that bun completions doesn't crash with BrokenPipe error
  await using proc = Bun.spawn({
    cmd: ["sh", "-c", `SHELL=/bin/bash ${bunExe()} completions | true`],
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // Should exit cleanly (0) instead of crashing with BrokenPipe error
  // The stderr should NOT contain "BrokenPipe" error
  expect(stderr).not.toContain("BrokenPipe");
  expect(stderr).not.toContain("error");
  expect(exitCode).toBe(0);
});
