import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

test("--console-log-file redirects console.log to file", async () => {
  using dir = tempDir("console-log-file", {
    "script.js": `
console.log("hello from console.log");
console.log("second line");
console.log({ foo: "bar" });
    `,
  });

  const logFile = join(String(dir), "console.log");

  await using proc = Bun.spawn({
    cmd: [bunExe(), "--console-log-file", logFile, "script.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // stdout should be empty since console.log was redirected
  expect(stdout).toBe("");
  expect(stderr).toBe("");

  // Check that the log file was created and contains the output
  expect(existsSync(logFile)).toBe(true);
  const logContent = readFileSync(logFile, "utf-8");
  expect(logContent).toContain("hello from console.log");
  expect(logContent).toContain("second line");
  expect(logContent).toContain("foo");
  expect(logContent).toContain("bar");

  expect(exitCode).toBe(0);
});

test("--console-error-file redirects console.error to file", async () => {
  using dir = tempDir("console-error-file", {
    "script.js": `
console.error("error message");
console.error("another error");
console.warn("warning message");
    `,
  });

  const errorFile = join(String(dir), "console.error");

  await using proc = Bun.spawn({
    cmd: [bunExe(), "--console-error-file", errorFile, "script.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // stderr should be empty since console.error was redirected
  expect(stdout).toBe("");
  expect(stderr).toBe("");

  // Check that the error file was created and contains the output
  expect(existsSync(errorFile)).toBe(true);
  const errorContent = readFileSync(errorFile, "utf-8");
  expect(errorContent).toContain("error message");
  expect(errorContent).toContain("another error");
  expect(errorContent).toContain("warning message");

  expect(exitCode).toBe(0);
});

test("both --console-log-file and --console-error-file work together", async () => {
  using dir = tempDir("console-both-files", {
    "script.js": `
console.log("log message");
console.error("error message");
console.log("another log");
console.error("another error");
    `,
  });

  const logFile = join(String(dir), "console.log");
  const errorFile = join(String(dir), "console.error");

  await using proc = Bun.spawn({
    cmd: [bunExe(), "--console-log-file", logFile, "--console-error-file", errorFile, "script.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // Both stdout and stderr should be empty
  expect(stdout).toBe("");
  expect(stderr).toBe("");

  // Check log file
  expect(existsSync(logFile)).toBe(true);
  const logContent = readFileSync(logFile, "utf-8");
  expect(logContent).toContain("log message");
  expect(logContent).toContain("another log");
  expect(logContent).not.toContain("error message");

  // Check error file
  expect(existsSync(errorFile)).toBe(true);
  const errorContent = readFileSync(errorFile, "utf-8");
  expect(errorContent).toContain("error message");
  expect(errorContent).toContain("another error");
  expect(errorContent).not.toContain("log message");

  expect(exitCode).toBe(0);
});

test("console file redirection with relative paths", async () => {
  using dir = tempDir("console-relative-path", {
    "script.js": `
console.log("relative path log");
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "--console-log-file", "output.log", "script.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toBe("");

  // Check that the file was created in the working directory
  const logFile = join(String(dir), "output.log");
  expect(existsSync(logFile)).toBe(true);
  const logContent = readFileSync(logFile, "utf-8");
  expect(logContent).toContain("relative path log");

  expect(exitCode).toBe(0);
});

test("console file redirection overwrites existing file", async () => {
  using dir = tempDir("console-overwrite", {
    "script.js": `
console.log("new content");
    `,
    "console.log": "old content that should be overwritten",
  });

  const logFile = join(String(dir), "console.log");

  await using proc = Bun.spawn({
    cmd: [bunExe(), "--console-log-file", logFile, "script.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  await proc.exited;

  const logContent = readFileSync(logFile, "utf-8");
  expect(logContent).not.toContain("old content");
  expect(logContent).toContain("new content");
});
