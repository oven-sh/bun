// Test that --use-system-ca flag and NODE_USE_SYSTEM_CA environment variable work

import { test, expect } from "bun:test";
import { spawn } from "bun";
import { bunEnv, bunExe } from "harness";

test("--use-system-ca flag is accepted", async () => {
  await using proc = spawn({
    cmd: [bunExe(), "--use-system-ca", "-e", "console.log('OK')"],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  expect(exitCode).toBe(0);
  expect(stdout.trim()).toBe("OK");
  expect(stderr).not.toContain("Unknown option");
});

test("NODE_USE_SYSTEM_CA=1 environment variable works", async () => {
  await using proc = spawn({
    cmd: [bunExe(), "-e", "console.log('OK')"],
    env: { ...bunEnv, NODE_USE_SYSTEM_CA: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  expect(exitCode).toBe(0);
  expect(stdout.trim()).toBe("OK");
});

test("--use-system-ca with HTTPS request", async () => {
  const testCode = `
    const https = require('https');
    https.get('https://www.google.com', (res) => {
      console.log('STATUS:', res.statusCode);
      process.exit(0);
    }).on('error', (err) => {
      console.error('ERROR:', err.message);
      process.exit(1);
    });
  `;

  await using proc = spawn({
    cmd: [bunExe(), "--use-system-ca", "-e", testCode],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  expect(exitCode).toBe(0);
  expect(stdout).toContain("STATUS:");
});

test("NODE_USE_SYSTEM_CA=1 with HTTPS request", async () => {
  const testCode = `
    const https = require('https');
    https.get('https://www.google.com', (res) => {
      console.log('STATUS:', res.statusCode);
      process.exit(0);
    }).on('error', (err) => {
      console.error('ERROR:', err.message);
      process.exit(1);
    });
  `;

  await using proc = spawn({
    cmd: [bunExe(), "-e", testCode],
    env: { ...bunEnv, NODE_USE_SYSTEM_CA: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  expect(exitCode).toBe(0);
  expect(stdout).toContain("STATUS:");
});