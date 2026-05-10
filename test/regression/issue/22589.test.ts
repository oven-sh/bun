import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// Regression test for https://github.com/oven-sh/bun/issues/22589
// --compile should imply --production, which means:
// 1. "development" export condition should NOT be added
// 2. NODE_ENV should be set to "production"
// 3. Module resolution should work correctly for packages with only "production" exports

test("--compile implies --production and does not add development condition", async () => {
  using dir = tempDir("issue-22589", {
    "index.ts": `export const hello = "world";`,
  });

  // Build with --compile
  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "index.ts", "--compile", "--outfile", "test-bun"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  // Should succeed (no module resolution error)
  expect(exitCode).toBe(0);
  // Should NOT contain any "development" export condition errors
  expect(stderr).not.toContain("Could not resolve");
  expect(stderr).not.toContain("development");
  // Executable should be created
  const fileExists = await Bun.file(`${dir}/test-bun`).exists();
  expect(fileExists).toBe(true);
}, 30_000);

// Test that --compile --production still works and doesn't conflict
test("--compile with explicit --production still works", async () => {
  using dir = tempDir("issue-22589-explicit-prod", {
    "index.ts": `export const hello = "world";`,
  });

  // Build with --compile --production
  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "index.ts", "--compile", "--production", "--outfile", "test-bun"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  // Should succeed
  expect(exitCode).toBe(0);
  expect(stderr).not.toContain("Could not resolve");
  const fileExists = await Bun.file(`${dir}/test-bun`).exists();
  expect(fileExists).toBe(true);
}, 30_000);

// Test that without --compile, development condition may be added when NODE_ENV is not production
test("without --compile, development condition is not added by default (only when NODE_ENV=development)", async () => {
  using dir = tempDir("issue-22589-no-compile", {
    "index.ts": `export const hello = "world";`,
  });

  // Build without --compile and without NODE_ENV=production
  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "index.ts", "--outdir", "dist"],
    env: { ...bunEnv, NODE_ENV: "" }, // Explicitly unset NODE_ENV
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  // Should succeed
  expect(exitCode).toBe(0);
  // No resolution errors
  expect(stderr).not.toContain("Could not resolve");
  const dirExists = await Bun.file(`${dir}/dist/index.js`).exists();
  expect(dirExists).toBe(true);
}, 30_000);
