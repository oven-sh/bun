import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

describe("bun repl", () => {
  test("evaluates simple expressions", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "repl"],
      env: bunEnv,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });

    proc.stdin.write("1 + 2\n");
    proc.stdin.end();

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toContain("3");
    expect(exitCode).toBe(0);
  });

  test("supports Bun globals", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "repl"],
      env: bunEnv,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });

    proc.stdin.write("typeof Bun\n");
    proc.stdin.end();

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toContain("object");
    expect(exitCode).toBe(0);
  });

  test("Bun.version is available", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "repl"],
      env: bunEnv,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });

    proc.stdin.write("Bun.version\n");
    proc.stdin.end();

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // Should contain a version string
    expect(stdout).toMatch(/\d+\.\d+\.\d+/);
    expect(exitCode).toBe(0);
  });

  test("let declarations persist across lines", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "repl"],
      env: bunEnv,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });

    proc.stdin.write("let x = 5\n");
    proc.stdin.write("x * 2\n");
    proc.stdin.end();

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toContain("10");
    expect(exitCode).toBe(0);
  });

  test("const declarations persist across lines", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "repl"],
      env: bunEnv,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });

    proc.stdin.write("const y = 7\n");
    proc.stdin.write("y + 3\n");
    proc.stdin.end();

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toContain("10");
    expect(exitCode).toBe(0);
  });

  test("function declarations persist", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "repl"],
      env: bunEnv,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });

    proc.stdin.write("function add(a, b) { return a + b }\n");
    proc.stdin.write("add(2, 3)\n");
    proc.stdin.end();

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toContain("5");
    expect(exitCode).toBe(0);
  });

  test(".help command works", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "repl"],
      env: bunEnv,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });

    proc.stdin.write(".help\n");
    proc.stdin.end();

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toContain("REPL Commands");
    expect(stdout).toContain(".exit");
    expect(stdout).toContain(".clear");
    expect(exitCode).toBe(0);
  });

  test(".timing command toggles timing display", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "repl"],
      env: bunEnv,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });

    proc.stdin.write(".timing\n");
    proc.stdin.end();

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toContain("Timing");
    expect(exitCode).toBe(0);
  });

  test("error handling shows error message", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "repl"],
      env: bunEnv,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });

    proc.stdin.write("throw new Error('test error')\n");
    proc.stdin.end();

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // Error should be displayed in stderr
    const output = stdout + stderr;
    expect(output).toContain("test error");
    expect(exitCode).toBe(0);
  });

  test("object literals are displayed", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "repl"],
      env: bunEnv,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });

    proc.stdin.write("({ foo: 'bar' })\n");
    proc.stdin.end();

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toContain("foo");
    expect(stdout).toContain("bar");
    expect(exitCode).toBe(0);
  });

  test("arrays are displayed", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "repl"],
      env: bunEnv,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });

    proc.stdin.write("[1, 2, 3]\n");
    proc.stdin.end();

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toContain("1");
    expect(stdout).toContain("2");
    expect(stdout).toContain("3");
    expect(exitCode).toBe(0);
  });

  test("undefined is not printed for statements", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "repl"],
      env: bunEnv,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });

    proc.stdin.write("let z = 10\n");
    proc.stdin.write("z\n");
    proc.stdin.end();

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // The second line should show 10
    expect(stdout).toContain("10");
    expect(exitCode).toBe(0);
  });

  test("multiline input with semicolons", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "repl"],
      env: bunEnv,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });

    proc.stdin.write("var a = 1; var b = 2; a + b\n");
    proc.stdin.end();

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toContain("3");
    expect(exitCode).toBe(0);
  });

  // TODO: Enable this test once top-level await is implemented in the REPL.
  // Currently, top-level await requires wrapping in an async IIFE, which
  // the full REPL transforms (repl_transforms.zig) will handle.
  test.skip("async/await works", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "repl"],
      env: bunEnv,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });

    proc.stdin.write("await Promise.resolve(42)\n");
    proc.stdin.end();

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toContain("42");
    expect(exitCode).toBe(0);
  });
});
