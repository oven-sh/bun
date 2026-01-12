import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";

// This test verifies that tty.ReadStream properly handles PTY file descriptors.
// Issue #25822: node-pty's onData callback never fires because:
// 1. tty.ReadStream auto-closed the PTY fd that node-pty owned
// 2. EAGAIN errors from non-blocking PTY reads destroyed the stream prematurely

describe.skipIf(isWindows)("tty.ReadStream with PTY", () => {
  test("should not auto-close fd passed to tty.ReadStream", async () => {
    // Verify that tty.ReadStream sets autoClose: false when fd is passed
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const tty = require('tty');
        const fs = require('fs');

        // Create a pipe to simulate an fd we own
        const { createPipe } = require('child_process').ChildProcess.prototype.constructor;

        // Use stdout fd (1) for testing - we don't want to close it
        const stream = new tty.ReadStream(1);

        // Check that autoClose is false (stream won't close our fd)
        console.log('autoClose:', stream.autoClose);

        // Manually destroy to trigger cleanup
        stream.destroy();

        // Give time for any async cleanup
        setTimeout(() => {
          // If autoClose was true, writing to stdout would fail
          console.log('stdout still works');
        }, 100);
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    expect(stdout).toContain("autoClose: false");
    expect(stdout).toContain("stdout still works");
    expect(exitCode).toBe(0);
  });

  test("node-pty should receive data from spawned process", async () => {
    // First check if node-pty is available
    const checkPty = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        "try { require.resolve('node-pty'); console.log('found'); } catch { console.log('not-found'); }",
      ],
      env: bunEnv,
      stdout: "pipe",
    });

    const checkResult = await checkPty.stdout.text();
    await checkPty.exited;

    if (checkResult.trim() !== "found") {
      console.log("Skipping node-pty test - node-pty not installed");
      return;
    }

    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const pty = require('node-pty');

        const shell = pty.spawn('/bin/echo', ['test-output-12345'], {
          name: 'xterm-256color',
          cols: 80,
          rows: 24,
        });

        let dataReceived = '';
        shell.onData((data) => {
          dataReceived += data;
        });

        shell.onExit((e) => {
          if (dataReceived.includes('test-output-12345')) {
            console.log('SUCCESS: received expected data');
          } else {
            console.log('FAILURE: data was:', JSON.stringify(dataReceived));
          }
          console.log('exit code:', e.exitCode);
          process.exit(e.exitCode === 0 && dataReceived.includes('test-output-12345') ? 0 : 1);
        });

        // Timeout in case onData/onExit never fire
        setTimeout(() => {
          console.log('TIMEOUT: no exit event');
          console.log('data received:', JSON.stringify(dataReceived));
          process.exit(1);
        }, 5000);
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toContain("SUCCESS: received expected data");
    expect(stdout).toContain("exit code: 0");
    expect(exitCode).toBe(0);
  });
});
