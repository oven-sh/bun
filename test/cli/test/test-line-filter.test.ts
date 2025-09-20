import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

describe("test line filtering", () => {
  test("runs specific test by line number", async () => {
    using dir = tempDir("test-line-filter", {
      "test.test.ts": `
import { test, expect } from "bun:test";

test("test 1 - should NOT run", () => {
  console.log("❌ Test 1 ran - this should not happen!");
  expect.unreachable("Test 1 should not run");
});

test("target test - SHOULD run", () => {
  console.log("✅ Target test ran on line 8");
  expect(2).toBe(2);
});

test("test 3 - should NOT run", () => {
  console.log("❌ Test 3 ran - this should not happen!");
  expect.unreachable("Test 3 should not run");
});
`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "test.test.ts:8"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("✅ Target test ran on line 8");
    expect(stdout).not.toContain("❌ Test 1 ran");
    expect(stdout).not.toContain("❌ Test 3 ran");
    expect(stdout).toMatch(/1 pass/);
  });

  test("runs tests in describe block by line number", async () => {
    using dir = tempDir("test-line-filter-describe", {
      "test.test.ts": `
import { test, expect, describe } from "bun:test";

describe("outer", () => {
  test("outer test 1", () => {
    console.log("❌ Outer 1 should not run");
    expect.unreachable();
  });

  describe("nested group", () => {
    test("nested test 1", () => {
      console.log("❌ Nested 1 should not run");
      expect.unreachable();
    });

    test("nested target", () => {
      console.log("✅ Nested target on line 16");
      expect(true).toBe(true);
    });

    test("nested test 3", () => {
      console.log("❌ Nested 3 should not run");
      expect.unreachable();
    });
  });
});
`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "test.test.ts:9"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(exitCode).toBe(0);
    // When targeting describe block, all tests within should run
    expect(stdout).not.toContain("❌ Outer 1");
    expect(stdout).toContain("✅ Nested target");
    expect(stdout).toMatch(/\d+ pass/);
  });

  test("handles multiple file:line arguments", async () => {
    using dir = tempDir("test-line-filter-multi", {
      "test.test.ts": `
import { test, expect } from "bun:test";

test("test 1", () => {
  console.log("✅ Test 1 on line 3");
  expect(1).toBe(1);
});

test("test 2", () => {
  console.log("❌ Test 2 should not run");
  expect.unreachable();
});

test("test 3", () => {
  console.log("✅ Test 3 on line 13");
  expect(3).toBe(3);
});
`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "test.test.ts:3", "test.test.ts:13"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("✅ Test 1 on line 3");
    expect(stdout).not.toContain("❌ Test 2 should not run");
    expect(stdout).toContain("✅ Test 3 on line 13");
    expect(stdout).toMatch(/2 pass/);
  });

  test("handles file:line:column syntax (ignores column)", async () => {
    using dir = tempDir("test-line-filter-column", {
      "test.test.ts": `
import { test, expect } from "bun:test";

test("test 1", () => {
  console.log("❌ Test 1 should not run");
  expect.unreachable();
});

test("target test", () => {
  console.log("✅ Target test on line 8");
  expect(2).toBe(2);
});
`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "test.test.ts:8:15"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("✅ Target test on line 8");
    expect(stdout).not.toContain("❌ Test 1 should not run");
    expect(stdout).toMatch(/1 pass/);
  });

  test("works with test.each", async () => {
    using dir = tempDir("test-line-filter-each", {
      "test.test.ts": `
import { test, expect } from "bun:test";

test("normal test", () => {
  console.log("❌ Normal test should not run");
  expect.unreachable();
});

test.each([[1, 2, 3], [4, 5, 9]])("adds %i + %i = %i", (a, b, expected) => {
  console.log(\`✅ Testing \${a} + \${b} = \${expected}\`);
  expect(a + b).toBe(expected);
});

test("another test", () => {
  console.log("❌ Another test should not run");
  expect.unreachable();
});
`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "test.test.ts:8"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("✅ Testing");
    expect(stdout).not.toContain("❌ Normal test");
    expect(stdout).not.toContain("❌ Another test");
    // Should run all iterations of test.each
    expect(stdout).toMatch(/2 pass/);
  });
});
