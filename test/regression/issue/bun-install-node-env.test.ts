import { test, expect } from "bun:test";
import { tempDirWithFiles, bunExe, bunEnv } from "harness";
import { spawn } from "bun";

const testDir = tempDirWithFiles("bun-install-node-env", {
  "package.json": JSON.stringify({
    name: "test-package",
    version: "1.0.0",
  }),
  ".env.development": "DEVELOPMENT_VAR=false",
  ".env.production": "PRODUCTION_VAR=production_value",
  ".env.test": "TEST_VAR=test_value",
  "bunfig.toml": "[run]\nsilent = false"
});

test("bun install respects NODE_ENV=development", async () => {
  const { exited, stderr } = spawn({
    cmd: [bunExe(), "install"],
    env: { ...bunEnv, NODE_ENV: "development" },
    cwd: testDir,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [exitCode, output] = await Promise.all([
    exited,
    new Response(stderr).text(),
  ]);

  expect(exitCode).toBe(0);
  // Should load .env.development, not .env.production
  expect(output).toContain(".env.development");
  expect(output).not.toContain(".env.production");
});

test("bun install respects NODE_ENV=production", async () => {
  const { exited, stderr } = spawn({
    cmd: [bunExe(), "install"],
    env: { ...bunEnv, NODE_ENV: "production" },
    cwd: testDir,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [exitCode, output] = await Promise.all([
    exited,
    new Response(stderr).text(),
  ]);

  expect(exitCode).toBe(0);
  // Should load .env.production
  expect(output).toContain(".env.production");
});

test("bun install respects NODE_ENV=test", async () => {
  const { exited, stderr } = spawn({
    cmd: [bunExe(), "install"],
    env: { ...bunEnv, NODE_ENV: "test" },
    cwd: testDir,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [exitCode, output] = await Promise.all([
    exited,
    new Response(stderr).text(),
  ]);

  expect(exitCode).toBe(0);
  // Should load .env.test
  expect(output).toContain(".env.test");
});

test("bun install defaults to production when NODE_ENV is not set", async () => {
  const { exited, stderr } = spawn({
    cmd: [bunExe(), "install"],
    env: bunEnv, // NODE_ENV not set
    cwd: testDir,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [exitCode, output] = await Promise.all([
    exited,
    new Response(stderr).text(),
  ]);

  expect(exitCode).toBe(0);
  // Should default to .env.production
  expect(output).toContain(".env.production");
});

test("bun install respects BUN_ENV over NODE_ENV", async () => {
  const { exited, stderr } = spawn({
    cmd: [bunExe(), "install"],
    env: { ...bunEnv, NODE_ENV: "production", BUN_ENV: "development" },
    cwd: testDir,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [exitCode, output] = await Promise.all([
    exited,
    new Response(stderr).text(),
  ]);

  expect(exitCode).toBe(0);
  // BUN_ENV should take precedence over NODE_ENV
  expect(output).toContain(".env.development");
  expect(output).not.toContain(".env.production");
});