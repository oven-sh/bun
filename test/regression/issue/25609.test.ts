// Regression test for https://github.com/oven-sh/bun/issues/25609
// Files that mix ESM imports with CJS exports should throw a proper error,
// not crash with "Expected CommonJS module to have a function wrapper".

import { expect, test } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot, tempDir } from "harness";

test("dynamic import of mixed ESM/CJS file should throw proper error", async () => {
  // Create temp directory with test files
  using dir = tempDir("issue-25609", {
    // This file dynamically imports b.ts - await it so unhandled rejection shows the error
    "a.ts": `await import("./b.ts");`,
    // This file mixes ESM imports with CJS exports - this is invalid
    "b.ts": `import { foo } from "./c.ts";
module.exports = { foo };`,
    // A simple ESM module
    "c.ts": `export const foo = "bar";`,
  });

  // Spawn Bun process
  await using proc = Bun.spawn({
    cmd: [bunExe(), "a.ts"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // Should show the proper error about mixing ESM/CJS
  expect(normalizeBunSnapshot(stderr)).toContain("Cannot use import statement with CommonJS-only features");

  // Should NOT show the confusing "function wrapper" error
  expect(stderr).not.toContain("Expected CommonJS module to have a function wrapper");

  // Exit code should be 1
  expect(exitCode).toBe(1);
});

test("static import of mixed ESM/CJS file should throw proper error", async () => {
  // Create temp directory with test files
  using dir = tempDir("issue-25609-static", {
    // This file statically imports b.ts
    "a.ts": `import b from "./b.ts"; console.log(b);`,
    // This file mixes ESM imports with CJS exports - this is invalid
    "b.ts": `import { foo } from "./c.ts";
module.exports = { foo };`,
    // A simple ESM module
    "c.ts": `export const foo = "bar";`,
  });

  // Spawn Bun process
  await using proc = Bun.spawn({
    cmd: [bunExe(), "a.ts"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // Should show the proper error about mixing ESM/CJS
  expect(normalizeBunSnapshot(stderr)).toContain("Cannot use import statement with CommonJS-only features");

  // Should NOT show the confusing "function wrapper" error
  expect(stderr).not.toContain("Expected CommonJS module to have a function wrapper");

  // Exit code should be 1
  expect(exitCode).toBe(1);
});

test("pure CJS file works with dynamic import", async () => {
  // Create temp directory with test files
  using dir = tempDir("issue-25609-pure-cjs", {
    // This file dynamically imports b.ts
    "a.ts": `import("./b.ts").then(m => { console.log("Loaded:", m.default.foo); });`,
    // This file uses pure CJS - this should work
    "b.ts": `const c = require("./c.ts");
module.exports = { foo: c.foo };`,
    // A simple CJS module
    "c.ts": `exports.foo = "bar";`,
  });

  // Spawn Bun process
  await using proc = Bun.spawn({
    cmd: [bunExe(), "a.ts"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // Should work without errors
  expect(normalizeBunSnapshot(stdout)).toContain("Loaded: bar");
  expect(exitCode).toBe(0);
});
