import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// https://github.com/oven-sh/bun/issues/27063
// On Windows, when Bun.spawn fails (e.g., ENOENT for a nonexistent executable),
// pipes initialized with uv_pipe_init were freed without calling uv_close first.
// This corrupted libuv's internal handle_queue linked list, causing segfaults
// on subsequent spawn calls.

test("spawning nonexistent executables repeatedly does not crash", async () => {
  // Spawn a nonexistent executable multiple times. Before the fix, on Windows
  // this would corrupt the libuv handle queue and crash on a subsequent spawn.
  for (let i = 0; i < 5; i++) {
    try {
      const proc = Bun.spawn({
        cmd: ["this-executable-does-not-exist-27063"],
        stdout: "pipe",
        stderr: "pipe",
      });
      await proc.exited;
    } catch {
      // Expected to fail - we're testing that it doesn't crash
    }
  }

  // If we get here without crashing, the handle queue is intact.
  // Verify a valid spawn still works after the failed ones.
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", "console.log('ok')"],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  expect(stdout.trim()).toBe("ok");
  expect(exitCode).toBe(0);
});
