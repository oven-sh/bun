import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("error.stack getter that throws should not crash", async () => {
  using dir = tempDir("throwing-stack-getter", {
    "index.js": `
      const error = new Error("Test error");
      Object.defineProperty(error, "stack", {
        get() {
          throw new Error("Stack getter throws!");
        }
      });
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
  expect(stdout).not.toContain("Stack getter throws");
  expect(stderr).not.toContain("Stack getter throws");
});

test("error.stack getter returning circular reference", async () => {
  using dir = tempDir("circular-stack-getter", {
    "index.js": `
      const error = new Error("Test error");
      Object.defineProperty(error, "stack", {
        get() {
          return error; // Return the error itself
        }
      });
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

test("error with multiple throwing getters", async () => {
  using dir = tempDir("multiple-throwing-getters", {
    "index.js": `
      const error = new Error("Test error");
      Object.defineProperty(error, "stack", {
        get() {
          throw new Error("Stack throws!");
        }
      });
      Object.defineProperty(error, "cause", {
        get() {
          throw new Error("Cause throws!");
        }
      });
      error.normalProp = "works";
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
  expect(stdout).toContain("normalProp");
  expect(stdout).not.toContain("Stack throws");
  expect(stdout).not.toContain("Cause throws");
});
