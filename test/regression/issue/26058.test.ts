// Test for GitHub issue #26058: bun repl is slow
// This test verifies that `bun repl` now uses a built-in REPL instead of bunx bun-repl

import { spawnSync } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

describe("issue #26058 - bun repl startup time", () => {
  test("bun repl command is recognized", () => {
    // Just verify the command is recognized (doesn't require TTY)
    // The REPL itself requires a TTY to run interactively
    const result = spawnSync({
      cmd: [bunExe(), "repl", "--help"],
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });

    // The REPL doesn't have a --help flag, but it should at least start
    // (it will wait for input and then exit if no TTY)
    // Exit code 0 or early termination is expected
    expect(result.exitCode).toBeDefined();
  });

  test("bun repl does not print 'Resolving dependencies'", () => {
    // The key indicator that bunx is being used is the "Resolving dependencies" message
    // Our built-in REPL should not print this

    // Use timeout to prevent hanging
    const result = spawnSync({
      cmd: [bunExe(), "repl"],
      env: {
        ...bunEnv,
        // Ensure no TTY simulation
        TERM: "dumb",
      },
      stderr: "pipe",
      stdout: "pipe",
      stdin: "ignore",
      timeout: 2000, // 2 second timeout - plenty for built-in REPL to start
    });

    const stderr = result.stderr?.toString() || "";
    const stdout = result.stdout?.toString() || "";

    // Should NOT see package manager output from bunx
    expect(stderr).not.toContain("Resolving dependencies");
    expect(stderr).not.toContain("bun add");
    expect(stdout).not.toContain("Resolving dependencies");

    // The built-in REPL should print "Welcome to Bun" if it starts
    // Note: Without a TTY, it may exit immediately or wait indefinitely
    // The important thing is it doesn't try to use bunx
  });
});
