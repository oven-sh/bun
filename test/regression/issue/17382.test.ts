import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Regression test for https://github.com/oven-sh/bun/issues/17382
// Exceptions thrown inside EventEmitter "error" handlers scheduled via
// process.nextTick should propagate as uncaught exceptions and stop execution
// (matching Node.js behavior).

test("exception thrown in stream error handler via nextTick stops execution", async () => {
  // This reproduces the original issue: a TCP socket fails to connect,
  // the stream's error handler throws, but execution continues and the
  // error handler fires twice.
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const net = require("net");
      const socket = new net.Socket();
      let errorCount = 0;

      socket.on("error", (err) => {
        errorCount++;
        console.log("ERROR_COUNT:" + errorCount);
        throw new Error("re-thrown: " + err.message);
      });

      try {
        socket.connect(14582, "localhost");
        await new Promise((resolve) => setTimeout(resolve, 2000));
        console.log("UNREACHABLE_END");
      } catch(e) {
        console.error("CAUGHT:" + e.message);
        process.exit(1);
      }
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // Error handler should fire exactly once
  expect(stdout).toContain("ERROR_COUNT:1");
  expect(stdout).not.toContain("ERROR_COUNT:2");
  // Code should not continue after the throw
  expect(stdout).not.toContain("UNREACHABLE_END");
  expect(stderr).toContain("re-thrown:");
  expect(exitCode).not.toBe(0);
});

test("exception in nextTick callback stops the tick loop", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      process.nextTick(() => {
        throw new Error("first tick error");
      });

      process.nextTick(() => {
        console.log("SECOND_TICK");
      });

      setTimeout(() => {
        console.log("UNREACHABLE_TIMEOUT");
      }, 100);
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toContain("first tick error");
  // Second nextTick should NOT run after the first one throws
  expect(stdout).not.toContain("SECOND_TICK");
  expect(stdout).not.toContain("UNREACHABLE_TIMEOUT");
  expect(exitCode).not.toBe(0);
});

test("process.on('uncaughtException') handles nextTick errors", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      process.on("uncaughtException", (err) => {
        console.log("CAUGHT:" + err.message);
        process.exit(42);
      });

      process.nextTick(() => {
        throw new Error("should be caught");
      });
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toContain("CAUGHT:should be caught");
  expect(exitCode).toBe(42);
});
