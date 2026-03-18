import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";

// Regression test for https://github.com/oven-sh/bun/issues/27285
// tty.ReadStream was auto-destroying (and closing the fd) because autoClose
// defaulted to true (inherited from fs.ReadStream). This caused node-pty to
// crash with "ioctl(2) failed, EBADF" because the PTY master fd was closed
// prematurely, sending SIGHUP to the child process.
describe.skipIf(isWindows)("tty.ReadStream should not auto-close the fd", () => {
  it("has autoClose set to false", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
const tty = require("tty");
const fs = require("fs");
const fd = fs.openSync("/dev/null", "r");
const stream = new tty.ReadStream(fd);
console.log("autoClose:" + stream.autoClose);
console.log("autoDestroy:" + stream._readableState.autoDestroy);
fs.closeSync(fd);
process.exit(0);
`,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toContain("autoClose:false");
    expect(stdout).toContain("autoDestroy:false");
    expect(exitCode).toBe(0);
  });

  it("fd stays valid after stream errors (does not auto-destroy)", async () => {
    // This reproduces the node-pty scenario: create a tty.ReadStream on a
    // PTY master fd, let it encounter errors during reading, and verify the
    // fd is NOT auto-closed. With the bug, autoDestroy:true would close the
    // fd within the first event loop tick.
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
const tty = require("tty");
const fs = require("fs");

let fd;
try {
  fd = fs.openSync("/dev/ptmx", "r+");
} catch {
  fd = fs.openSync("/dev/null", "r");
}

// Create a ReadStream on the fd (like node-pty does)
const stream = new tty.ReadStream(fd);

// node-pty adds an error handler and ignores EAGAIN
stream.on("error", () => {});

// Check fd validity across multiple event loop ticks using setImmediate.
// The bug caused the fd to be closed within the first tick due to
// autoDestroy:true, so polling with setImmediate directly targets that.
let ticksRemaining = 10;
function checkFd() {
  ticksRemaining--;
  try {
    fs.fstatSync(fd);
    if (ticksRemaining > 0) {
      setImmediate(checkFd);
    } else {
      console.log("FD_STILL_VALID:true");
      process.exit(0);
    }
  } catch {
    console.log("FD_STILL_VALID:false");
    process.exit(0);
  }
}
setImmediate(checkFd);
`,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toContain("FD_STILL_VALID:true");
    expect(exitCode).toBe(0);
  });
});
