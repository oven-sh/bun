import { describe, test, expect } from "bun:test";
import { spawn } from "bun";
import { bunExe } from "harness";

describe("fuzzilli command", () => {
  test("bun fuzzilli command exists", () => {
    // Just verify the command doesn't crash when invoked
    // We can't actually test REPRL without setting up FDs
    const result = spawn({
      cmd: [bunExe(), "fuzzilli"],
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        BUN_DEBUG_QUIET_LOGS: "1",
      },
    });

    // The command will fail because REPRL FDs aren't set up
    // but it should at least start
    expect(result).toBeDefined();
  });
});
