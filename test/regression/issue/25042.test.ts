import { spawnSync } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";

// https://github.com/oven-sh/bun/issues/25042
// bun completions should work on Git Bash (Windows), not show PowerShell error
describe.if(isWindows)("bun completions on Git Bash", () => {
  test("does not show PowerShell error when SHELL is bash", () => {
    const { stdout, stderr, exitCode } = spawnSync({
      cmd: [bunExe(), "completions"],
      env: {
        ...bunEnv,
        SHELL: "/usr/bin/bash",
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    const stderrText = stderr.toString();
    expect(stderrText).not.toContain("PowerShell completions are not yet written");
    expect(stderrText).not.toContain("8939");
    // Should either output bash completions (exit 0) or fail finding a dir (exit 1)
    // but NOT fail with the PowerShell-specific message
    expect([0, 1]).toContain(exitCode);
    if (exitCode !== 0) {
      expect(stderrText).not.toContain("PowerShell");
    }
  });

  test("outputs bash completions when SHELL is bash and stdout is not a tty", () => {
    const { stdout, stderr, exitCode } = spawnSync({
      cmd: [bunExe(), "completions"],
      env: {
        ...bunEnv,
        SHELL: "/usr/bin/bash",
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    // When stdout is not a tty, it should output the completions directly and exit 0
    const stdoutText = stdout.toString();
    // bash completions should contain some bun-specific content
    expect(stdoutText).toContain("bun");
    expect(exitCode).toBe(0);
  });

  test("shows PowerShell error when SHELL is pwsh", () => {
    const { stderr, exitCode } = spawnSync({
      cmd: [bunExe(), "completions"],
      env: {
        ...bunEnv,
        SHELL: "pwsh",
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(stderr.toString()).toContain("PowerShell completions are not yet written");
    expect(exitCode).not.toBe(0);
  });
});
