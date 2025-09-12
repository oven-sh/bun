import { expect, test } from "bun:test";
import { openSync } from "fs";
import { bunEnv, bunExe, normalizeBunSnapshot } from "harness";
import tty from "tty";

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
