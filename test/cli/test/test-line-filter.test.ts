import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tmpdirSync } from "harness";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

describe("bun test file:line filtering", () => {
  function createTestFile(cwd: string, filename: string, content: string): string {
    const path = join(cwd, filename);
    writeFileSync(path, content);
    return path;
  }

  async function runTestWithOutput(args: string[], cwd?: string) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", ...args],
      env: bunEnv,
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;
    return { stdout, stderr, exitCode };
  }

  // Standard test content used across multiple tests
  const standardTestContent = `import { test, expect } from "bun:test";

test("test 1 - should NOT run", () => {
  console.log("❌ Test 1 ran");
  expect(1).toBe(1);
});

test("target test - SHOULD run", () => {
  console.log("✅ Target test ran");
  expect(2).toBe(2);
});

test("test 3 - should NOT run", () => {
  console.log("❌ Test 3 ran");
  expect(3).toBe(3);
});`;

  const describeTestContent = `import { test, expect, describe } from "bun:test";

test("standalone - should NOT run", () => {
  console.log("❌ Standalone test ran");
  expect(1).toBe(1);
});

describe("target block", () => {
  test("test A - SHOULD run", () => {
    console.log("✅ Test A ran");
    expect(2).toBe(2);
  });

  test("test B - SHOULD run", () => {
    console.log("✅ Test B ran");
    expect(3).toBe(3);
  });
});

describe("other block", () => {
  test("test C - should NOT run", () => {
    console.log("❌ Test C ran");
    expect(4).toBe(4);
  });
});`;

  test("should run only the test on the specified line", async () => {
    const cwd = tmpdirSync();
    const testFile = createTestFile(cwd, "single-test.test.ts", standardTestContent);

    const { stdout, stderr, exitCode } = await runTestWithOutput([`./single-test.test.ts:8`], cwd);

    expect(stdout).toContain("✅ Target test ran");
    expect(stdout).not.toContain("❌ Test 1 ran");
    expect(stdout).not.toContain("❌ Test 3 ran");
    expect(stderr).toContain("1 pass");
    expect(stderr).toContain("2 filtered out");
    expect(exitCode).toBe(0);
  });

  test("should run all tests in a describe block when targeting the describe line", async () => {
    const cwd = tmpdirSync();
    const testFile = createTestFile(cwd, "describe-block.test.ts", describeTestContent);

    const { stdout, stderr, exitCode } = await runTestWithOutput([`./describe-block.test.ts:8`], cwd);

    expect(stdout).toContain("✅ Test A ran");
    expect(stdout).toContain("✅ Test B ran");
    expect(stdout).not.toContain("❌ Standalone test ran");
    expect(stdout).not.toContain("❌ Test C ran");
    expect(stderr).toContain("2 pass");
    expect(stderr).toContain("2 filtered out");
    expect(exitCode).toBe(0);
  });

  test("should handle nested describe blocks correctly", async () => {
    const cwd = tmpdirSync();
    const testFile = createTestFile(
      cwd,
      "nested-describe.test.ts",
      `import { test, expect, describe } from "bun:test";

describe("outer", () => {
  test("outer test - should NOT run", () => {
    console.log("❌ Outer test ran");
    expect(1).toBe(1);
  });

  describe("inner target", () => {
    test("inner test A - SHOULD run", () => {
      console.log("✅ Inner test A ran");
      expect(2).toBe(2);
    });

    test("inner test B - SHOULD run", () => {
      console.log("✅ Inner test B ran");
      expect(3).toBe(3);
    });
  });

  test("another outer test - should NOT run", () => {
    console.log("❌ Another outer test ran");
    expect(4).toBe(4);
  });
});`,
    );

    const { stdout, stderr, exitCode } = await runTestWithOutput([`./nested-describe.test.ts:9`], cwd);

    expect(stdout).toContain("✅ Inner test A ran");
    expect(stdout).toContain("✅ Inner test B ran");
    expect(stdout).not.toContain("❌ Outer test ran");
    expect(stdout).not.toContain("❌ Another outer test ran");
    expect(stderr).toContain("2 pass");
    expect(stderr).toContain("2 filtered out");
    expect(exitCode).toBe(0);
  });

  test("should handle path formats and colon parsing edge cases", async () => {
    const cwd = tmpdirSync();
    const testFile = createTestFile(cwd, "path-formats.test.ts", standardTestContent);

    // Test relative path
    const result1 = await runTestWithOutput([`./path-formats.test.ts:8`], cwd);
    expect(result1.stdout).toContain("✅ Target test ran");
    expect(result1.exitCode).toBe(0);

    // Test absolute path
    const result2 = await runTestWithOutput([`${testFile}:8`], cwd);
    expect(result2.stdout).toContain("✅ Target test ran");
    expect(result2.exitCode).toBe(0);

    // Test multiple colons: file:8:10 should parse as file with line 8 (middle number, not last!)
    const result3 = await runTestWithOutput([`./path-formats.test.ts:8:10`], cwd);
    expect(result3.stdout).toContain("✅ Target test ran"); // Target test is on line 8
    expect(result3.exitCode).toBe(0);

    // Test edge case: file:1:999 should use line 1, not 999 (which would be invalid)
    const result4 = await runTestWithOutput([`./path-formats.test.ts:1:999`], cwd);
    expect(result4.stderr).toContain("no tests found for file:line filters"); // Line 1 has no test
    expect(result4.exitCode).toBe(1);

    // Test edge case: file:8:abc should fail entirely (not use line 8) because last part is invalid
    const result4b = await runTestWithOutput([`./path-formats.test.ts:8:abc`], cwd);
    expect(result4b.stderr).toContain("had no matches"); // Treated as filename, not file:line
    expect(result4b.exitCode).toBe(1);

    // Test Windows backslash paths (if on Windows)
    if (isWindows) {
      const windowsPath = testFile.replace(/\//g, "\\");
      const result5 = await runTestWithOutput([`${windowsPath}:8`], cwd);
      expect(result5.stdout).toContain("✅ Target test ran");
      expect(result5.exitCode).toBe(0);
    }

    // Test mixing relative and absolute paths for same file
    const result6 = await runTestWithOutput([`./path-formats.test.ts:8`, `${testFile}:8`], cwd);
    expect(result6.stdout).toContain("✅ Target test ran");
    expect(result6.stderr).toContain("1 pass"); // Should deduplicate
    expect(result6.exitCode).toBe(0);
  });

  test("should handle invalid inputs and edge cases", async () => {
    const cwd = tmpdirSync();
    const testFile = createTestFile(cwd, "edge-cases.test.ts", standardTestContent);

    // Test cases that should fail
    const invalidCases = [
      `./edge-cases.test.ts:0`, // Zero line
      `./edge-cases.test.ts:999999`, // Very large line
      `./edge-cases.test.ts:abc`, // Non-numeric
      `./edge-cases.test.ts:`, // Missing line
      `./non-existent.test.ts:5`, // Non-existent file
    ];

    for (const testCase of invalidCases) {
      const result = await runTestWithOutput([testCase], cwd);
      expect(result.exitCode).toBe(1);
      expect(
        result.stderr.includes("had no matches") ||
          result.stderr.includes("did not match any test files") ||
          result.stderr.includes("no tests found"),
      ).toBe(true);
    }

    // Test valid line that doesn't match any test
    const result = await runTestWithOutput([`./edge-cases.test.ts:1`], cwd);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("no tests found for file:line filters");
  });

  test("should handle multiple files and complex scenarios", async () => {
    const cwd = tmpdirSync();

    // Create multiple test files
    const file1 = createTestFile(cwd, "multi1.test.ts", standardTestContent);
    const file2 = createTestFile(
      cwd,
      "multi2.test.ts",
      standardTestContent.replace("Target test ran", "File2 test ran"),
    );

    // Test multiple file:line arguments for same file
    const result1 = await runTestWithOutput([`./multi1.test.ts:8`, `./multi1.test.ts:9`], cwd);
    expect(result1.stdout).toContain("✅ Target test ran");
    expect(result1.stderr).toContain("1 pass");
    expect(result1.exitCode).toBe(0);

    // Test multiple file:line arguments for different files
    const result2 = await runTestWithOutput([`./multi1.test.ts:8`, `./multi2.test.ts:8`], cwd);
    expect(result2.stdout).toContain("✅ Target test ran");
    expect(result2.stdout).toContain("✅ File2 test ran");
    expect(result2.stderr).toContain("2 pass");
    expect(result2.exitCode).toBe(0);

    // Test mixed file:line and normal file arguments
    const result3 = await runTestWithOutput([`./multi1.test.ts:8`, `./multi2.test.ts`], cwd);
    expect(result3.stdout).toContain("✅ Target test ran");
    expect(result3.stdout).toContain("✅ File2 test ran");
    expect(result3.stderr).toContain("4 pass"); // 1 from line filter + 3 from full file
    expect(result3.exitCode).toBe(0);
  });

  test("should work with test.each and special syntax", async () => {
    const cwd = tmpdirSync();
    const testFile = createTestFile(
      cwd,
      "test-each.test.ts",
      `import { test, expect } from "bun:test";

test("regular test - should NOT run", () => {
  console.log("❌ Regular test ran");
  expect(1).toBe(1);
});

test.each([1, 2, 3])("each test %s - SHOULD run", (num) => {
  console.log(\`✅ Each test \${num} ran\`);
  expect(num).toBeGreaterThan(0);
});

test("another test - should NOT run", () => {
  console.log("❌ Another test ran");
  expect(2).toBe(2);
});`,
    );

    const { stdout, stderr, exitCode } = await runTestWithOutput([`./test-each.test.ts:8`], cwd);

    expect(stdout).toContain("✅ Each test 1 ran");
    expect(stdout).toContain("✅ Each test 2 ran");
    expect(stdout).toContain("✅ Each test 3 ran");
    expect(stdout).not.toContain("❌ Regular test ran");
    expect(stdout).not.toContain("❌ Another test ran");
    expect(exitCode).toBe(0);
  });

  test("should work with complex syntax and comments in test files", async () => {
    const cwd = tmpdirSync();
    const testFile = createTestFile(
      cwd,
      "comment-lines.test.ts",
      `import { test, expect, describe } from "bun:test";
import type { it } from "bun";

// This is a comment line
// Another comment
describe("comment test block", () => {
  // Comment inside describe
  
  (test as it)("test inside - SHOULD run", () => {
    console.log("✅ Test inside ran");
    expect(1).toBe(1);
  });
});

test("outside test - should NOT run", () => {
  console.log("❌ Outside test ran");
  expect(2).toBe(2);
});`,
    );

    const { stdout, stderr, exitCode } = await runTestWithOutput([`./comment-lines.test.ts:6`], cwd);

    expect(stdout).toContain("✅ Test inside ran");
    expect(stdout).not.toContain("❌ Outside test ran");
    expect(stderr).toContain("1 pass");
    expect(stderr).toContain("1 filtered out");
    expect(exitCode).toBe(0);
  });
});
