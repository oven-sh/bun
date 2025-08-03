import { spawnSync } from "bun";
import { expect, test, describe } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "../../harness";

describe("issue #3440 - glob patterns as positional arguments", () => {
  test("should find files matching glob patterns", () => {
    const testDir = tempDirWithFiles("test-glob-positional", {
      "tests/unit/math.js": `
        import { test, expect } from "bun:test";
        test("math unit test", () => {
          expect(2 + 2).toBe(4);
        });
      `,
      "tests/integration/api.js": `
        import { test, expect } from "bun:test";
        test("api integration test", () => {
          expect(1 + 1).toBe(2);
        });
      `,
      "spec/components/button.spec.js": `
        import { test, expect } from "bun:test";
        test("button spec test", () => {
          expect(3 + 3).toBe(6);
        });
      `,
      "other/not-matched.js": `
        import { test, expect } from "bun:test";
        test("should not run", () => {
          expect(false).toBe(true); // This would fail if run
        });
      `,
    });

    // Test glob pattern that should find 2 files in tests/**/*.js
    const result = spawnSync({
      cmd: [bunExe(), "test", "tests/**/*.js"],
      cwd: testDir,
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });

    const stderr = result.stderr.toString();
    expect(result.exitCode).toBe(0);
    expect(stderr).toContain("2 pass");
    expect(stderr).toContain("Ran 2 tests across 2 files");
    // The glob pattern should only find files in tests/**/*.js
    // so it should NOT find button.spec.js or not-matched.js
  });

  test("should support multiple glob patterns", () => {
    const testDir = tempDirWithFiles("test-multiple-globs", {
      "unit/calculator.js": `
        import { test, expect } from "bun:test";
        test("calculator test", () => {
          expect(5 * 5).toBe(25);
        });
      `,
      "integration/database.js": `
        import { test, expect } from "bun:test";
        test("database test", () => {
          expect(10 / 2).toBe(5);
        });
      `,
      "specs/validation.spec.ts": `
        import { test, expect } from "bun:test";
        test("validation spec", () => {
          expect("hello".length).toBe(5);
        });
      `,
      "ignored/skip.js": `
        import { test, expect } from "bun:test";
        test("should be ignored", () => {
          expect(false).toBe(true); // Would fail if run
        });
      `,
    });

    // Test multiple glob patterns
    const result = spawnSync({
      cmd: [bunExe(), "test", "unit/**/*.js", "specs/**/*.spec.*"],
      cwd: testDir,
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });

    const stderr = result.stderr.toString();
    expect(result.exitCode).toBe(0);
    expect(stderr).toContain("2 pass");
    expect(stderr).toContain("Ran 2 tests across 2 files");
    // Multiple patterns should find unit/**/*.js and specs/**/*.spec.*
    // but NOT integration/database.js or ignored/skip.js
  });

  test("should support complex glob patterns with braces", () => {
    const testDir = tempDirWithFiles("test-complex-globs", {
      "src/utils.test.js": `
        import { test, expect } from "bun:test";
        test("utils test", () => {
          expect("test").toBeTruthy();
        });
      `,
      "src/helpers.spec.ts": `
        import { test, expect } from "bun:test";
        test("helpers spec", () => {
          expect("spec").toBeTruthy();
        });
      `,
      "src/main.js": `
        import { test, expect } from "bun:test";
        test("should be ignored", () => {
          expect(false).toBe(true); // Would fail if run
        });
      `,
    });

    // Test complex glob pattern with braces
    const result = spawnSync({
      cmd: [bunExe(), "test", "src/**/*.{test,spec}.*"],
      cwd: testDir,
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });

    const stderr = result.stderr.toString();
    expect(result.exitCode).toBe(0);
    expect(stderr).toContain("2 pass");  
    expect(stderr).toContain("Ran 2 tests across 2 files");
    // Brace pattern should find utils.test.js and helpers.spec.ts
    // but NOT main.js
  });

  test("should still work with traditional test file patterns", () => {
    const testDir = tempDirWithFiles("test-traditional", {
      "normal.test.js": `
        import { test, expect } from "bun:test";
        test("traditional test", () => {
          expect(42).toBe(42);
        });
      `,
      "another.spec.ts": `
        import { test, expect } from "bun:test";
        test("traditional spec", () => {
          expect("hello").toBe("hello");
        });
      `,
    });

    // Test without any arguments (should find traditional patterns)
    const result = spawnSync({
      cmd: [bunExe(), "test"],
      cwd: testDir,
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });

    const stderr = result.stderr.toString();
    expect(result.exitCode).toBe(0);
    expect(stderr).toContain("2 pass");
    expect(stderr).toContain("Ran 2 tests across 2 files");
    // Should find both traditional .test.js and .spec.ts files
  });

  test("should work with specific file paths (backward compatibility)", () => {
    const testDir = tempDirWithFiles("test-specific-files", {
      "custom/my-test.js": `
        import { test, expect } from "bun:test";
        test("specific file test", () => {
          expect("specific").toBe("specific");
        });
      `,
      "other/other-test.js": `
        import { test, expect } from "bun:test";
        test("should not run", () => {
          expect(false).toBe(true); // Would fail if run
        });
      `,
    });

    // Test with specific file path
    const result = spawnSync({
      cmd: [bunExe(), "test", "./custom/my-test.js"],
      cwd: testDir,
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });

    const stderr = result.stderr.toString();
    expect(result.exitCode).toBe(0);
    expect(stderr).toContain("1 pass");
    expect(stderr).toContain("Ran 1 test across 1 file");
    // Should only run the specific file, not other files
  });
});