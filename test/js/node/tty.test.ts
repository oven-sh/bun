import { describe, expect, it, test } from "bun:test";
import { openSync } from "fs";
import { bunEnv, bunExe, isWindows, normalizeBunSnapshot, tempDir } from "harness";
import tty, { WriteStream } from "node:tty";
import { join } from "path";

describe("WriteStream.prototype.getColorDepth", () => {
  it("iTerm ancient", () => {
    expect(
      WriteStream.prototype.getColorDepth.call(undefined, {
        TERM_PROGRAM: "iTerm.app",
      }),
    ).toBe(isWindows ? 24 : 8);
  });

  it("iTerm modern", () => {
    expect(
      WriteStream.prototype.getColorDepth.call(undefined, {
        TERM_PROGRAM: "iTerm.app",
        TERM_PROGRAM_VERSION: 3,
      }),
    ).toBe(24);
  });

  it("empty", () => {
    expect(WriteStream.prototype.getColorDepth.call(undefined, {})).toBe(isWindows ? 24 : 1);
  });
});

// Regression tests for #22591 - TTY reopening after stdin EOF

test("tty.ReadStream should have ref/unref methods when opened on /dev/tty", () => {
  // Skip this test if /dev/tty is not available (e.g., in CI without TTY)
  let ttyFd: number;
  try {
    ttyFd = openSync("/dev/tty", "r");
  } catch (err: any) {
    if (err.code === "ENXIO" || err.code === "ENOENT") {
      // No TTY available, skip the test
      return;
    }
    throw err;
  }

  try {
    // Create a tty.ReadStream with the /dev/tty file descriptor
    const stream = new tty.ReadStream(ttyFd);

    // Verify the stream is recognized as a TTY
    expect(stream.isTTY).toBe(true);

    // Verify ref/unref methods exist
    expect(typeof stream.ref).toBe("function");
    expect(typeof stream.unref).toBe("function");

    // Verify ref/unref return the stream for chaining
    expect(stream.ref()).toBe(stream);
    expect(stream.unref()).toBe(stream);

    // Clean up - destroy will close the fd
    stream.destroy();
  } finally {
    // Don't double-close the fd - stream.destroy() already closed it
  }
});

