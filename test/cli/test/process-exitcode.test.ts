import { expect, test, describe } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// Tests for bun test exit codes per docs:
// https://bun.com/docs/test/runtime-behavior#exit-codes
//
// Exit codes:
// - 0: All tests passed, no unhandled errors
// - 1: Test failures occurred
// - >1: Number of unhandled errors (even if tests passed)
//
// Also tests that process.exitCode set inside tests does not leak into bun test's exit code.
// The test runner should determine exit code based on test outcomes, not user-set process.exitCode.

test("process.exitCode=1 at end of passing test does not affect bun test exit", async () => {
  using dir = tempDir("exitcode-leak", {
    "leak.test.ts": `
import { test, expect } from "bun:test";

test("passing test that sets process.exitCode=1", () => {
  expect(true).toBe(true);
  process.exitCode = 1; // Should not leak to bun test exit code
});
`,
  });

  const { exited, stdout, stderr } = Bun.spawn({
    cmd: [bunExe(), "test", "leak.test.ts"],
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
    env: bunEnv,
  });

  const [out, err, exitCode] = await Promise.all([stdout.text(), stderr.text(), exited]);

  expect(err).toContain("1 pass");
  expect(err).toContain("0 fail");
  expect(exitCode).toBe(0);
});

test("process.exitCode set to various values in passing tests does not affect exit", async () => {
  using dir = tempDir("exitcode-various", {
    "various.test.ts": `
import { test, expect } from "bun:test";

test("sets exitCode to 42", () => {
  expect(1).toBe(1);
  process.exitCode = 42;
});

test("sets exitCode to 255", () => {
  expect(2).toBe(2);
  process.exitCode = 255;
});

test("sets exitCode to 1", () => {
  expect(3).toBe(3);
  process.exitCode = 1;
});
`,
  });

  const { exited, stderr } = Bun.spawn({
    cmd: [bunExe(), "test", "various.test.ts"],
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
    env: bunEnv,
  });

  const [err, exitCode] = await Promise.all([stderr.text(), exited]);

  expect(err).toContain("3 pass");
  expect(err).toContain("0 fail");
  expect(exitCode).toBe(0);
});

test("afterEach setting process.exitCode does not affect bun test exit", async () => {
  using dir = tempDir("exitcode-aftereach", {
    "aftereach.test.ts": `
import { test, expect, afterEach } from "bun:test";

afterEach(() => {
  process.exitCode = 1; // Cleanup setting exitCode should not leak
});

test("first test", () => {
  expect(true).toBe(true);
});

test("second test", () => {
  expect(true).toBe(true);
});
`,
  });

  const { exited, stderr } = Bun.spawn({
    cmd: [bunExe(), "test", "aftereach.test.ts"],
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
    env: bunEnv,
  });

  const [err, exitCode] = await Promise.all([stderr.text(), exited]);

  expect(err).toContain("2 pass");
  expect(err).toContain("0 fail");
  expect(exitCode).toBe(0);
});

// Positive tests: verify documented exit code behavior

describe("documented exit codes", () => {
  test("exits 0 when all tests pass", async () => {
    using dir = tempDir("exitcode-pass", {
      "pass.test.ts": `
import { test, expect } from "bun:test";

test("passes", () => {
  expect(1 + 1).toBe(2);
});

test("also passes", () => {
  expect("hello").toContain("ell");
});
`,
    });

    const { exited, stderr } = Bun.spawn({
      cmd: [bunExe(), "test", "pass.test.ts"],
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
      stdin: "ignore",
      env: bunEnv,
    });

    const [err, exitCode] = await Promise.all([stderr.text(), exited]);

    expect(err).toContain("2 pass");
    expect(err).toContain("0 fail");
    expect(exitCode).toBe(0);
  });

  test("exits 1 when test failures occur", async () => {
    using dir = tempDir("exitcode-fail", {
      "fail.test.ts": `
import { test, expect } from "bun:test";

test("passes", () => {
  expect(true).toBe(true);
});

test("fails", () => {
  expect(1).toBe(2);
});
`,
    });

    const { exited, stderr } = Bun.spawn({
      cmd: [bunExe(), "test", "fail.test.ts"],
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
      stdin: "ignore",
      env: bunEnv,
    });

    const [err, exitCode] = await Promise.all([stderr.text(), exited]);

    expect(err).toContain("1 pass");
    expect(err).toContain("1 fail");
    expect(exitCode).toBe(1);
  });

  test("exits 1 when multiple test failures occur", async () => {
    using dir = tempDir("exitcode-multifail", {
      "multifail.test.ts": `
import { test, expect } from "bun:test";

test("fails 1", () => {
  expect(1).toBe(2);
});

test("fails 2", () => {
  expect("a").toBe("b");
});

test("fails 3", () => {
  throw new Error("oops");
});
`,
    });

    const { exited, stderr } = Bun.spawn({
      cmd: [bunExe(), "test", "multifail.test.ts"],
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
      stdin: "ignore",
      env: bunEnv,
    });

    const [err, exitCode] = await Promise.all([stderr.text(), exited]);

    expect(err).toContain("0 pass");
    expect(err).toContain("3 fail");
    expect(exitCode).toBe(1);
  });

  test("exits non-zero for unhandled errors between tests", async () => {
    using dir = tempDir("exitcode-unhandled", {
      "unhandled.test.ts": `
import { test, expect } from "bun:test";

test("test 1 passes", async () => {
  expect(true).toBe(true);
  // Schedule an unhandled error to fire after this test completes
  setTimeout(() => {
    throw new Error("Unhandled error between tests");
  }, 10);
});

test("test 2 passes", async () => {
  // Give time for the scheduled error to fire between tests
  await Bun.sleep(50);
  expect(true).toBe(true);
});
`,
    });

    const { exited, stderr } = Bun.spawn({
      cmd: [bunExe(), "test", "unhandled.test.ts"],
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
      stdin: "ignore",
      env: bunEnv,
    });

    const [err, exitCode] = await Promise.all([stderr.text(), exited]);

    // Exit code should be > 0 due to unhandled error
    expect(exitCode).toBeGreaterThan(0);
    expect(err).toContain("Unhandled error");
  });
});
