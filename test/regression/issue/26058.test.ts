// Test for GitHub issue #26058: bun repl is slow
// This test verifies that `bun repl` now uses a built-in REPL instead of bunx bun-repl

import { spawnSync } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

describe("issue #26058 - bun repl startup time", () => {
  test("bun repl starts without downloading packages", () => {
    // The key indicator that bunx is being used is the "Resolving dependencies" message
    // Our built-in REPL should not print this

    // Use timeout to prevent hanging since REPL requires TTY for interactive input
    const result = spawnSync({
      cmd: [bunExe(), "repl"],
      env: {
        ...bunEnv,
        TERM: "dumb",
      },
      stderr: "pipe",
      stdout: "pipe",
      stdin: "ignore",
      timeout: 3000,
    });

    const stderr = result.stderr?.toString() || "";
    const stdout = result.stdout?.toString() || "";

    // Should NOT see package manager output from bunx
    expect(stderr).not.toContain("Resolving dependencies");
    expect(stderr).not.toContain("bun add");
    expect(stdout).not.toContain("Resolving dependencies");

    // The built-in REPL should print "Welcome to Bun" when starting
    // Even without a TTY, the welcome message should appear in stdout
    expect(stdout).toContain("Welcome to Bun");
  });
});
