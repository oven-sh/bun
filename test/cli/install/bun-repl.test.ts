import { spawnSync } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

describe("bun repl", () => {
  test("bun repl starts without downloading packages", () => {
    // The built-in REPL should not trigger package downloads
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

    // Should NOT see bunx/package manager output
    expect(stderr).not.toContain("Resolving dependencies");
    expect(stderr).not.toContain("bun add");
    expect(stdout).not.toContain("Resolving dependencies");
  });
});
