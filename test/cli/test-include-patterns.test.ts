import { describe, test, expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

describe.concurrent("test.include configuration", () => {
  test("custom include pattern matches files", async () => {
    using dir = tempDir("test-include-basic", {
      "bunfig.toml": `
[test]
include = ["**/*.unit.ts"]
`,
      "math.unit.ts": `
import { test, expect } from "bun:test";
test("addition", () => {
  expect(1 + 1).toBe(2);
});
`,
      // This file should NOT be found (doesn't match pattern)
      "helper.ts": `
export const add = (a: number, b: number) => a + b;
`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    const output = stdout + stderr;
    expect(output).toContain("1 pass");
    expect(output).toContain("math.unit.ts");
    expect(exitCode).toBe(0);
  });

  test("multiple include patterns work", async () => {
    using dir = tempDir("test-include-multi", {
      "bunfig.toml": `
[test]
include = ["**/*.unit.ts", "**/*.int.ts"]
`,
      "math.unit.ts": `
import { test, expect } from "bun:test";
test("unit test", () => {
  expect(true).toBe(true);
});
`,
      "api.int.ts": `
import { test, expect } from "bun:test";
test("integration test", () => {
  expect(true).toBe(true);
});
`,
      // This file should NOT be found
      "math.test.ts": `
import { test, expect } from "bun:test";
test("should not run", () => {
  expect(true).toBe(false);
});
`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    const output = stdout + stderr;
    expect(output).toContain("2 pass");
    expect(output).toContain("math.unit.ts");
    expect(output).toContain("api.int.ts");
    // Should NOT contain math.test.ts since custom patterns override defaults
    expect(output).not.toContain("math.test.ts");
    expect(exitCode).toBe(0);
  });

  test("single include pattern as string works", async () => {
    using dir = tempDir("test-include-string", {
      "bunfig.toml": `
[test]
include = "**/*.e2e.ts"
`,
      "login.e2e.ts": `
import { test, expect } from "bun:test";
test("e2e test", () => {
  expect(true).toBe(true);
});
`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    const output = stdout + stderr;
    expect(output).toContain("1 pass");
    expect(output).toContain("login.e2e.ts");
    expect(exitCode).toBe(0);
  });

  test("empty include pattern produces error", async () => {
    using dir = tempDir("test-include-empty", {
      "bunfig.toml": `
[test]
include = ""
`,
      "test.test.ts": `
import { test, expect } from "bun:test";
test("dummy", () => {});
`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    const output = stdout + stderr;
    expect(output).toContain("empty");
    expect(exitCode).not.toBe(0);
  });

  test("empty include array produces error", async () => {
    using dir = tempDir("test-include-empty-array", {
      "bunfig.toml": `
[test]
include = []
`,
      "test.test.ts": `
import { test, expect } from "bun:test";
test("dummy", () => {});
`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    const output = stdout + stderr;
    expect(output).toContain("empty");
    expect(exitCode).not.toBe(0);
  });

  test("include pattern in subdirectory", async () => {
    using dir = tempDir("test-include-subdir", {
      "bunfig.toml": `
[test]
include = ["tests/**/*.spec.ts"]
`,
      "tests/unit/math.spec.ts": `
import { test, expect } from "bun:test";
test("math spec", () => {
  expect(2 + 2).toBe(4);
});
`,
      "tests/integration/api.spec.ts": `
import { test, expect } from "bun:test";
test("api spec", () => {
  expect(true).toBe(true);
});
`,
      // This should NOT be found (not in tests/ directory)
      "src/helper.spec.ts": `
import { test, expect } from "bun:test";
test("should not run", () => {
  expect(true).toBe(false);
});
`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    const output = stdout + stderr;
    expect(output).toContain("2 pass");
    expect(output).toContain("math.spec.ts");
    expect(output).toContain("api.spec.ts");
    expect(output).not.toContain("helper.spec.ts");
    expect(exitCode).toBe(0);
  });

  test("no tests found message with custom include", async () => {
    using dir = tempDir("test-include-no-match", {
      "bunfig.toml": `
[test]
include = ["**/*.nonexistent.ts"]
`,
      "math.test.ts": `
import { test, expect } from "bun:test";
test("dummy", () => {});
`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    const output = stdout + stderr;
    expect(output).toContain("No tests found");
    expect(output).toContain("custom include patterns");
    expect(exitCode).toBe(1);
  });
});
