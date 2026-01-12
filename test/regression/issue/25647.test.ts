import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// https://github.com/oven-sh/bun/issues/25647
describe("issue #25647: bun test --config= should support section names", () => {
  test("--config=ci should load [test.ci] section from bunfig.toml", async () => {
    using dir = tempDir("test-25647", {
      "bunfig.toml": `
[test]
timeout = 5000

[test.ci]
timeout = 30000
`,
      "example.test.ts": `
import { test, expect } from "bun:test";

test("check timeout from conditional config", () => {
  // The test runner reads the timeout from config
  // We can't directly check the timeout value, but we can verify
  // the config was loaded successfully by running the test
  expect(1).toBe(1);
});
`,
    });

    // Run with --config=ci (section name, not file path)
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "--config=ci", "example.test.ts"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });

    const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // Should NOT get ENOENT error trying to open "ci" as a file
    expect(stderr).not.toContain("ENOENT");
    expect(stderr).not.toContain("No such file or directory");

    // Test should pass (1 pass, 0 fail). Results are printed to stderr.
    expect(stderr).toContain("1 pass");
    expect(exitCode).toBe(0);
  });

  test("--config=staging should load [test.staging] section", async () => {
    using dir = tempDir("test-25647-staging", {
      "bunfig.toml": `
[test]
timeout = 1000

[test.staging]
timeout = 60000
`,
      "example.test.ts": `
import { test, expect } from "bun:test";

test("staging config test", () => {
  expect(true).toBe(true);
});
`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "--config=staging", "example.test.ts"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });

    const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).not.toContain("ENOENT");
    expect(exitCode).toBe(0);
  });

  test("--config=./bunfig.toml should still work as a file path", async () => {
    using dir = tempDir("test-25647-filepath", {
      "bunfig.toml": `
[test]
timeout = 5000
`,
      "example.test.ts": `
import { test, expect } from "bun:test";

test("file path config test", () => {
  expect(true).toBe(true);
});
`,
    });

    // Pass an explicit file path (with ./)
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "--config=./bunfig.toml", "example.test.ts"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });

    const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(exitCode).toBe(0);
  });

  test("--config=custom.toml should work as a file path", async () => {
    using dir = tempDir("test-25647-custom", {
      "custom.toml": `
[test]
timeout = 5000
`,
      "example.test.ts": `
import { test, expect } from "bun:test";

test("custom file config test", () => {
  expect(true).toBe(true);
});
`,
    });

    // Pass a .toml file (should be treated as file path)
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "--config=custom.toml", "example.test.ts"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });

    const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(exitCode).toBe(0);
  });

  test("--config=nonexistent (section that doesn't exist) should still work", async () => {
    using dir = tempDir("test-25647-nonexistent", {
      "bunfig.toml": `
[test]
timeout = 5000
`,
      "example.test.ts": `
import { test, expect } from "bun:test";

test("test with missing conditional section", () => {
  expect(true).toBe(true);
});
`,
    });

    // Pass a section name that doesn't exist - should still load base [test] and not error
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "--config=nonexistent", "example.test.ts"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });

    const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // Should NOT get ENOENT error
    expect(stderr).not.toContain("ENOENT");
    expect(exitCode).toBe(0);
  });
});
