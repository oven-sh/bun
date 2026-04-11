import { expect, test } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot, tempDir } from "harness";

// This test replicates the pattern used by TUI apps
// where they read piped stdin first, then reopen /dev/tty for interactive input
test("TUI app pattern: read piped stdin then reopen /dev/tty", async () => {
  // Skip on Windows - no /dev/tty
  if (process.platform === "win32") {
    return;
  }

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
  // macOS and Linux have different script command syntax
  const isMacOS = process.platform === "darwin";
  const cmd = isMacOS
    ? [scriptPath, "-q", "/dev/null", "sh", "-c", `echo "piped content" | ${bunExe()} tui-app-sim.js`]
    : [scriptPath, "-q", "-c", `echo "piped content" | ${bunExe()} tui-app-sim.js`, "/dev/null"];

  const proc = Bun.spawn({
    cmd,
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [exitCode, stdout, stderr] = await Promise.all([proc.exited, proc.stdout.text(), proc.stderr.text()]);

  // First snapshot the combined output to see what actually happened
  const output = stdout + (stderr ? "\nSTDERR:\n" + stderr : "");
  // Use JSON.stringify to make control characters visible
  const jsonOutput = JSON.stringify(normalizeBunSnapshot(output, dir));
  // macOS script adds control characters, Linux doesn't
  const expected = isMacOS
    ? `"^D\\b\\bPIPED_INPUT:piped content\\nTTY_REOPENED:SUCCESS"`
    : `"PIPED_INPUT:piped content\\nTTY_REOPENED:SUCCESS"`;
  expect(jsonOutput).toBe(expected);

  // Then check exit code
  expect(exitCode).toBe(0);
});

// Node's uv_tty_init rejects regular-file fds with UV_EINVAL, so
// new tty.ReadStream(regular_file_fd) throws ERR_TTY_INIT_FAILED. Bun now
// matches this since tty.ReadStream extends net.Socket with a native TTY
// handle (previously it wrapped fs.ReadStream and accepted any fd).
test("tty.ReadStream rejects non-TTY file descriptors", () => {
  const fs = require("fs");
  const tty = require("tty");
  const path = require("path");
  const os = require("os");

  const tempFile = path.join(os.tmpdir(), "test-regular-file-" + Date.now() + ".txt");
  fs.writeFileSync(tempFile, "test content");

  let fd;
  try {
    fd = fs.openSync(tempFile, "r");
    let thrown;
    try {
      new tty.ReadStream(fd);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeDefined();
    expect(thrown.code).toBe("ERR_TTY_INIT_FAILED");
  } finally {
    try {
      if (fd !== undefined) fs.closeSync(fd);
      fs.unlinkSync(tempFile);
    } catch {}
  }
});