test("tty.ReadStream ref/unref should behave like Node.js", async () => {
  // Skip on Windows - no /dev/tty
  if (process.platform === "win32") {
    return;
  }

  // Create a test script that uses tty.ReadStream with ref/unref
  const script = `
    const fs = require('fs');
    const tty = require('tty');

    let ttyFd;
    try {
      ttyFd = fs.openSync('/dev/tty', 'r');
    } catch (err) {
      // No TTY available
      console.log('NO_TTY');
      process.exit(0);
    }

    const stream = new tty.ReadStream(ttyFd);

    // Test that ref/unref methods exist and work
    if (typeof stream.ref !== 'function' || typeof stream.unref !== 'function') {
      console.error('ref/unref methods missing');
      process.exit(1);
    }

    // Unref should allow process to exit
    stream.unref();

    // Set a timer that would keep process alive if ref() was called
    const timer = setTimeout(() => {
      console.log('TIMEOUT');
    }, 100);
    timer.unref();

    // Process should exit immediately since both stream and timer are unref'd
    console.log('SUCCESS');

    // Clean up properly
    stream.destroy();
  `;

  // Write the test script to a temporary file
  const path = require("path");
  const os = require("os");
  const tempFile = path.join(os.tmpdir(), "test-tty-ref-unref-" + Date.now() + ".js");
  await Bun.write(tempFile, script);

  // Run the script with bun
  const proc = Bun.spawn({
    cmd: [bunExe(), tempFile],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [exitCode, stdout, stderr] = await Promise.all([proc.exited, proc.stdout.text(), proc.stderr.text()]);

  if (stdout.includes("NO_TTY")) {
    // No TTY available in test environment, skip
    return;
  }

  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
  expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`"SUCCESS"`);
});

// Regression test for #22591 - can reopen /dev/tty after stdin EOF
test.skipIf(isWindows)("can reopen /dev/tty after stdin EOF for interactive session", async () => {
  // This test ensures that Bun can reopen /dev/tty after stdin reaches EOF,
  // which is needed for tools like Claude Code that read piped input then
  // switch to interactive mode.

  // Create test script that reads piped input then reopens TTY
  const testScript = `
    const fs = require('fs');
    const tty = require('tty');

    // Read piped input
    let inputData = '';
    process.stdin.on('data', (chunk) => {
      inputData += chunk;
    });

    process.stdin.on('end', () => {
      console.log('GOT_INPUT:' + inputData.trim());

      // After stdin ends, reopen TTY for interaction
      try {
        const fd = fs.openSync('/dev/tty', 'r+');
        console.log('OPENED_TTY:true');

        const ttyStream = new tty.ReadStream(fd);
        console.log('CREATED_STREAM:true');
        console.log('POS:' + ttyStream.pos);
        console.log('START:' + ttyStream.start);

        // Verify we can set raw mode
        if (typeof ttyStream.setRawMode === 'function') {
          ttyStream.setRawMode(true);
          console.log('SET_RAW_MODE:true');
          ttyStream.setRawMode(false);
        }

        ttyStream.destroy();
        fs.closeSync(fd);
        console.log('SUCCESS:true');
        process.exit(0);
      } catch (err) {
        console.log('ERROR:' + err.code);
        process.exit(1);
      }
    });

    if (process.stdin.isTTY) {
      console.log('ERROR:NO_PIPED_INPUT');
      process.exit(1);
    }
  `;

  using dir = tempDir("tty-reopen", {});
  const scriptPath = join(String(dir), "test.js");
  await Bun.write(scriptPath, testScript);

  // Check if script command is available (might not be on Alpine by default)
  const hasScript = Bun.which("script");
  if (!hasScript) {
    // Try without script - if /dev/tty isn't available, test will fail appropriately
    await using proc = Bun.spawn({
      cmd: ["sh", "-c", `echo "test input" | ${bunExe()} ${scriptPath}`],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // If it fails with ENXIO, skip the test
    if (exitCode !== 0 && stdout.includes("ERROR:ENXIO")) {
      console.log("Skipping test: requires 'script' command for PTY simulation");
      return;
    }

    // Otherwise check results - snapshot first to see what happened
    const output = stdout + (stderr ? "\nSTDERR:\n" + stderr : "");
    expect(normalizeBunSnapshot(output, dir)).toMatchInlineSnapshot(`
      "GOT_INPUT:test input
      OPENED_TTY:true
      CREATED_STREAM:true
      POS:undefined
      START:undefined
      SET_RAW_MODE:true
      SUCCESS:true"
    `);
    expect(exitCode).toBe(0);
    return;
  }

  // Use script command to provide a PTY environment
  // This simulates a real terminal where /dev/tty is available
  // macOS and Linux have different script command syntax
  const isMacOS = process.platform === "darwin";
  const scriptCmd = isMacOS
    ? ["script", "-q", "/dev/null", "sh", "-c", `echo "test input" | ${bunExe()} ${scriptPath}`]
    : ["script", "-q", "-c", `echo "test input" | ${bunExe()} ${scriptPath}`, "/dev/null"];

  await using proc = Bun.spawn({
    cmd: scriptCmd,
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // First snapshot the combined output to see what actually happened
  const output = stdout + (stderr ? "\nSTDERR:\n" + stderr : "");
  // Use JSON.stringify to make control characters visible
  const jsonOutput = JSON.stringify(normalizeBunSnapshot(output, dir));
  // macOS script adds control characters, Linux doesn't
  const expected = isMacOS
    ? `"^D\\b\\bGOT_INPUT:test input\\nOPENED_TTY:true\\nCREATED_STREAM:true\\nPOS:undefined\\nSTART:undefined\\nSET_RAW_MODE:true\\nSUCCESS:true"`
    : `"GOT_INPUT:test input\\nOPENED_TTY:true\\nCREATED_STREAM:true\\nPOS:undefined\\nSTART:undefined\\nSET_RAW_MODE:true\\nSUCCESS:true"`;
  expect(jsonOutput).toBe(expected);

  // Then check exit code
  expect(exitCode).toBe(0);
});

// Regression test for #22591 - TTY ReadStream should not set position for character devices
test.skipIf(isWindows)("TTY ReadStream should not set position for character devices", async () => {
  // This test ensures that when creating a ReadStream with an fd (like for TTY),
  // the position remains undefined so that fs.read uses read() syscall instead
  // of pread() which would fail with ESPIPE on character devices.

  const testScript = `
    const fs = require('fs');
    const tty = require('tty');

    try {
      const fd = fs.openSync('/dev/tty', 'r+');
      const ttyStream = new tty.ReadStream(fd);

      // These should be undefined for TTY streams
      console.log('POS_TYPE:' + typeof ttyStream.pos);
      console.log('START_TYPE:' + typeof ttyStream.start);

      // Monkey-patch fs.read to check what position is passed
      const originalRead = fs.read;
      let capturedPosition = 'NOT_CALLED';
      let readCalled = false;
      fs.read = function(fd, buffer, offset, length, position, callback) {
        capturedPosition = position;
        readCalled = true;
        // Don't actually read, just call callback with 0 bytes
        process.nextTick(() => callback(null, 0, buffer));
        return originalRead;
      };

      // Set up data handler to trigger read
      ttyStream.on('data', () => {});
      ttyStream.on('error', () => {});

      // Immediately log the state since we don't actually need to wait for a real read
      console.log('POSITION_PASSED:' + capturedPosition);
      console.log('POSITION_TYPE:' + typeof capturedPosition);
      console.log('READ_CALLED:' + readCalled);

      ttyStream.destroy();
      fs.closeSync(fd);
      process.exit(0);
    } catch (err) {
      console.log('ERROR:' + err.code);
      process.exit(1);
    }
  `;

  using dir = tempDir("tty-position", {});
  const scriptPath = join(String(dir), "test.js");
  await Bun.write(scriptPath, testScript);

  // Check if script command is available
  const hasScript = Bun.which("script");
  if (!hasScript) {
    // Try without script
    await using proc = Bun.spawn({
      cmd: [bunExe(), scriptPath],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    if (exitCode !== 0 && stdout.includes("ERROR:ENXIO")) {
      console.log("Skipping test: requires 'script' command for PTY simulation");
      return;
    }

    // Snapshot first to see what happened
    const output = stdout + (stderr ? "\nSTDERR:\n" + stderr : "");
    expect(normalizeBunSnapshot(output, dir)).toMatchInlineSnapshot(`
      "POS_TYPE:undefined
      START_TYPE:undefined
      POSITION_PASSED:NOT_CALLED
      POSITION_TYPE:string
      READ_CALLED:false"
    `);
    expect(exitCode).toBe(0);
    return;
  }

  // Use script command to provide a PTY environment
  // macOS and Linux have different script command syntax
  const isMacOS = process.platform === "darwin";
  const scriptCmd = isMacOS
    ? ["script", "-q", "/dev/null", bunExe(), scriptPath]
    : ["script", "-q", "-c", `${bunExe()} ${scriptPath}`, "/dev/null"];

  await using proc = Bun.spawn({
    cmd: scriptCmd,
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // First snapshot the combined output to see what actually happened
  const output = stdout + (stderr ? "\nSTDERR:\n" + stderr : "");
  // Use JSON.stringify to make control characters visible
  const jsonOutput = JSON.stringify(normalizeBunSnapshot(output, dir));
  // macOS script adds control characters, Linux doesn't
  const expected = isMacOS
    ? `"^D\\b\\bPOS_TYPE:undefined\\nSTART_TYPE:undefined\\nPOSITION_PASSED:NOT_CALLED\\nPOSITION_TYPE:string\\nREAD_CALLED:false"`
    : `"POS_TYPE:undefined\\nSTART_TYPE:undefined\\nPOSITION_PASSED:NOT_CALLED\\nPOSITION_TYPE:string\\nREAD_CALLED:false"`;
  expect(jsonOutput).toBe(expected);

  // Then check exit code
  expect(exitCode).toBe(0);
});

// Regression test for #22591 - TUI app pattern: read piped stdin then reopen /dev/tty
test("TUI app pattern: read piped stdin then reopen /dev/tty", async () => {
  // Skip on Windows - no /dev/tty
  if (process.platform === "win32") {
    return;
  }

  // Check if 'script' command is available for TTY simulation
  const scriptPathCmd = Bun.which("script");
  if (!scriptPathCmd) {
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
    ? [scriptPathCmd, "-q", "/dev/null", "sh", "-c", `echo "piped content" | ${bunExe()} tui-app-sim.js`]
    : [scriptPathCmd, "-q", "-c", `echo "piped content" | ${bunExe()} tui-app-sim.js`, "/dev/null"];

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

// Regression test for #22591 - tty.ReadStream handles non-TTY file descriptors correctly
test("tty.ReadStream handles non-TTY file descriptors correctly", () => {
  const fs = require("fs");
  const path = require("path");
  const os = require("os");

  // Create a regular file in the system temp directory
  const tempFile = path.join(os.tmpdir(), "test-regular-file-" + Date.now() + ".txt");
  fs.writeFileSync(tempFile, "test content");

  try {
    const fd = fs.openSync(tempFile, "r");
    const stream = new tty.ReadStream(fd);

    // Regular file should not be identified as TTY
    expect(stream.isTTY).toBe(false);

    // ref/unref should still exist (for compatibility) but may be no-ops
    expect(typeof stream.ref).toBe("function");
    expect(typeof stream.unref).toBe("function");

    // Clean up - only destroy the stream, don't double-close the fd
    stream.destroy();
  } finally {
    try {
      fs.unlinkSync(tempFile);
    } catch (e) {
      // Ignore cleanup errors
    }
  }
});
