import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("ESM import with percent-encoded comma (%2c) resolves correctly", async () => {
  using dir = tempDir("issue-28745", {
    "test.mjs": `import './foo%2cbar.mjs';`,
    "foo,bar.mjs": `console.log('comma works');`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "run", "test.mjs"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toBe("comma works\n");
  expect(exitCode).toBe(0);
});

test("ESM import with percent-encoded space (%20) resolves correctly", async () => {
  using dir = tempDir("issue-28745", {
    "test.mjs": `import './foo%20bar.mjs';`,
    "foo bar.mjs": `console.log('space works');`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "run", "test.mjs"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toBe("space works\n");
  expect(exitCode).toBe(0);
});

test("ESM import with percent-encoded hash (%23) resolves correctly", async () => {
  using dir = tempDir("issue-28745", {
    "test.mjs": `import './foo%23bar.mjs';`,
    "foo#bar.mjs": `console.log('hash works');`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "run", "test.mjs"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toBe("hash works\n");
  expect(exitCode).toBe(0);
});

test("ESM import with encoded slash (%2f) is rejected per spec", async () => {
  using dir = tempDir("issue-28745", {
    "test.mjs": `import './sub%2fmod.mjs';`,
    "sub/mod.mjs": `console.log('should not load');`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "run", "test.mjs"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(exitCode).not.toBe(0);
  expect(stderr).toContain("Cannot find module");
});

test("CJS require does not percent-decode specifiers", async () => {
  using dir = tempDir("issue-28745", {
    "test.cjs": `require('./foo%2cbar.cjs');`,
    "foo%2cbar.cjs": `console.log('literal name works');`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "run", "test.cjs"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toBe("literal name works\n");
  expect(exitCode).toBe(0);
});

test("ESM dynamic import() with percent-encoded characters resolves correctly", async () => {
  using dir = tempDir("issue-28745", {
    "test.mjs": `const m = await import('./foo%2cbar.mjs'); console.log(m.value);`,
    "foo,bar.mjs": `export const value = 'dynamic comma works';`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "run", "test.mjs"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toBe("dynamic comma works\n");
  expect(exitCode).toBe(0);
});
