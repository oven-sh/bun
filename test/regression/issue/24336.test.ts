import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// https://github.com/oven-sh/bun/issues/24336
// require('http') should not trigger Object.prototype setters during module loading.
// Node.js produces no output for both CJS and ESM, and Bun should match that behavior.
test("require('http') does not trigger Object.prototype[0] setter", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      Object.defineProperty(Object.prototype, '0', {
        set() { console.log('SETTER_TRIGGERED'); }
      });
      require('http');
    `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toBe("");
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});

test("require('url') does not trigger Object.prototype[0] setter", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      Object.defineProperty(Object.prototype, '0', {
        set() { console.log('SETTER_TRIGGERED'); }
      });
      require('url');
    `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toBe("");
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});

test("require('util') does not trigger Object.prototype[0] setter", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      Object.defineProperty(Object.prototype, '0', {
        set() { console.log('SETTER_TRIGGERED'); }
      });
      require('util');
    `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toBe("");
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});
