import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("process.emitWarning without --trace-warnings shows minimal format", async () => {
  using dir = tempDir("trace-warnings-test", {
    "test.js": `process.emitWarning('test warning');`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test.js"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });

  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

  // Should show minimal format with PID
  expect(stderr).toMatch(/\(bun:\d+\) Warning: test warning/);
  // Should show the hint about --trace-warnings
  expect(stderr).toContain("(Use `bun --trace-warnings ...` to show where the warning was created)");
  // Should NOT show stack trace
  expect(stderr).not.toContain("at ");

  expect(exitCode).toBe(0);
});

test("process.emitWarning with --trace-warnings shows stack trace", async () => {
  using dir = tempDir("trace-warnings-test", {
    "test.js": `process.emitWarning('test warning');`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "--trace-warnings", "test.js"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });

  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

  // Should show minimal format with PID
  expect(stderr).toMatch(/\(bun:\d+\) Warning: test warning/);
  // Should show stack trace
  expect(stderr).toContain("at ");
  // Should NOT show the hint when --trace-warnings is used
  expect(stderr).not.toContain("(Use `bun --trace-warnings ...` to show where the warning was created)");

  expect(exitCode).toBe(0);
});

test("process.emitWarning with custom type", async () => {
  using dir = tempDir("trace-warnings-test", {
    "test.js": `process.emitWarning('custom message', 'CustomWarning');`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test.js"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });

  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

  // Should show custom warning type
  expect(stderr).toMatch(/\(bun:\d+\) CustomWarning: custom message/);

  expect(exitCode).toBe(0);
});

test("multiple warnings show hint only once", async () => {
  using dir = tempDir("trace-warnings-test", {
    "test.js": `
      process.emitWarning('warning 1');
      process.emitWarning('warning 2');
      process.emitWarning('warning 3');
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test.js"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });

  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

  // Should show all three warnings
  expect(stderr).toContain("Warning: warning 1");
  expect(stderr).toContain("Warning: warning 2");
  expect(stderr).toContain("Warning: warning 3");

  // Should show the hint only once
  const hintCount = (stderr.match(/Use `bun --trace-warnings/g) || []).length;
  expect(hintCount).toBe(1);

  expect(exitCode).toBe(0);
});

test("DeprecationWarning is shown by default", async () => {
  using dir = tempDir("trace-warnings-test", {
    "test.js": `process.emitWarning('deprecated API', 'DeprecationWarning');`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test.js"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });

  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

  expect(stderr).toMatch(/\(bun:\d+\) DeprecationWarning: deprecated API/);

  expect(exitCode).toBe(0);
});

test("NODE_NO_WARNINGS=1 suppresses warnings", async () => {
  using dir = tempDir("trace-warnings-test", {
    "test.js": `process.emitWarning('test warning');`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test.js"],
    env: { ...bunEnv, NODE_NO_WARNINGS: "1" },
    cwd: String(dir),
    stderr: "pipe",
  });

  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

  // Should NOT show any warning
  expect(stderr).not.toContain("Warning:");
  expect(stderr).not.toContain("test warning");

  expect(exitCode).toBe(0);
});

test("process.emitWarning with code and detail", async () => {
  using dir = tempDir("trace-warnings-test", {
    "test.js": `
      process.emitWarning('test warning', {
        type: 'CustomWarning',
        code: 'CODE001',
        detail: 'Additional details here'
      });
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test.js"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });

  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

  expect(stderr).toMatch(/\(bun:\d+\) CustomWarning: test warning/);

  expect(exitCode).toBe(0);
});
