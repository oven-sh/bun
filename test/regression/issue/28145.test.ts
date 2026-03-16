import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test.skipIf(process.platform !== "linux")("process.stdout removes O_NONBLOCK for synchronous pipe writes", async () => {
  // Reproduces https://github.com/oven-sh/bun/issues/28145
  //
  // When process.stdout is initialized for a pipe, FileSink.setup() opens
  // a dup'd fd and sets it to O_NONBLOCK, but never stored the fd on
  // FileSink.fd. This caused Bun__ForceFileSinkToBeSynchronousForProcessObjectStdio
  // to skip the updateNonblocking(fd, false) call, leaving the fd in
  // non-blocking mode. Large writes would then return EAGAIN, making stdout
  // async and causing data truncation.
  //
  // The fix: set this.fd in FileSink.setup() so forceSync properly removes
  // O_NONBLOCK.
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      // Force process.stdout initialization by writing to it
      process.stdout.write("x");
      // Read fd flags from procfs to check O_NONBLOCK
      const fs = require("fs");
      const fdinfo = fs.readFileSync("/proc/self/fdinfo/1", "utf8");
      const flags = parseInt(fdinfo.match(/flags:\\s+(\\d+)/)[1], 8);
      const O_NONBLOCK = 2048;
      const isNonBlock = (flags & O_NONBLOCK) !== 0;
      // Exit 0 if blocking (correct), 1 if non-blocking (bug)
      process.exit(isNonBlock ? 1 : 0);
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // stdout should start with "x" from the initialization write
  expect(stdout).toStartWith("x");
  // Exit code 0 means O_NONBLOCK was correctly removed
  expect(exitCode).toBe(0);
});

test("process.stdout.write flushes large data completely to pipe", async () => {
  // Verify that large writes to a pipe stdout are fully delivered
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const big = Buffer.alloc(256 * 1024, "A").toString();
      process.stdout.write(big);
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout.length).toBe(256 * 1024);
  expect(exitCode).toBe(0);
});
