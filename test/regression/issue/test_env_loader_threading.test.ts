import { spawn } from "bun";
import { expect, test } from "bun:test";
import { bunExe, tempDirWithFiles } from "harness";

test("env_loader should not have allocator threading issues with BUN_INSPECT_CONNECT_TO", async () => {
  const dir = tempDirWithFiles("env-loader-threading", {
    ".env": "TEST_ENV_VAR=hello_world",
    "index.js": `console.log(process.env.TEST_ENV_VAR || 'undefined');`,
  });

  // This test verifies that when BUN_INSPECT_CONNECT_TO is set,
  // the debugger thread creates its own env_loader with proper allocator isolation
  // and doesn't cause threading violations when accessing environment files.

  // First, test normal execution without inspector to establish baseline
  const normalProc = spawn({
    cmd: [bunExe(), "index.js"],
    cwd: dir,
    env: {
      ...Bun.env,
      TEST_ENV_VAR: undefined, // Remove from process env to test .env loading
    },
    stdio: ["inherit", "pipe", "pipe"],
  });

  const normalResult = await normalProc.exited;
  const normalStdout = await normalProc.stdout.text();

  expect(normalResult).toBe(0);
  expect(normalStdout.trim()).toBe("hello_world");

  // Now test with BUN_INSPECT_CONNECT_TO set to a non-existent socket
  // This should trigger the debugger thread creation without actually connecting
  const inspectorProc = spawn({
    cmd: [bunExe(), "index.js"],
    cwd: dir,
    env: {
      ...Bun.env,
      BUN_INSPECT_CONNECT_TO: "/tmp/non-existent-debug-socket",
      TEST_ENV_VAR: undefined, // Remove from process env to test .env loading
    },
    stdio: ["inherit", "pipe", "pipe"],
  });

  const inspectorResult = await inspectorProc.exited;
  const inspectorStdout = await inspectorProc.stdout.text();
  const inspectorStderr = await inspectorProc.stderr.text();

  // The process should still work correctly and load .env file
  expect(inspectorResult).toBe(0);
  expect(inspectorStdout.trim()).toBe("hello_world");

  // Should not have any allocator-related errors or panics
  expect(inspectorStderr).not.toContain("panic");
  expect(inspectorStderr).not.toContain("allocator");
  expect(inspectorStderr).not.toContain("thread");
  expect(inspectorStderr).not.toContain("assertion failed");
}, 10000); // 10 second timeout for potential debugger connection attempts
