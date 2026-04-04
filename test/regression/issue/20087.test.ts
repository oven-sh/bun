import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("test() calls inside setTimeout are collected", async () => {
  using dir = tempDir("issue-20087", {
    "setTimeout.test.ts": `
import { test } from "bun:test";

setTimeout(() => {
  test("test inside setTimeout", () => {
    console.log("hello from setTimeout");
  });
}, 100);
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "setTimeout.test.ts"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toContain("hello from setTimeout");
  expect(stderr).toContain("1 pass");
  expect(stderr).not.toContain("0 pass");
  expect(exitCode).toBe(0);
});

test("test() calls inside setTimeout with large delay are collected", async () => {
  using dir = tempDir("issue-20087-large-delay", {
    "setTimeout-large.test.ts": `
import { test } from "bun:test";

setTimeout(() => {
  test("test inside setTimeout 1000ms", () => {
    console.log("hello from 1000ms setTimeout");
  });
}, 1000);
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "setTimeout-large.test.ts"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toContain("hello from 1000ms setTimeout");
  expect(stderr).toContain("1 pass");
  expect(stderr).not.toContain("0 pass");
  expect(exitCode).toBe(0);
});

test("mixed sync and setTimeout test() calls are all collected", async () => {
  using dir = tempDir("issue-20087-mixed", {
    "mixed.test.ts": `
import { test } from "bun:test";

test("sync test", () => {
  console.log("sync");
});

setTimeout(() => {
  test("async test", () => {
    console.log("async");
  });
}, 100);
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "mixed.test.ts"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toContain("sync");
  expect(stdout).toContain("async");
  expect(stderr).toContain("2 pass");
  expect(stderr).not.toContain("0 pass");
  expect(exitCode).toBe(0);
});
