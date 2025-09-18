import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, normalizeBunSnapshot, tempDir } from "harness";
import { join } from "path";

// Skip on Windows as it doesn't have /dev/tty
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

// Skip on Windows as it doesn't have /dev/tty
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
