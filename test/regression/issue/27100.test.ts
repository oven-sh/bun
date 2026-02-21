import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";

// Test for https://github.com/oven-sh/bun/issues/27100
// When bun's stdout is piped (e.g. `bun | less`), bun should not restore
// stdin's termios settings on exit, because a downstream process like `less`
// may have changed the terminal to raw mode and is still using it.
test.skipIf(isWindows)("piped bun does not restore stdin termios on exit", async () => {
  // This test verifies that when bun's stdout is piped, it does not
  // restore stdin's termios on exit. We:
  // 1. Use `script` to allocate a real PTY
  // 2. Set the terminal to raw mode (simulating what `less` does)
  // 3. Run `bun -e '...' | cat` (pipeline)
  // 4. Check that icanon is still off (raw mode preserved)
  //
  // If bun incorrectly restores termios, icanon will be turned back on.

  // Try to run the test with `script` to get a real PTY
  const scriptPath = Bun.which("script");
  if (!scriptPath) {
    console.log("SKIP: 'script' command not available for PTY simulation");
    return;
  }

  using dir = tempDir("issue-27100", {
    "check_termios.sh": [
      `#!/bin/bash`,
      ``,
      `# Only run if stdin is a TTY`,
      `if [ ! -t 0 ]; then`,
      `  echo "SKIP: stdin is not a TTY"`,
      `  exit 0`,
      `fi`,
      ``,
      `# Save original for restoration later`,
      `original_settings=$(stty -g)`,
      ``,
      `# Set stdin to raw mode (like less would do)`,
      `stty raw -echo -icanon min 1 time 0 2>/dev/null`,
      ``,
      `# Capture raw mode settings for comparison`,
      `raw_settings=$(stty -g)`,
      ``,
      `# Run bun with stdout piped through cat (simulating a pipeline like bun | less)`,
      `BUN_DEBUG_QUIET_LOGS=1 ${bunExe()} -e "console.log('hello')" | cat > /dev/null`,
      ``,
      `# Capture settings after bun exited`,
      `after_settings=$(stty -g)`,
      ``,
      `# Restore original settings`,
      `stty "$original_settings" 2>/dev/null`,
      ``,
      `# Check that raw mode was NOT clobbered by comparing to the original (cooked) settings`,
      `# If bun restored termios, after_settings will match original_settings (cooked mode)`,
      `if [ "$after_settings" = "$original_settings" ]; then`,
      `  echo "FAIL: bun restored stdin termios to cooked mode during pipeline"`,
      `  exit 1`,
      `elif [ "$after_settings" = "$raw_settings" ]; then`,
      `  echo "PASS: stdin termios preserved as raw during pipeline"`,
      `  exit 0`,
      `else`,
      `  # Settings changed but not back to original - could be partial restore`,
      `  # Check if icanon is off (the key flag for raw mode)`,
      `  if stty -a 2>/dev/null | grep -q -- '-icanon'; then`,
      `    echo "PASS: icanon still disabled after pipeline"`,
      `    exit 0`,
      `  else`,
      `    echo "FAIL: termios settings were modified during pipeline"`,
      `    echo "original: $original_settings"`,
      `    echo "raw:      $raw_settings"`,
      `    echo "after:    $after_settings"`,
      `    exit 1`,
      `  fi`,
      `fi`,
    ].join("\n"),
  });

  const { execSync } = require("child_process");
  execSync(`chmod +x ${join(String(dir), "check_termios.sh")}`);

  const isMacOS = process.platform === "darwin";
  const shCmd = join(String(dir), "check_termios.sh");

  // Use `script` to allocate a PTY so stdin is a terminal
  const scriptCmd = isMacOS
    ? ["script", "-q", "/dev/null", "bash", shCmd]
    : ["script", "-q", "-c", `bash ${shCmd}`, "/dev/null"];

  await using proc = Bun.spawn({
    cmd: scriptCmd,
    env: { ...bunEnv, PATH: process.env.PATH },
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // If we got SKIP, the test environment doesn't support this test
  if (stdout.includes("SKIP")) {
    console.log(stdout.trim());
    return;
  }

  expect(stdout).toContain("PASS");
  expect(exitCode).toBe(0);
});
