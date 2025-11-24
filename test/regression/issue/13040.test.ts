import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";

// https://github.com/oven-sh/bun/issues/13040
// process.on('SIGINT', handler) was being ignored on Windows - Ctrl+C would
// immediately terminate the process instead of calling the handler.
//
// The fix (in c-bindings.cpp) modifies the Windows console control handler
// (Ctrlhandler) to check if there's a JavaScript SIGINT handler registered.
// If there is, it returns TRUE to prevent Windows from terminating the process,
// allowing libuv's signal handler to invoke the JavaScript callback.
//
// Note: On Windows, process.kill(pid, "SIGINT") uses uv_kill which may
// terminate the process directly (via TerminateProcess) when
// GenerateConsoleCtrlEvent fails for processes not in the same console group.
// The fix specifically addresses the console Ctrl+C scenario.
//
// These tests verify the signal handler registration and emission works correctly.
// Manual testing is required to verify the actual Ctrl+C behavior:
//   1. Run: bun -e "process.on('SIGINT', () => { console.log('SIGINT'); process.exit(0); }); setInterval(() => {}, 1000);"
//   2. Press Ctrl+C
//   3. Expected: "SIGINT" should be printed, then the process exits with code 0

test("SIGINT handler can be registered and receives events", async () => {
  // This test verifies that:
  // 1. SIGINT handler can be registered
  // 2. The handler code path works when the signal is emitted
  using dir = tempDir("sigint-test", {
    "sigint-handler.js": `
      let handlerCalled = false;

      process.on("SIGINT", () => {
        handlerCalled = true;
        console.log("SIGINT_HANDLER_CALLED");
        process.exit(42);
      });

      // Manually emit SIGINT to test the handler
      console.log("READY");
      process.emit("SIGINT");
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "sigint-handler.js"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  expect(stdout).toContain("SIGINT_HANDLER_CALLED");
  expect(exitCode).toBe(42);
});

test("SIGINT handler with async work", async () => {
  // Test that async operations work in SIGINT handler
  using dir = tempDir("sigint-async-test", {
    "sigint-async.js": `
      process.on("SIGINT", async () => {
        console.log("START");
        await Bun.sleep(100);
        console.log("END");
        process.exit(0);
      });

      console.log("READY");
      process.emit("SIGINT");
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "sigint-async.js"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  expect(stdout).toContain("START");
  expect(stdout).toContain("END");
  expect(exitCode).toBe(0);
});

test("multiple SIGINT handlers", async () => {
  using dir = tempDir("sigint-multi-handler", {
    "sigint-multi.js": `
      let calls = [];

      process.on("SIGINT", () => {
        calls.push("handler1");
      });

      process.on("SIGINT", () => {
        calls.push("handler2");
        console.log(calls.join(","));
        process.exit(0);
      });

      process.emit("SIGINT");
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "sigint-multi.js"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  expect(stdout).toContain("handler1,handler2");
  expect(exitCode).toBe(0);
});

test("removing SIGINT handler", async () => {
  using dir = tempDir("sigint-remove", {
    "sigint-remove.js": `
      let calls = [];

      const handler1 = () => {
        calls.push("handler1");
      };

      const handler2 = () => {
        calls.push("handler2");
        console.log(calls.join(","));
        process.exit(0);
      };

      process.on("SIGINT", handler1);
      process.on("SIGINT", handler2);
      process.off("SIGINT", handler1);

      process.emit("SIGINT");
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "sigint-remove.js"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  // Only handler2 should have been called
  expect(stdout).toContain("handler2");
  expect(stdout).not.toContain("handler1,");
  expect(exitCode).toBe(0);
});

// Test the workaround from the issue
test("readline SIGINT workaround from issue", async () => {
  using dir = tempDir("sigint-readline", {
    "sigint-readline.js": `
      const rl = require("readline").createInterface({
        input: process.stdin,
        output: process.stdout
      });

      let sigintReceived = false;

      rl.on("SIGINT", function () {
        process.emit("SIGINT");
      });

      process.on("SIGINT", function () {
        sigintReceived = true;
        console.log("SIGINT_RECEIVED");
        rl.close();
        process.exit(0);
      });

      // Emit SIGINT through readline
      rl.emit("SIGINT");
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "sigint-readline.js"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  expect(stdout).toContain("SIGINT_RECEIVED");
  expect(exitCode).toBe(0);
});

// On non-Windows platforms, test that process.kill works
test.skipIf(isWindows)("SIGINT via process.kill on POSIX", async () => {
  using dir = tempDir("sigint-kill-posix", {
    "sigint-kill.js": `
      process.on("SIGINT", () => {
        console.log("SIGINT_HANDLER_CALLED");
        process.exit(42);
      });

      console.log("READY");
      // Send SIGINT to self
      process.kill(process.pid, "SIGINT");
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "sigint-kill.js"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  expect(stdout).toContain("SIGINT_HANDLER_CALLED");
  expect(exitCode).toBe(42);
});
