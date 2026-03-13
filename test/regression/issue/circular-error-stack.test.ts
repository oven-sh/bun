import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("error with circular stack reference should not cause infinite recursion", async () => {
  using dir = tempDir("circular-error-stack", {
    "index.js": `
      const error = new Error("Test error");
      error.stack = error;
      console.log(error);
      console.log("after error print");
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "index.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(exitCode).toBe(0);
  expect(stdout).toContain("after error print");
  expect(stdout).not.toContain("Maximum call stack");
  expect(stderr).not.toContain("Maximum call stack");
});

test("error with nested circular references should not cause infinite recursion", async () => {
  using dir = tempDir("nested-circular-error", {
    "index.js": `
      const error1 = new Error("Error 1");
      const error2 = new Error("Error 2");
      error1.stack = error2;
      error2.stack = error1;
      console.log(error1);
      console.log("after error print");
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "index.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(exitCode).toBe(0);
  expect(stdout).toContain("after error print");
  expect(stdout).not.toContain("Maximum call stack");
  expect(stderr).not.toContain("Maximum call stack");
});

test("error with circular reference in cause chain", async () => {
  using dir = tempDir("circular-error-cause", {
    "index.js": `
      const error1 = new Error("Error 1");
      const error2 = new Error("Error 2");
      error1.cause = error2;
      error2.cause = error1;
      console.log(error1);
      console.log("after error print");
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "index.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(exitCode).toBe(0);
  expect(stdout).toContain("after error print");
  expect(stdout).not.toContain("Maximum call stack");
  expect(stderr).not.toContain("Maximum call stack");
});
