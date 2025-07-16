import { test, expect } from "bun:test";
import { bunExe, bunEnv, tempDirWithFiles } from "harness";
import { spawn } from "bun";

test("bun install --linker isolated", async () => {
  const dir = tempDirWithFiles("linker-isolated", {
    "package.json": JSON.stringify({
      name: "test-linker",
      version: "1.0.0",
      dependencies: {
        "is-number": "^7.0.0"
      }
    }),
  });

  await using proc = spawn({
    cmd: [bunExe(), "install", "--linker", "isolated"],
    cwd: dir,
    env: bunEnv,
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  // Should not show validation errors for valid linker values
  const output = stdout + stderr;
  expect(output).not.toContain("Invalid --linker value");
});

test("bun install --linker hoisted", async () => {
  const dir = tempDirWithFiles("linker-hoisted", {
    "package.json": JSON.stringify({
      name: "test-linker",
      version: "1.0.0",
      dependencies: {
        "is-number": "^7.0.0"
      }
    }),
  });

  await using proc = spawn({
    cmd: [bunExe(), "install", "--linker", "hoisted"],
    cwd: dir,
    env: bunEnv,
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  // Should not show validation errors for valid linker values
  const output = stdout + stderr;
  expect(output).not.toContain("Invalid --linker value");
});

test("bun install --linker invalid should fail", async () => {
  const dir = tempDirWithFiles("linker-invalid", {
    "package.json": JSON.stringify({
      name: "test-linker",
      version: "1.0.0",
    }),
  });

  await using proc = spawn({
    cmd: [bunExe(), "install", "--linker", "invalid"],
    cwd: dir,
    env: bunEnv,
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  expect(exitCode).toBe(1);
  
  // Check both stdout and stderr for the error message
  const output = stdout + stderr;
  expect(output).toContain("Invalid --linker value");
  expect(output).toContain("Expected 'isolated' or 'hoisted'");
});