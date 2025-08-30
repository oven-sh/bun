import { spawnSync } from "bun";
import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("console.assert outputs 'Assertion failed' prefix like Node.js", () => {
  {
    const { stderr } = spawnSync({
      cmd: [bunExe(), "-e", `console.assert(false, "message")`],
      env: bunEnv,
      stderr: "pipe",
    });
    const output = stderr.toString().trim();
    expect(output).toBe("Assertion failed: message");
  }

  {
    const { stderr } = spawnSync({
      cmd: [bunExe(), "-e", `console.assert(false)`],
      env: bunEnv,
      stderr: "pipe",
    });
    const output = stderr.toString().trim();
    expect(output).toBe("Assertion failed");
  }

  {
    const { stderr } = spawnSync({
      cmd: [bunExe(), "-e", `console.assert(false, "message", "extra", 123)`],
      env: bunEnv,
      stderr: "pipe",
    });
    const output = stderr.toString().trim();
    expect(output).toBe("Assertion failed: message extra 123");
  }

  {
    const { stderr } = spawnSync({
      cmd: [bunExe(), "-e", `console.assert(false, {foo: "bar"})`],
      env: bunEnv,
      stderr: "pipe",
    });
    const output = stderr.toString();
    expect(output).toContain("Assertion failed:");
    expect(output).toContain("foo:");
    expect(output).toContain('"bar"');
  }

  {
    const { stderr } = spawnSync({
      cmd: [bunExe(), "-e", `console.assert(true, "should not print")`],
      env: bunEnv,
      stderr: "pipe",
    });
    const output = stderr.toString().trim();
    expect(output).toBe("");
  }

  {
    const { stderr } = spawnSync({
      cmd: [bunExe(), "-e", `console.assert(false, "test %s %d", "string", 42)`],
      env: bunEnv,
      stderr: "pipe",
    });
    const output = stderr.toString().trim();
    expect(output).toBe("Assertion failed: test string 42");
  }

  {
    const { stderr } = spawnSync({
      cmd: [bunExe(), "-e", `console.assert(false, "")`],
      env: bunEnv,
      stderr: "pipe",
    });
    const output = stderr.toString().trim();
    expect(output).toBe("Assertion failed:");
  }

  {
    const { stderr } = spawnSync({
      cmd: [bunExe(), "-e", `console.assert(false, undefined)`],
      env: bunEnv,
      stderr: "pipe",
    });
    const output = stderr.toString().trim();
    expect(output).toBe("Assertion failed: undefined");
  }

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
