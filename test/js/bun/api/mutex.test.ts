import { test, expect } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot, tempDir } from "harness";

test("Mutex constructor", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", "const mutex = new Bun.Mutex(); console.log(typeof mutex);"],
    env: bunEnv,
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`"object"`);
  expect(exitCode).toBe(0);
});

test("Mutex lock and unlock", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const mutex = new Bun.Mutex();
      mutex.lock();
      mutex.unlock();
      console.log("success");
      `,
    ],
    env: bunEnv,
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`"success"`);
  expect(exitCode).toBe(0);
});

test("Mutex tryLock returns boolean", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const mutex = new Bun.Mutex();
      const result = mutex.tryLock();
      console.log(typeof result, result);
      mutex.unlock();
      `,
    ],
    env: bunEnv,
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`"boolean true"`);
  expect(exitCode).toBe(0);
});

test("Mutex tryLock returns false when already locked", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const mutex = new Bun.Mutex();
      mutex.lock();
      const result = mutex.tryLock();
      console.log(result);
      mutex.unlock();
      `,
    ],
    env: bunEnv,
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`"false"`);
  expect(exitCode).toBe(0);
});

