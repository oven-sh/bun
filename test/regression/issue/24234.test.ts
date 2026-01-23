import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("console.log with %j should format as JSON", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", "console.log('%j', {foo: 'bar'})"],
    env: bunEnv,
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(stdout).toBe('{"foo":"bar"}\n');
  expect(exitCode).toBe(0);
});

test("console.log with %j should handle arrays", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", "console.log('%j', [1, 2, 3])"],
    env: bunEnv,
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(stdout).toBe("[1,2,3]\n");
  expect(exitCode).toBe(0);
});

test("console.log with %j should handle nested objects", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", "console.log('%j', {a: {b: {c: 123}}})"],
    env: bunEnv,
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(stdout).toBe('{"a":{"b":{"c":123}}}\n');
  expect(exitCode).toBe(0);
});

test("console.log with %j should handle primitives", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", "console.log('%j %j %j %j', 'string', 123, true, null)"],
    env: bunEnv,
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(stdout).toBe('"string" 123 true null\n');
  expect(exitCode).toBe(0);
});

test("console.log with %j and additional text", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", "console.log('Result: %j', {status: 'ok'})"],
    env: bunEnv,
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(stdout).toBe('Result: {"status":"ok"}\n');
  expect(exitCode).toBe(0);
});
