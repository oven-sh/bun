import { expect, test } from "bun:test";
import { spawnSync } from "bun";
import { bunEnv, bunExe } from "harness";

test("console.assert outputs 'Assertion failed' prefix like Node.js", () => {
  // Test case 1: Single message argument
  {
    const { stderr } = spawnSync({
      cmd: [bunExe(), "-e", `console.assert(false, "message")`],
      env: bunEnv,
      stderr: "pipe",
    });
    const output = stderr.toString().trim();
    expect(output).toBe("Assertion failed: message");
  }

  // Test case 2: No arguments (just false assertion)
  {
    const { stderr } = spawnSync({
      cmd: [bunExe(), "-e", `console.assert(false)`],
      env: bunEnv,
      stderr: "pipe",
    });
    const output = stderr.toString().trim();
    expect(output).toBe("Assertion failed");
  }

  // Test case 3: Multiple arguments
  {
    const { stderr } = spawnSync({
      cmd: [bunExe(), "-e", `console.assert(false, "message", "extra", 123)`],
      env: bunEnv,
      stderr: "pipe",
    });
    const output = stderr.toString().trim();
    expect(output).toBe("Assertion failed: message extra 123");
  }

  // Test case 4: Object argument
  {
    const { stderr } = spawnSync({
      cmd: [bunExe(), "-e", `console.assert(false, {foo: "bar"})`],
      env: bunEnv,
      stderr: "pipe",
    });
    const output = stderr.toString();
    // Check that it starts with "Assertion failed:" and contains the object properties
    expect(output).toContain("Assertion failed:");
    expect(output).toContain("foo:");
    expect(output).toContain('"bar"');
  }

  // Test case 5: True assertion should not output anything
  {
    const { stderr } = spawnSync({
      cmd: [bunExe(), "-e", `console.assert(true, "should not print")`],
      env: bunEnv,
      stderr: "pipe",
    });
    const output = stderr.toString().trim();
    expect(output).toBe("");
  }

  // Test case 6: Formatted string with %s, %d, etc.
  {
    const { stderr } = spawnSync({
      cmd: [bunExe(), "-e", `console.assert(false, "test %s %d", "string", 42)`],
      env: bunEnv,
      stderr: "pipe",
    });
    const output = stderr.toString().trim();
    expect(output).toBe("Assertion failed: test string 42");
  }

  // Test case 7: Empty string as first argument
  {
    const { stderr } = spawnSync({
      cmd: [bunExe(), "-e", `console.assert(false, "")`],
      env: bunEnv,
      stderr: "pipe",
    });
    const output = stderr.toString().trim();
    expect(output).toBe("Assertion failed:");
  }

  // Test case 8: undefined as first argument
  {
    const { stderr } = spawnSync({
      cmd: [bunExe(), "-e", `console.assert(false, undefined)`],
      env: bunEnv,
      stderr: "pipe",
    });
    const output = stderr.toString().trim();
    expect(output).toBe("Assertion failed: undefined");
  }

  // Test case 9: null as first argument
  {
    const { stderr } = spawnSync({
      cmd: [bunExe(), "-e", `console.assert(false, null)`],
      env: bunEnv,
      stderr: "pipe",
    });
    const output = stderr.toString().trim();
    expect(output).toBe("Assertion failed: null");
  }
});

test("console.assert uses stderr, not stdout", () => {
  const { stdout, stderr } = spawnSync({
    cmd: [bunExe(), "-e", `console.assert(false, "error message")`],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const stdoutStr = stdout.toString().trim();
  const stderrStr = stderr.toString().trim();

  expect(stdoutStr).toBe("");
  expect(stderrStr).toBe("Assertion failed: error message");
});
