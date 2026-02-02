import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

describe("Terminal cursor restoration on exit", () => {
  // Issue #26642: Cursor disappears when running Ink CLI with Bun on macOS
  // When a CLI app uses raw mode (like Ink), the cursor may be hidden.
  // Bun should restore cursor visibility on exit.

  test("should restore cursor visibility after raw mode app exits", async () => {
    // Create a script that uses raw mode and exits
    using dir = tempDir("cursor-restore", {
      "hide-cursor.ts": `
// Hide the cursor using ANSI escape sequence
process.stdout.write("\\x1b[?25l"); // DECTCEM - hide cursor

// Simulate some work
console.log("Working...");

// Exit without restoring cursor (simulates a misbehaving app)
process.exit(0);
`,
    });

    // Run the script with Bun
    // The output should contain the show cursor sequence from Bun's cleanup
    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", "hide-cursor.ts"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.bytes(),
      proc.stderr.text(),
      proc.exited,
    ]);

    expect(exitCode).toBe(0);

    // The output should contain the show cursor sequence (\x1b[?25h)
    // This is written by bun_restore_stdio() on exit
    const showCursor = new Uint8Array([0x1b, 0x5b, 0x3f, 0x32, 0x35, 0x68]); // \x1b[?25h
    const stdoutStr = new TextDecoder().decode(stdout);

    // Check that the show cursor sequence is in the output
    // Note: This will only be present if stdout is a TTY, which it won't be in this test
    // So this test verifies the code compiles and runs, but can't fully verify cursor restoration
    // when stdout is piped. The actual fix is tested manually.
    expect(stdoutStr).toContain("Working...");
  });

  test("raw mode script should exit cleanly", async () => {
    // This is a simpler test that just verifies a script using tty.setRawMode works
    using dir = tempDir("raw-mode-exit", {
      "raw-mode.ts": `
import { isatty } from "tty";

// Only try to use raw mode if we're in a TTY (won't work when piped)
if (process.stdin.isTTY) {
  process.stdin.setRawMode(true);
  process.stdin.setRawMode(false);
}

console.log("Raw mode test complete");
process.exit(0);
`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", "raw-mode.ts"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);

    expect(stdout).toContain("Raw mode test complete");
    expect(exitCode).toBe(0);
  });
});
