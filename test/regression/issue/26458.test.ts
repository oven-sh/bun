import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// https://github.com/oven-sh/bun/issues/26458
// Bun freezes when pasting >1023 bytes to stdin without trailing newline
// This was caused by terminal canonical mode buffering (~1024 byte limit)
// The fix disables ICANON during prompt/alert/confirm reads on POSIX systems
//
// Note: The actual freeze only occurs when stdin is an interactive TTY (not a pipe).
// This test uses stdin: "pipe" so it can't reproduce the exact freeze scenario,
// but it verifies that prompt/confirm/alert can handle large input correctly.

describe("stdin large input handling", () => {
  // Generate test data larger than the canonical mode buffer limit (~1024 bytes)
  const largeInput = Buffer.alloc(2048, "x").toString();

  test("prompt() handles large input without hanging", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", "console.log(prompt('Enter:'))"],
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: bunEnv,
    });

    // Write large input followed by newline
    proc.stdin!.write(largeInput + "\n");
    await proc.stdin!.end();

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // The output should contain our large input (after the "Enter: " prompt)
    expect(stdout).toContain(largeInput);
    expect(exitCode).toBe(0);
  });

  test("confirm() handles large input without hanging", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", "console.log(confirm('Confirm:'))"],
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: bunEnv,
    });

    // Write large input (not starting with y/Y) followed by newline
    proc.stdin!.write(largeInput + "\n");
    await proc.stdin!.end();

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // confirm() should return false for non-y input
    expect(stdout).toContain("false");
    expect(exitCode).toBe(0);
  });

  test("alert() handles large input without hanging", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", "alert('Hello'); console.log('done')"],
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: bunEnv,
    });

    // Write large input followed by newline (alert just waits for Enter)
    proc.stdin!.write(largeInput + "\n");
    await proc.stdin!.end();

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // alert() should complete and print "done"
    expect(stdout).toContain("done");
    expect(exitCode).toBe(0);
  });

  test("prompt() handles very large input (10KB)", async () => {
    const veryLargeInput = Buffer.alloc(10240, "y").toString();

    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", "console.log(prompt('Enter:').length)"],
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: bunEnv,
    });

    proc.stdin!.write(veryLargeInput + "\n");
    await proc.stdin!.end();

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // Should output the length of our input
    expect(stdout).toContain("10240");
    expect(exitCode).toBe(0);
  });
});
