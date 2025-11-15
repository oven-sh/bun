import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("bun stats - basic functionality", async () => {
  using dir = tempDir("stats-test", {
    "index.js": `console.log("hello");`,
    "utils.mjs": `export const add = (a, b) => a + b;`,
    "config.json": `{"name": "test"}`,
    "styles.css": `body { color: red; }`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "stats"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(exitCode).toBe(0);
  expect(stderr).toBe("");

  // Check that the output contains expected sections
  expect(stdout).toContain("JavaScript");
  expect(stdout).toContain("ES modules");
  expect(stdout).toContain("CSS");
  expect(stdout).toContain("JSON");
  expect(stdout).toContain("Total");
  expect(stdout).toContain("Code LOC:");
  expect(stdout).toContain("Bundled Size (est.):");
});

test("bun stats - with TypeScript files", async () => {
  using dir = tempDir("stats-ts-test", {
    "index.ts": `const msg: string = "hello";\nconsole.log(msg);`,
    "types.d.ts": `export interface User { name: string; }`,
    "test.spec.ts": `import { test } from "bun:test";\ntest("sample", () => {});`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "stats"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(exitCode).toBe(0);
  expect(stderr).toBe("");

  // Check TypeScript stats
  expect(stdout).toContain("TypeScript");
  expect(stdout).toContain("Tests");
  expect(stdout).toContain("Test LOC:");
});

test("bun stats - handles CommonJS and ES modules", async () => {
  using dir = tempDir("stats-modules-test", {
    "cjs-module.js": `module.exports = { foo: 'bar' };`,
    "esm-module.mjs": `export default { foo: 'bar' };`,
    "mixed.js": `const lib = require('./lib');\nexport { lib };`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "stats"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(exitCode).toBe(0);
  expect(stderr).toBe("");

  // Check module type detection
  expect(stdout).toContain("CommonJS modules");
  expect(stdout).toContain("ES modules");
});

test("bun stats - counts imports and exports", async () => {
  using dir = tempDir("stats-imports-test", {
    "module.js": `
      import React from 'react';
      import { useState } from 'react';
      import './styles.css';
      
      export default App;
      export { helper };
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "stats"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout] = await Promise.all([proc.stdout.text(), proc.exited]);

  // Should count imports and exports - check the table contains expected values
  expect(stdout).toContain("|       3 |       2 |");
});

test("bun stats --help", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "stats", "--help"],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(exitCode).toBe(0);
  expect(stderr).toBe("");
  expect(stdout).toContain("Usage:");
  expect(stdout).toContain("bun stats");
  expect(stdout).toContain("Generate a comprehensive code statistics report");
});
