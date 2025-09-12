import { expect, test } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot, tempDir } from "harness";

// This test replicates the pattern used by TUI apps
// where they read piped stdin first, then reopen /dev/tty for interactive input
test("TUI app pattern: read piped stdin then reopen /dev/tty", async () => {
  // Check if 'script' command is available for TTY simulation
  const scriptPath = Bun.which("script");
  if (!scriptPath) {
    // Skip test on platforms without 'script' command
    return;
  }

  // Create a simpler test script that mimics TUI app behavior
  const tuiAppPattern = `
    const fs = require('fs');
    const tty = require('tty');
    
    async function main() {
      // Step 1: Check if stdin is piped
      if (!process.stdin.isTTY) {
        // Read all piped input
        let input = '';
        for await (const chunk of process.stdin) {
          input += chunk;
        }
        console.log('PIPED_INPUT:' + input.trim());
        
        // Step 2: After stdin EOF, try to reopen /dev/tty
        try {
          const ttyFd = fs.openSync('/dev/tty', 'r');
          const ttyStream = new tty.ReadStream(ttyFd);
          
          // Verify TTY stream has expected properties
          if (!ttyStream.isTTY) {
            console.error('ERROR: tty.ReadStream not recognized as TTY');
            process.exit(1);
          }
          
          // Verify ref/unref methods exist and work
          if (typeof ttyStream.ref !== 'function' || typeof ttyStream.unref !== 'function') {
            console.error('ERROR: ref/unref methods missing');
            process.exit(1);
          }
          
          // Test that we can call ref/unref without errors
          ttyStream.unref();
          ttyStream.ref();
          
          console.log('TTY_REOPENED:SUCCESS');
          
          // Clean up - only destroy the stream, don't double-close the fd
          ttyStream.destroy();
          
        } catch (err) {
          console.error('ERROR:' + err.code + ':' + err.message);
          process.exit(1);
        }
      } else {
        console.log('NO_PIPE');
      }
    }
    
    main().catch(err => {
      console.error('UNCAUGHT:' + err.message);
      process.exit(1);
    });
  `;

  using dir = tempDir("tui-app-test", {
    "tui-app-sim.js": tuiAppPattern,
  });

  // Create a simple test that pipes input
  const proc = Bun.spawn({
    cmd: [scriptPath, "-q", "-c", `echo "piped content" | ${bunExe()} tui-app-sim.js`, "/dev/null"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [exitCode, stdout, stderr] = await Promise.all([proc.exited, proc.stdout.text(), proc.stderr.text()]);

  // The test should successfully read piped input and reopen TTY
  expect(exitCode).toBe(0);
  expect(stderr).toBe("");

  // Normalize and check output
  const output = normalizeBunSnapshot(stdout, dir);
  expect(output).toContain("PIPED_INPUT:piped content");
  expect(output).toContain("TTY_REOPENED:SUCCESS");
});

// Test that tty.ReadStream works correctly with various file descriptors
test("tty.ReadStream handles non-TTY file descriptors correctly", () => {
  const fs = require("fs");
  const tty = require("tty");

  // Create a regular file
  const tempFile = "/tmp/test-regular-file.txt";
  fs.writeFileSync(tempFile, "test content");

  try {
    const fd = fs.openSync(tempFile, "r");
    const stream = new tty.ReadStream(fd);

    // Regular file should not be identified as TTY
    expect(stream.isTTY).toBe(false);

    // ref/unref should still exist (for compatibility) but may be no-ops
    expect(typeof stream.ref).toBe("function");
    expect(typeof stream.unref).toBe("function");

    stream.destroy();
    fs.closeSync(fd);
  } finally {
    fs.unlinkSync(tempFile);
  }
});
