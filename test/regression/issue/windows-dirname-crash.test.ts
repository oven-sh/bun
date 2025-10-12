import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// https://github.com/oven-sh/bun/issues/[TODO: Add issue number]
// Test for crash in bun install -g pm2-windows-service
// The crash occurred in resolve_path.zig dirname() function when handling
// Windows paths with edge cases like paths starting with separator or trailing separators

test("bun install -g pm2-windows-service should not crash", async () => {
  using dir = tempDir("windows-dirname-crash", {});

  await using proc = Bun.spawn({
    cmd: [bunExe(), "add", "-g", "pm2-windows-service"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // Should not crash with "panic: reached unreachable code"
  expect(stderr).not.toContain("panic");
  expect(stderr).not.toContain("unreachable");
  expect(exitCode).toBe(0);
  expect(stdout).toContain("pm2-windows-service");
});
