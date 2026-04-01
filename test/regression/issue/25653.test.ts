import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// https://github.com/oven-sh/bun/issues/25653
describe("require() errors in --print and -e mode", () => {
  test("require() of non-existent package in --print should error", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "--print", 'require("doesnotexist")'],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    // Should NOT print "undefined" - should error
    expect(stdout).not.toContain("undefined");
    // Should have an error message about the package not being found
    expect(stderr).toContain("Cannot find package 'doesnotexist'");
    // Exit code should be 1 (error)
    expect(exitCode).toBe(1);
  });

  test("require() of non-existent package in -e should error", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", 'console.log(1); require("doesnotexist"); console.log(2)'],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    // Should print "1" but NOT "2" because error should stop execution
    expect(stdout).toContain("1");
    expect(stdout).not.toContain("2");
    // Should have an error message
    expect(stderr).toContain("Cannot find package 'doesnotexist'");
    // Exit code should be 1
    expect(exitCode).toBe(1);
  });

  test("throw in CommonJS mode (with require reference) should propagate", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", 'require; throw new Error("test error")'],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    // Should have the error message
    expect(stderr).toContain("test error");
    // Exit code should be 1
    expect(exitCode).toBe(1);
  });

  test("require of existing module should still work", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "--print", 'require("fs").readFileSync !== undefined'],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(stdout.trim()).toBe("true");
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });
});
