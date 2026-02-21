import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// https://github.com/oven-sh/bun/issues/6854
// "use client" / "use server" directives must be hoisted above auto-generated
// imports (e.g. JSX runtime) and must be preserved during minification.

test('"use client" appears before JSX runtime import in --no-bundle', async () => {
  using dir = tempDir("issue-6854", {
    "input.jsx": `"use client";\nexport function Button() { return <div>Click</div>; }`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "--no-bundle", "input.jsx"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toStartWith('"use client";\n');
  expect(exitCode).toBe(0);
});

test('"use server" appears before JSX runtime import in --no-bundle', async () => {
  using dir = tempDir("issue-6854", {
    "input.jsx": `"use server";\nexport function action() { return <div/>; }`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "--no-bundle", "input.jsx"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toStartWith('"use server";\n');
  expect(exitCode).toBe(0);
});

test('"use client" preserved with --minify', async () => {
  using dir = tempDir("issue-6854", {
    "input.js": `"use client";\nexport function Component() { return "hello"; }`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "--no-bundle", "--minify", "input.js"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toStartWith('"use client";');
  expect(exitCode).toBe(0);
});

test('"use client" preserved with --minify and JSX', async () => {
  using dir = tempDir("issue-6854", {
    "input.jsx": `"use client";\nexport function Button() { return <div>Click</div>; }`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "--no-bundle", "--minify", "input.jsx"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toStartWith('"use client";');
  expect(exitCode).toBe(0);
});

test('"use server" preserved with --minify', async () => {
  using dir = tempDir("issue-6854", {
    "input.js": `"use server";\nexport async function submitForm(data) { return data; }`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "--no-bundle", "--minify", "input.js"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toStartWith('"use server";');
  expect(exitCode).toBe(0);
});

test("directive without JSX still works in --no-bundle", async () => {
  using dir = tempDir("issue-6854", {
    "input.js": `"use client";\nexport function Component() { return "hello"; }`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "--no-bundle", "input.js"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toStartWith('"use client";\n');
  expect(exitCode).toBe(0);
});
