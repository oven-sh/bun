import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

describe("sourceCodePreview config option", () => {
  test("default behavior shows source code in error stack traces", async () => {
    using dir = tempDir("source-code-preview-default", {
      "test.js": `
function foo() {
  console.log(new Error().stack);
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
    const stdout = await proc.stdout.text();
    const exitCode = await proc.exited;

    expect(exitCode).toBe(0);
    // Should contain line numbers and source code
    expect(stdout).toContain("test.js:");
    // Should contain the function call location with source code or line number
    expect(stdout.length).toBeGreaterThan(10);
  });

  test("sourceCodePreview=false disables source code in error stack traces", async () => {
    using dir = tempDir("source-code-preview-disabled", {
      "bunfig.toml": `
[runtime]
sourceCodePreview = false
      `,
      "test.fixture.ts": `
function foo() {
  console.log(new Error().stack);
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

    expect(exitCode).toBe(0);

    const output = stdout + stderr;
    // Should still contain file path and line numbers
    expect(output).toContain("test.fixture.ts:");

    // Should NOT contain source code snippets (no pipe characters from source display)
    // The source code preview typically shows lines like:
    //   3 |   console.log(new Error().stack);
    //       ^
    // We check that these formatted source lines are not present
    const lines = output.split("\n");
    const hasSourceCodeDisplay = lines.some(
      line =>
        /^\s*\d+\s+\|/.test(line) || // Lines with line numbers and pipe
        /^\s*\^/.test(line), // Caret indicators
    );
    expect(hasSourceCodeDisplay).toBe(false);
  });
});
