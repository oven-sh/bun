import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("toMatchObject with a WeakMap that has a size property does not leak an exception", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const v4 = new WeakMap();
      v4.size = 2;
      try { Bun.jest().expect(v4).toMatchObject(new Int16Array(2)); } catch {}
    `,
    ],
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toBe("");
  expect(stderr).not.toContain("ASSERTION FAILED");
  expect(exitCode).toBe(0);
});

test("toMatchObject with a WeakSet that has a size property does not leak an exception", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const v4 = new WeakSet();
      v4.size = 2;
      try { Bun.jest().expect(v4).toMatchObject(new Int16Array(2)); } catch {}
    `,
    ],
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toBe("");
  expect(stderr).not.toContain("ASSERTION FAILED");
  expect(exitCode).toBe(0);
});

test("console.log does not throw on a WeakMap with a size property", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const v4 = new WeakMap();
      v4.size = 2;
      console.log(v4);
    `,
    ],
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toContain("WeakMap");
  expect(stderr).not.toContain("TypeError");
  expect(exitCode).toBe(0);
});

test("console.log does not throw on a WeakSet with a size property", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const v4 = new WeakSet();
      v4.size = 2;
      console.log(v4);
    `,
    ],
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toContain("WeakSet");
  expect(stderr).not.toContain("TypeError");
  expect(exitCode).toBe(0);
});
