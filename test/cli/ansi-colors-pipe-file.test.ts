import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";
import { tmpdir } from "os";
import { join } from "path";

test("Bun's syntax errors should not have ANSI codes when stderr is piped", async () => {
  const dir = tempDirWithFiles("ansi-colors-syntax-error", {
    "test.ts": `const x = ;`, // Syntax error
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test.ts"],
    env: bunEnv, // No FORCE_COLOR or NO_COLOR set
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  expect(exitCode).not.toBe(0);
  // Syntax error messages when piped should NOT contain ANSI escape codes
  expect(stderr).not.toContain("\x1b[");
  expect(stderr.length).toBeGreaterThan(0);
});

test("Bun's syntax errors should have ANSI codes when FORCE_COLOR is set", async () => {
  const dir = tempDirWithFiles("ansi-colors-syntax-error-force", {
    "test.ts": `const x = ;`, // Syntax error
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test.ts"],
    env: { ...bunEnv, FORCE_COLOR: "1" },
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  expect(exitCode).not.toBe(0);
  // Syntax error messages with FORCE_COLOR should contain ANSI escape codes
  expect(stderr).toContain("\x1b[");
  expect(stderr.length).toBeGreaterThan(0);
});

test("Bun test output should not have ANSI codes when stdout is piped", async () => {
  const dir = tempDirWithFiles("ansi-colors-test", {
    "test.test.ts": `
      import { test, expect } from "bun:test";
      test("sample test", () => {
        expect(1).toBe(1);
      });
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "test.test.ts"],
    env: bunEnv, // No FORCE_COLOR or NO_COLOR set
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  const output = stdout + stderr;
  expect(exitCode).toBe(0);
  // Test output when piped should NOT contain ANSI escape codes
  expect(output).not.toContain("\x1b[");
});

test("Bun test output should have ANSI codes when FORCE_COLOR is set", async () => {
  const dir = tempDirWithFiles("ansi-colors-test-force", {
    "test.test.ts": `
      import { test, expect } from "bun:test";
      test("sample test", () => {
        expect(1).toBe(1);
      });
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "test.test.ts"],
    env: { ...bunEnv, FORCE_COLOR: "1" },
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  const output = stdout + stderr;
  expect(exitCode).toBe(0);
  // Test output with FORCE_COLOR should contain ANSI escape codes
  expect(output).toContain("\x1b[");
});

test("Bun install output should not have ANSI codes when stdout is piped", async () => {
  const dir = tempDirWithFiles("ansi-colors-install", {
    "package.json": JSON.stringify({
      name: "test",
      dependencies: {
        "is-number": "^7.0.0",
      },
    }),
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "install"],
    env: bunEnv, // No FORCE_COLOR or NO_COLOR set
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  const output = stdout + stderr;
  expect(exitCode).toBe(0);
  // Install output when piped should NOT contain ANSI escape codes
  expect(output).not.toContain("\x1b[");
});

test("Bun install output should have ANSI codes when FORCE_COLOR is set", async () => {
  const dir = tempDirWithFiles("ansi-colors-install-force", {
    "package.json": JSON.stringify({
      name: "test",
      dependencies: {
        "is-number": "^7.0.0",
      },
    }),
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "install"],
    env: { ...bunEnv, FORCE_COLOR: "1" },
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  const output = stdout + stderr;
  expect(exitCode).toBe(0);
  // Install output with FORCE_COLOR should contain ANSI escape codes
  expect(output).toContain("\x1b[");
});

test("ANSI colors should be disabled when stdout is redirected to a file", async () => {
  const dir = tempDirWithFiles("ansi-colors-file", {
    "test.ts": `console.log("Hello, world!");`,
  });

  const tempDir = mkdtempSync(join(tmpdir(), "bun-test-"));
  const outputFile = join(tempDir, "output.txt");

  try {
    // Run Bun and redirect stdout to a file
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test.ts"],
      env: bunEnv, // No FORCE_COLOR or NO_COLOR set
      cwd: dir,
      stdout: Bun.file(outputFile),
      stderr: "pipe",
    });

    const exitCode = await proc.exited;
    const output = await Bun.file(outputFile).text();

    expect(exitCode).toBe(0);
    // Output should NOT contain ANSI escape codes
    expect(output).not.toContain("\x1b[");
    expect(output).toContain("Hello, world!");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("Runtime errors should not have ANSI codes when stderr is piped", async () => {
  const dir = tempDirWithFiles("ansi-colors-runtime-error", {
    "test.ts": `throw new Error("Test error");`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test.ts"],
    env: bunEnv, // No FORCE_COLOR or NO_COLOR set
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  expect(exitCode).not.toBe(0);
  // Error messages when piped should NOT contain ANSI escape codes
  expect(stderr).not.toContain("\x1b[");
  expect(stderr).toContain("Test error");
});

test("Runtime errors should have ANSI codes when FORCE_COLOR is set", async () => {
  const dir = tempDirWithFiles("ansi-colors-runtime-error-force", {
    "test.ts": `throw new Error("Test error with colors");`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test.ts"],
    env: { ...bunEnv, FORCE_COLOR: "1" },
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  expect(exitCode).not.toBe(0);
  // Error messages with FORCE_COLOR should contain ANSI escape codes
  expect(stderr).toContain("\x1b[");
  expect(stderr).toContain("Test error with colors");
});
