// https://github.com/oven-sh/bun/issues/28664
import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("process._fatalException routes errors to active domain", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const d = require('domain').create();
      d.on('error', (e) => console.log('domain error: ' + e.message));
      d.enter();
      setImmediate(() => {
        process._fatalException(new Error('CRASH!!!'));
      });
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toContain("domain error: CRASH!!!");
  expect(exitCode).toBe(0);
});

test("process._fatalException sets domainThrown on error", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const d = require('domain').create();
      d.on('error', (e) => {
        console.log('domainThrown: ' + e.domainThrown);
        console.log('hasDomain: ' + (e.domain != null));
      });
      d.enter();
      setImmediate(() => {
        process._fatalException(new Error('test'));
      });
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toContain("domainThrown: true");
  expect(stdout).toContain("hasDomain: true");
  expect(exitCode).toBe(0);
});

test("process._fatalException falls back to uncaughtException when no domain", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      process.on('uncaughtException', (err) => {
        console.log('caught: ' + err.message);
      });
      process._fatalException(new Error('no domain'));
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toContain("caught: no domain");
  expect(exitCode).toBe(0);
});

test("process._fatalException exits non-zero when unhandled", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      process._fatalException(new Error('unhandled'));
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toContain("unhandled");
  expect(exitCode).toBe(1);
});

test("process._fatalException returns true when handled by domain", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const d = require('domain').create();
      d.on('error', () => {});
      d.run(() => {
        const result = process._fatalException(new Error('test'));
        console.log('result: ' + result);
      });
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toContain("result: true");
  expect(exitCode).toBe(0);
});

test("process._fatalException returns true when handled by uncaughtException", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      process.on('uncaughtException', () => {});
      const result = process._fatalException(new Error('test'));
      console.log('result: ' + result);
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toContain("result: true");
  expect(exitCode).toBe(0);
});

test("domain.enter/exit properly sets process.domain", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const domain = require('domain');
      const d = domain.create();
      console.log('before: ' + (process.domain == null));
      d.enter();
      console.log('entered: ' + (process.domain === d));
      d.exit();
      console.log('exited: ' + (process.domain == null));
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toContain("before: true");
  expect(stdout).toContain("entered: true");
  expect(stdout).toContain("exited: true");
  expect(exitCode).toBe(0);
});

test("nested domain.enter/exit restores previous domain", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const domain = require('domain');
      const d1 = domain.create();
      const d2 = domain.create();
      d1.enter();
      console.log('d1 entered: ' + (process.domain === d1));
      d2.enter();
      console.log('d2 entered: ' + (process.domain === d2));
      d2.exit();
      console.log('d2 exited, restored d1: ' + (process.domain === d1));
      d1.exit();
      console.log('d1 exited: ' + (process.domain == null));
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toContain("d1 entered: true");
  expect(stdout).toContain("d2 entered: true");
  expect(stdout).toContain("d2 exited, restored d1: true");
  expect(stdout).toContain("d1 exited: true");
  expect(exitCode).toBe(0);
});
