import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

describe("console.assert", () => {
  test("with no arguments outputs 'Assertion failed' to stderr", () => {
    const proc = Bun.spawnSync({
      cmd: [bunExe(), "-e", "console.assert(false)"],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(proc.stdout.toString()).toBe("");
    expect(proc.stderr.toString()).toBe("Assertion failed\n");
    expect(proc.exitCode).toBe(0);
  });

  test("with message outputs 'Assertion failed: <message>' to stderr", () => {
    const proc = Bun.spawnSync({
      cmd: [bunExe(), "-e", 'console.assert(false, "test message")'],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(proc.stdout.toString()).toBe("");
    expect(proc.stderr.toString()).toBe("Assertion failed: test message\n");
    expect(proc.exitCode).toBe(0);
  });

  test("with multiple arguments outputs 'Assertion failed: <formatted args>' to stderr", () => {
    const proc = Bun.spawnSync({
      cmd: [bunExe(), "-e", 'console.assert(false, "value is", 42, "and object is", { foo: "bar" })'],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(proc.stdout.toString()).toBe("");
    expect(proc.stderr.toString()).toBe('Assertion failed: value is 42 and object is { foo: "bar" }\n');
    expect(proc.exitCode).toBe(0);
  });

  test("with format string outputs 'Assertion failed: <formatted>' to stderr", () => {
    const proc = Bun.spawnSync({
      cmd: [bunExe(), "-e", 'console.assert(false, "number: %d, string: %s", 123, "hello")'],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(proc.stdout.toString()).toBe("");
    expect(proc.stderr.toString()).toBe("Assertion failed: number: 123, string: hello\n");
    expect(proc.exitCode).toBe(0);
  });

  test("with truthy condition outputs nothing", () => {
    const proc = Bun.spawnSync({
      cmd: [bunExe(), "-e", 'console.assert(true, "this should not appear")'],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(proc.stdout.toString()).toBe("");
    expect(proc.stderr.toString()).toBe("");
    expect(proc.exitCode).toBe(0);
  });

  test("with empty string message outputs 'Assertion failed: ' to stderr", () => {
    const proc = Bun.spawnSync({
      cmd: [bunExe(), "-e", 'console.assert(false, "")'],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(proc.stdout.toString()).toBe("");
    expect(proc.stderr.toString()).toBe("Assertion failed: \n");
    expect(proc.exitCode).toBe(0);
  });

  test("with null argument outputs 'Assertion failed: null' to stderr", () => {
    const proc = Bun.spawnSync({
      cmd: [bunExe(), "-e", "console.assert(false, null)"],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(proc.stdout.toString()).toBe("");
    expect(proc.stderr.toString()).toBe("Assertion failed: null\n");
    expect(proc.exitCode).toBe(0);
  });

  test("with undefined argument outputs 'Assertion failed: undefined' to stderr", () => {
    const proc = Bun.spawnSync({
      cmd: [bunExe(), "-e", "console.assert(false, undefined)"],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(proc.stdout.toString()).toBe("");
    expect(proc.stderr.toString()).toBe("Assertion failed: undefined\n");
    expect(proc.exitCode).toBe(0);
  });

  test("with long message handles output correctly", () => {
    const longMessage = "a]b]c".repeat(50);
    const proc = Bun.spawnSync({
      cmd: [bunExe(), "-e", `console.assert(false, "${longMessage}")`],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(proc.stdout.toString()).toBe("");
    expect(proc.stderr.toString()).toBe(`Assertion failed: ${longMessage}\n`);
    expect(proc.exitCode).toBe(0);
  });
});
