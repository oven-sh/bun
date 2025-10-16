import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

describe("sourceCodePreview config option", () => {
  test("default behavior shows source code in error stack traces", async () => {
    using dir = tempDir("source-code-preview-default", {
      "test.js": `
function foo() {
  throw new Error("Test error");
}
foo();
      `,
    });

    const proc = Bun.spawn({
      cmd: [bunExe(), "test.js"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const stderr = await proc.stderr.text();
    const exitCode = await proc.exited;

    expect(exitCode).toBe(1);

    // Should contain file path and line numbers
    expect(stderr).toContain("test.js:");

    // Should contain source code preview with line numbers and pipes
    expect(stderr).toMatch(/\d+\s+\|/);

    // Should contain the source line with "throw new Error"
    expect(stderr).toContain('throw new Error("Test error")');

    // Should contain caret indicator
    expect(stderr).toContain("^");
  });

  test("sourceCodePreview=false disables source code in error stack traces", async () => {
    using dir = tempDir("source-code-preview-disabled", {
      "bunfig.toml": `
[runtime]
sourceCodePreview = false
      `,
      "test.fixture.ts": `
function foo() {
  console.log("before error");
  throw new Error("Test error");
}
foo();
      `,
    });

    const proc2 = Bun.spawn({
      cmd: [bunExe(), "test.fixture.ts"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = await proc2.stdout.text();
    const stderr = await proc2.stderr.text();
    const exitCode = await proc2.exited;

    expect(exitCode).toBe(1);

    // stdout should contain the console.log output from the program
    expect(stdout).toContain("before error");

    // Should still contain file path and line numbers in stack trace
    expect(stderr).toContain("test.fixture.ts:");
    expect(stderr).toContain("Test error");

    // Should NOT contain the console.log source code line in the error output
    expect(stderr).not.toContain("console.log");

    // Should NOT contain source code snippets (no pipe characters from source display)
    // The source code preview shows lines like:
    //   3 |   throw new Error("Test error");
    //       ^
    expect(stderr).not.toMatch(/\d+\s+\|/);

    // Should NOT contain caret indicators
    expect(stderr).not.toContain("    ^");

    // Should NOT show the actual source line "throw new Error"
    expect(stderr).not.toContain('throw new Error("Test error")');
  });
});
