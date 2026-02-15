import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Issue #3536: Bun crashes with SIGILL when run in nsjail or sandboxed environments
// that block CPUID instructions. This test verifies that Bun starts correctly under
// normal conditions. The fix adds SIGILL signal handlers to catch blocked CPU
// feature detection calls and fall back gracefully.
test("3536 - CPU feature detection does not crash on startup", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", "console.log('ok')"],
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // Verify no crash warnings related to CPU features
  expect(stderr).not.toContain("illegal instruction");
  expect(stderr).not.toContain("SIGILL");
  expect(stdout.trim()).toBe("ok");
  expect(exitCode).toBe(0);
});
