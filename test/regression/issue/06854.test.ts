import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// https://github.com/oven-sh/bun/issues/6854
// "use client"/"use server" directives must stay at the top of the output,
// ahead of auto-injected JSX runtime imports and bundler runtime helpers.

test.concurrent('"use client" stays above the JSX runtime import in --no-bundle', async () => {
  using dir = tempDir("issue-6854-nobundle", {
    "input.jsx": `"use client";\nexport function Button() { return <div>Click</div>; }`,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "--no-bundle", "input.jsx"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout).toStartWith('"use client";\n');
  expect(stdout.indexOf('"use client"')).toBeLessThan(stdout.indexOf("react/jsx"));
  expect(exitCode).toBe(0);
});

test.concurrent('"use client" stays above the JSX runtime import with --no-bundle --minify', async () => {
  using dir = tempDir("issue-6854-nobundle-min", {
    "input.jsx": `"use client";\nexport function Button() { return <div>Click</div>; }`,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "--no-bundle", "--minify", "input.jsx"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout).toStartWith('"use client";');
  expect(exitCode).toBe(0);
});

test.concurrent('"use client" is hoisted above bundler runtime helpers', async () => {
  using dir = tempDir("issue-6854-bundle", {
    "entry.tsx": `"use client";\nconst mod = require("./cjs.cjs");\nexport function C() { return <div>{mod.x}</div>; }`,
    "cjs.cjs": `module.exports = { x: 42 };`,
  });
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "build",
      "entry.tsx",
      "--external",
      "react",
      "--external",
      "react/jsx-dev-runtime",
      "--external",
      "react/jsx-runtime",
    ],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout).toStartWith('"use client";\n');
  expect(stdout.indexOf('"use client"')).toBeLessThan(stdout.indexOf("__commonJS"));
  expect(exitCode).toBe(0);
});
