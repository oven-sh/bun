import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// Regression test for https://github.com/oven-sh/bun/issues/26460
// Using $`...`.cwd(".") should work and use the current working directory

test("shell cwd('.') should use current working directory", async () => {
  using dir = tempDir("shell-cwd-dot", {
    "test.js": `
      import { $ } from "bun";
      const result = await $\`pwd\`.cwd(".").text();
      console.log(result.trim());
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(stdout.trim()).toBe(String(dir));
  expect(exitCode).toBe(0);
});

test("shell cwd('') should use current working directory", async () => {
  using dir = tempDir("shell-cwd-empty", {
    "test.js": `
      import { $ } from "bun";
      const result = await $\`pwd\`.cwd("").text();
      console.log(result.trim());
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(stdout.trim()).toBe(String(dir));
  expect(exitCode).toBe(0);
});

test("shell cwd('./') should use current working directory", async () => {
  using dir = tempDir("shell-cwd-dotslash", {
    "test.js": `
      import { $ } from "bun";
      const result = await $\`pwd\`.cwd("./").text();
      console.log(result.trim());
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(stdout.trim()).toBe(String(dir));
  expect(exitCode).toBe(0);
});

test("Shell prototype cwd('.') should use current working directory", async () => {
  using dir = tempDir("shell-proto-cwd-dot", {
    "test.js": `
      import { $ } from "bun";
      const shell = new $.Shell();
      shell.cwd(".");
      const result = await shell\`pwd\`.text();
      console.log(result.trim());
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(stdout.trim()).toBe(String(dir));
  expect(exitCode).toBe(0);
});
