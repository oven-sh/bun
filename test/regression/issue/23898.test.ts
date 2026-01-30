import { test, expect } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("findPackageJSON should export from node:module", async () => {
  // Test that findPackageJSON can be imported
  const testCode = `
import { findPackageJSON } from 'node:module';
console.log(typeof findPackageJSON);
`;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", testCode],
    env: bunEnv,
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  expect(stdout.trim()).toBe("function");
  expect(exitCode).toBe(0);
});

test("findPackageJSON should find parent directory package.json", async () => {
  const testCode = `
import { findPackageJSON } from 'node:module';
const result = findPackageJSON('..', import.meta.url);
console.log(typeof result);
`;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", testCode],
    env: bunEnv,
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  expect(stdout.trim()).toBe("string");
  expect(exitCode).toBe(0);
});

test("findPackageJSON should return undefined for non-existent package", async () => {
  const testCode = `
import { findPackageJSON } from 'node:module';
const result = findPackageJSON('/nonexistent/path/package');
console.log(result);
`;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", testCode],
    env: bunEnv,
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  expect(stdout.trim()).toBe("undefined");
  expect(exitCode).toBe(0);
});

test("findPackageJSON works with CommonJS", async () => {
  const testCode = `
const { findPackageJSON } = require('node:module');
console.log(typeof findPackageJSON);
`;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", testCode],
    env: bunEnv,
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  expect(stdout.trim()).toBe("function");
  expect(exitCode).toBe(0);
});
