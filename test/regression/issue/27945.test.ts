import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// Test that the bun test runner correctly handles non-native thenables
// (objects with a .then method that are not native Promises).
// Previously, bun would only check for native JSPromise objects, causing
// thenable rejections to be silently ignored and tests to incorrectly pass.

test("rejecting thenable should fail the test", async () => {
  using dir = tempDir("issue-27945", {
    "thenable.test.js": `
      const { test, expect } = require("bun:test");
      test("rejecting thenable", () => {
        return {
          then(resolve, reject) {
            reject(new Error("thenable rejected"));
          }
        };
      });
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "thenable.test.js"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(exitCode).not.toBe(0);
  expect(stderr).toContain("thenable rejected");
});

test("resolving thenable should pass the test and invoke .then", async () => {
  using dir = tempDir("issue-27945", {
    "thenable.test.js": `
      const { test, expect, afterAll } = require("bun:test");
      let thenCalled = false;
      test("resolving thenable", () => {
        return {
          then(resolve, reject) {
            thenCalled = true;
            resolve("ok");
          }
        };
      });
      afterAll(() => {
        expect(thenCalled).toBe(true);
      });
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "thenable.test.js"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(exitCode).toBe(0);
});

test("async resolving thenable should pass the test", async () => {
  using dir = tempDir("issue-27945", {
    "thenable.test.js": `
      const { test, expect, afterAll } = require("bun:test");
      let thenCalled = false;
      test("async resolving thenable", () => {
        return {
          then(resolve, reject) {
            Promise.resolve().then(() => {
              thenCalled = true;
              resolve("ok");
            });
          }
        };
      });
      afterAll(() => {
        expect(thenCalled).toBe(true);
      });
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "thenable.test.js"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(exitCode).toBe(0);
});

test("async rejecting thenable should fail the test", async () => {
  using dir = tempDir("issue-27945", {
    "thenable.test.js": `
      const { test, expect } = require("bun:test");
      test("async rejecting thenable", () => {
        return {
          then(resolve, reject) {
            Promise.resolve().then(() => reject(new Error("async thenable rejected")));
          }
        };
      });
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "thenable.test.js"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(exitCode).not.toBe(0);
  expect(stderr).toContain("async thenable rejected");
});

test("class-based thenable that rejects should fail", async () => {
  using dir = tempDir("issue-27945", {
    "thenable.test.js": `
      const { test, expect } = require("bun:test");

      class CustomThenable {
        then(resolve, reject) {
          reject(new Error("custom thenable rejected"));
        }
      }

      test("class-based thenable rejection", () => {
        return new CustomThenable();
      });
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "thenable.test.js"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(exitCode).not.toBe(0);
  expect(stderr).toContain("custom thenable rejected");
});

test("native promise rejection still works", async () => {
  using dir = tempDir("issue-27945", {
    "thenable.test.js": `
      const { test, expect } = require("bun:test");
      test("native promise rejection", () => {
        return Promise.reject(new Error("native promise rejected"));
      });
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "thenable.test.js"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(exitCode).not.toBe(0);
  expect(stderr).toContain("native promise rejected");
});
