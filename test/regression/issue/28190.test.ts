import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("node:test async tests should not time out with default 5s timeout", async () => {
  using dir = tempDir("28190", {
    "test.test.mjs": `
import { it } from 'node:test';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
it('long async test', async () => {
  await sleep(6000);
});
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "test.test.mjs"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const output = stdout + stderr;
  expect(output).not.toContain("timed out");
  expect(output).toContain("pass");
  expect(exitCode).toBe(0);
}, 15_000);

test("node:test before hook should not time out with default 5s timeout", async () => {
  using dir = tempDir("28190", {
    "test.test.mjs": `
import { it, before } from 'node:test';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
before(async () => {
  await sleep(6000);
});
it('test after long before hook', async () => {
  // pass
});
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "test.test.mjs"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const output = stdout + stderr;
  expect(output).not.toContain("timed out");
  expect(output).toContain("pass");
  expect(exitCode).toBe(0);
}, 15_000);

test("node:test afterEach hook should not time out with default 5s timeout", async () => {
  using dir = tempDir("28190", {
    "test.test.mjs": `
import { it, afterEach } from 'node:test';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
afterEach(async () => {
  await sleep(6000);
});
it('test with long afterEach hook', async () => {
  // pass
});
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "test.test.mjs"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const output = stdout + stderr;
  expect(output).not.toContain("timed out");
  expect(output).toContain("pass");
  expect(exitCode).toBe(0);
}, 15_000);

test("node:test explicit timeout should still be respected", async () => {
  using dir = tempDir("28190", {
    "test.test.mjs": `
import { it } from 'node:test';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
it('test with explicit timeout', { timeout: 1000 }, async () => {
  await sleep(3000);
});
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "test.test.mjs"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const output = stdout + stderr;
  expect(output).toContain("timed out");
  expect(exitCode).not.toBe(0);
}, 15_000);

test("node:test explicit per-test timeout overrides default no-timeout", async () => {
  using dir = tempDir("28190", {
    "test.test.mjs": `
import { it } from 'node:test';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
it('fast test with explicit timeout', { timeout: 2000 }, async () => {
  await sleep(500);
});
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "test.test.mjs"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const output = stdout + stderr;
  expect(output).toContain("pass");
  expect(output).not.toContain("timed out");
  expect(exitCode).toBe(0);
}, 15_000);
