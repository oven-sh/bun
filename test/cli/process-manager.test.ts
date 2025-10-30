import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("bun start shows usage when no script provided", async () => {
  const { stdout, stderr, exitCode } = Bun.spawnSync({
    cmd: [bunExe(), "start"],
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  expect(stderr.toString()).toContain("Usage: bun start SCRIPT");
  expect(exitCode).toBe(1);
});

test("bun stop shows usage when no name provided", async () => {
  const { stdout, stderr, exitCode } = Bun.spawnSync({
    cmd: [bunExe(), "stop"],
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  expect(stderr.toString()).toContain("Usage: bun stop NAME");
  expect(exitCode).toBe(1);
});

test("bun logs shows usage when no name provided", async () => {
  const { stdout, stderr, exitCode } = Bun.spawnSync({
    cmd: [bunExe(), "logs"],
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  expect(stderr.toString()).toContain("Usage: bun logs NAME");
  expect(exitCode).toBe(1);
});

test("bun list shows no processes initially", async () => {
  using dir = tempDir("pm-test", {
    "package.json": JSON.stringify({
      name: "test",
      scripts: {
        dev: "bun run server.js",
      },
    }),
    "server.js": "console.log('hello')",
  });

  const { stdout, stderr, exitCode } = Bun.spawnSync({
    cmd: [bunExe(), "list"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  expect(stdout.toString()).toContain("No processes running");
  expect(exitCode).toBe(0);
});

test("process manager help displays correctly", async () => {
  const { stdout, stderr, exitCode } = Bun.spawnSync({
    cmd: [bunExe(), "start"],
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  expect(stderr.toString()).toContain("bun start");
  expect(exitCode).toBe(1);
});

// Note: Full integration tests for start/stop would require completing
// the socket communication implementation, which is marked as NotImplemented
// in the current code. These tests verify the CLI interface is properly wired up.

test("bun start attempts to start but fails with NotImplemented", async () => {
  using dir = tempDir("pm-test-start", {
    "package.json": JSON.stringify({
      name: "test",
      scripts: {
        dev: "echo 'test'",
      },
    }),
  });

  const { stdout, stderr, exitCode } = Bun.spawnSync({
    cmd: [bunExe(), "start", "dev"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  // The current implementation returns NotImplemented error
  // This is expected as the socket communication is not fully implemented
  expect(stderr.toString()).toMatch(/NotImplemented|implementation incomplete/);
  expect(exitCode).toBe(1);
});

test("commands are properly registered in CLI", async () => {
  // Test that the commands exist and are recognized
  const commands = ["start", "stop", "list", "logs"];

  for (const cmd of commands) {
    const { exitCode } = Bun.spawnSync({
      cmd: [bunExe(), cmd],
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });

    // All commands should exit with code 1 when called without arguments
    // (except list which exits 0 with "no processes")
    if (cmd === "list") {
      expect(exitCode).toBe(0);
    } else {
      expect(exitCode).toBe(1);
    }
  }
});
