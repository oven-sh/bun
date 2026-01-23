import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Test for https://github.com/oven-sh/bun/issues/26151
// console.log() with zero arguments should print an empty line, matching Node.js behavior

describe("console methods with zero arguments print empty line", () => {
  test("console.log()", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", `console.log("foo"); console.log(); console.log("bar");`],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toBe("foo\n\nbar\n");
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });

  test("console.info()", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", `console.info("foo"); console.info(); console.info("bar");`],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toBe("foo\n\nbar\n");
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });

  test("console.debug()", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", `console.debug("foo"); console.debug(); console.debug("bar");`],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toBe("foo\n\nbar\n");
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });

  test("console.warn()", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", `console.warn("foo"); console.warn(); console.warn("bar");`],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toBe("");
    expect(stderr).toBe("foo\n\nbar\n");
    expect(exitCode).toBe(0);
  });

  test("console.error()", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", `console.error("foo"); console.error(); console.error("bar");`],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toBe("");
    expect(stderr).toBe("foo\n\nbar\n");
    expect(exitCode).toBe(0);
  });

  test("console methods with arguments still work normally", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", `console.log("hello", "world"); console.log(123); console.log({ foo: "bar" });`],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toContain("hello world");
    expect(stdout).toContain("123");
    expect(stdout).toContain("foo");
    expect(stdout).toContain("bar");
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });
});
