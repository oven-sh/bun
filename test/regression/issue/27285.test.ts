import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Issue #27285: tty.ReadStream EAGAIN on PTY master fd causes fd to be closed
// When a non-blocking PTY master fd returns EAGAIN, fs.ReadStream._read() calls
// errorOrDestroy() which auto-destroys the stream and closes the fd. Subsequent
// ioctl() calls then fail with EBADF. This is the root cause of Gemini CLI crashes
// with @lydell/node-pty.
test("tty.ReadStream does not close PTY fd on EAGAIN", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
const tty = require("tty");
const { dlopen } = require("bun:ffi");

const suffix = process.platform === "darwin" ? "dylib" : "so.6";
const { symbols } = dlopen("libc." + suffix, {
  openpty: { args: ["ptr", "ptr", "ptr", "ptr", "ptr"], returns: "int" },
  close: { args: ["int"], returns: "int" },
  ioctl: { args: ["int", "u64", "ptr"], returns: "int" },
  fcntl: { args: ["int", "int", "int"], returns: "int" },
});

const F_GETFL = 3;
const F_SETFL = 4;
const O_NONBLOCK = process.platform === "darwin" ? 0x0004 : 0o4000;

// Open a PTY pair
const master = new Int32Array(1);
const slave = new Int32Array(1);
if (symbols.openpty(master, slave, null, null, null) !== 0) {
  console.error("FAIL: openpty failed");
  process.exit(1);
}

const masterFd = master[0];
const slaveFd = slave[0];

// Set master fd to non-blocking, like node-pty does.
// This causes fs.read() to return EAGAIN when no data is available.
const flags = symbols.fcntl(masterFd, F_GETFL, 0);
symbols.fcntl(masterFd, F_SETFL, flags | O_NONBLOCK);

// Create a tty.ReadStream on the master fd (like node-pty does)
const stream = new tty.ReadStream(masterFd);

// Handle EAGAIN errors (node-pty does this too)
stream.on("error", (err) => {
  if (err.code === "EAGAIN" || err.code === "EWOULDBLOCK") {
    // Expected - no data available on non-blocking fd
  }
});

// Start reading to trigger _read -> fs.read -> EAGAIN
stream.resume();

// Wait for the event loop to process the EAGAIN
await new Promise((resolve) => setTimeout(resolve, 200));

// The critical test: after EAGAIN, the fd should still be valid.
// Use ioctl TIOCGWINSZ to check fd validity (same as node-pty's resize).
const TIOCGWINSZ = process.platform === "darwin" ? 0x40087468 : 0x5413;
const winsize = new Uint16Array(4);
const ret = symbols.ioctl(masterFd, TIOCGWINSZ, winsize);

if (ret === -1) {
  console.error("FAIL: ioctl returned -1, fd was closed by EAGAIN handler");
  process.exit(1);
}

if (stream.destroyed) {
  console.error("FAIL: stream was destroyed by EAGAIN");
  process.exit(1);
}

console.log("PASS");

// Clean up
stream.destroy();
symbols.close(slaveFd);
`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).not.toContain("FAIL");
  expect(stdout).toContain("PASS");
  expect(exitCode).toBe(0);
});
