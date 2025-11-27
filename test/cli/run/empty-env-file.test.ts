// Regression tests for empty .env file issues
// https://github.com/oven-sh/bun/issues/[ISSUE_NUMBER]
// On WSL1 and certain Docker configurations, empty .env files could cause
// file.stat() to fail, preventing script execution entirely.

import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

describe("empty .env file handling", () => {
  test("empty .env file should not prevent script execution", async () => {
    using dir = tempDir("empty-env-file", {
      ".env": "",
      "test.js": "console.log('test');",
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test.js"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);

    expect(stderr).toBe("");
    expect(stdout.trim()).toBe("test");
    expect(exitCode).toBe(0);
  });

  test("empty .env file with other env files", async () => {
    using dir = tempDir("empty-env-with-others", {
      ".env": "",
      ".env.local": "FOO=bar",
      "test.js": "console.log(process.env.FOO);",
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test.js"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);

    expect(stderr).toBe("");
    expect(stdout.trim()).toBe("bar");
    expect(exitCode).toBe(0);
  });

  test("multiple empty .env files should not prevent script execution", async () => {
    using dir = tempDir("multiple-empty-env", {
      ".env": "",
      ".env.local": "",
      ".env.development": "",
      "test.js": "console.log('output');",
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test.js"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);

    expect(stderr).toBe("");
    expect(stdout.trim()).toBe("output");
    expect(exitCode).toBe(0);
  });

  test("empty .env with whitespace only", async () => {
    using dir = tempDir("empty-env-whitespace", {
      ".env": "   \n\n  \t  \n",
      "test.js": "console.log('test');",
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test.js"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);

    expect(stdout.trim()).toBe("test");
    expect(exitCode).toBe(0);
  });

  test("empty .env with only comments", async () => {
    using dir = tempDir("empty-env-comments", {
      ".env": "# This is a comment\n# Another comment\n",
      "test.js": "console.log('test');",
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test.js"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);

    expect(stdout.trim()).toBe("test");
    expect(exitCode).toBe(0);
  });
});
