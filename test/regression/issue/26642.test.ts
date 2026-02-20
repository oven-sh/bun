import { expect, test } from "bun:test";
import { bunEnv, bunExe, isMacOS, isWindows } from "harness";

// Test that cursor visibility is restored on process exit when stdout is a TTY.
// This is needed because CLI applications like Ink hide the cursor during operation
// and rely on cleanup handlers to restore it. If the process exits before the
// cursor-show escape sequence is flushed, the cursor remains invisible.
// See: https://github.com/oven-sh/bun/issues/26642

// Skip on Windows and non-macOS - the script command behavior varies and CI
// environments often don't provide proper PTY support. The actual fix is
// most critical for macOS terminals where users reported the issue.
test.skipIf(isWindows || !isMacOS)("cursor visibility is restored on exit when stdout is TTY", async () => {
  // Check if script command is available (needed to create a PTY)
  const hasScript = Bun.which("script");
  if (!hasScript) {
    console.log("Skipping test: requires 'script' command for PTY simulation");
    return;
  }

  // Script that just exits immediately - cursor restore should happen automatically
  const testScript = `process.exit(0);`;

  // Use script command to provide a PTY environment (macOS syntax)
  const scriptCmd = ["script", "-q", "/dev/null", bunExe(), "-e", testScript];

  await using proc = Bun.spawn({
    cmd: scriptCmd,
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // The cursor-show escape sequence is \x1b[?25h
  // It should be present in stdout when running in a TTY
  const cursorShow = "\x1b[?25h";
  expect(stdout).toContain(cursorShow);
  expect(exitCode).toBe(0);
});
