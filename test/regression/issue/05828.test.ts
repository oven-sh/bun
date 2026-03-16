import { expect, test } from "bun:test";
import { bunEnv, bunExe, isPosix } from "harness";
import { join } from "path";

// https://github.com/oven-sh/bun/issues/5828
test.if(isPosix)("bun bun.lockb handles BrokenPipe gracefully", async () => {
  // Use an existing lockfile that has enough content to trigger the BrokenPipe
  // The sharp integration test has a lockfile with many dependencies
  const lockfilePath = join(import.meta.dir, "../../integration/sharp/bun.lockb");

  // Simulate piping to a command that closes stdin immediately (like `true`)
  // This tests that `bun bun.lockb` doesn't crash with BrokenPipe error
  await using proc = Bun.spawn({
    cmd: ["sh", "-c", `${bunExe()} ${lockfilePath} | true`],
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // Should exit cleanly (0) instead of crashing with BrokenPipe error
  // The stderr should NOT contain "BrokenPipe" or "WriteFailed" error
  expect(stderr).not.toContain("BrokenPipe");
  expect(stderr).not.toContain("WriteFailed");
  expect(stderr).not.toContain("error");
  expect(exitCode).toBe(0);
});
