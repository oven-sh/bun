import { spawnSync } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tmpdirSync } from "harness";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

describe("bun test file:line filtering", () => {
  function createTestFile(cwd: string, filename: string, content: string): string {
    const path = join(cwd, filename);
    writeFileSync(path, content);
    return path;
  }

  function runTestWithOutput(args: string[], cwd?: string): { stdout: string; stderr: string; exitCode: number } {
    const result = spawnSync({
      cmd: [bunExe(), "test", ...args],
      env: bunEnv,
      cwd,
    });
    return {
      stdout: result.stdout?.toString() || "",
      stderr: result.stderr?.toString() || "",
      exitCode: result.exitCode || 0,
    };
  }

  test("should run only the test on the specified line", () => {
    const cwd = tmpdirSync();
    const testFile = createTestFile(
      cwd,
      "single-test.test.ts",
      `import { test, expect } from "bun:test";

test("test 1 - should NOT run", () => {
  console.log("❌ Test 1 ran");
  expect(1).toBe(1);
});

test("test 2 - SHOULD run", () => {
  console.log("✅ Test 2 ran");
  expect(2).toBe(2);
});

test("test 3 - should NOT run", () => {
  console.log("❌ Test 3 ran");
  expect(3).toBe(3);
});`,
    );

    // Target line 8 which contains "test 2"
    const { stdout, stderr, exitCode } = runTestWithOutput([`./single-test.test.ts:8`], cwd);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("✅ Test 2 ran");
    expect(stdout).not.toContain("❌ Test 1 ran");
    expect(stdout).not.toContain("❌ Test 3 ran");
    expect(stderr).toContain("1 pass");
    expect(stderr).toContain("2 filtered out");
  });

  test("should run all tests in a describe block when targeting the describe line", () => {
    const cwd = tmpdirSync();
    const testFile = createTestFile(
      cwd,
      "describe-block.test.ts",
      `import { test, expect, describe } from "bun:test";

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
});`,
    );

    // Target line 8 which contains the describe "target block"
    const { stdout, stderr, exitCode } = runTestWithOutput([`./describe-block.test.ts:8`], cwd);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("✅ Test A ran");
    expect(stdout).toContain("✅ Test B ran");
    expect(stdout).not.toContain("❌ Standalone test ran");
    expect(stdout).not.toContain("❌ Test C ran");
    expect(stderr).toContain("2 pass");
    expect(stderr).toContain("2 filtered out");
  });

  test("should handle nested describe blocks correctly", () => {
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

    // Target line 9 which contains the inner describe "inner target"
    const { stdout, stderr, exitCode } = runTestWithOutput([`./nested-describe.test.ts:9`], cwd);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("✅ Inner test A ran");
    expect(stdout).toContain("✅ Inner test B ran");
    expect(stdout).not.toContain("❌ Outer test ran");
    expect(stdout).not.toContain("❌ Another outer test ran");
    expect(stderr).toContain("2 pass");
    expect(stderr).toContain("2 filtered out");
  });

  test("should show error when no tests found at specified line", () => {
    const cwd = tmpdirSync();
    const testFile = createTestFile(
      cwd,
      "empty-line.test.ts",
      `import { test, expect } from "bun:test";

test("only test", () => {
  expect(1).toBe(1);
});`,
    );

    // Target line 10 which is beyond the file content
    const { stdout, stderr, exitCode } = runTestWithOutput([`./empty-line.test.ts:10`], cwd);

    expect(exitCode).toBe(1);
    expect(stderr).toContain("no tests found at line 10");
    expect(stderr).toContain("skipping 1 test");
  });

  test("should show error when targeting non-existent file", () => {
    const cwd = tmpdirSync();

    const { stdout, stderr, exitCode } = runTestWithOutput([`./non-existent.test.ts:5`], cwd);

    expect(exitCode).toBe(1);
    expect(stderr).toContain("Test file");
    expect(stderr).toContain("non-existent.test.ts");
    expect(stderr).toContain("not found");
  });

  test("should handle absolute paths with line numbers", () => {
    const cwd = tmpdirSync();
    const testFile = createTestFile(
      cwd,
      "absolute-path.test.ts",
      `import { test, expect } from "bun:test";

test("test 1", () => {
  expect(1).toBe(1);
});

test("target test", () => {
  console.log("✅ Target test ran");
  expect(2).toBe(2);
});`,
    );

    // Use absolute path with line number (target the test on line 7)
    const { stdout, stderr, exitCode } = runTestWithOutput([`${testFile}:7`], cwd);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("✅ Target test ran");
    expect(stderr).toContain("1 pass");
    expect(stderr).toContain("1 filtered out");
  });

  test("should handle relative paths with ./ prefix", () => {
    const cwd = tmpdirSync();
    const testFile = createTestFile(
      cwd,
      "relative-path.test.ts",
      `import { test, expect } from "bun:test";

test("test 1", () => {
  expect(1).toBe(1);
});

test("target test", () => {
  console.log("✅ Target test ran");
  expect(2).toBe(2);
});`,
    );

    // Use ./relative path with line number (target the test on line 7)
    const { stdout, stderr, exitCode } = runTestWithOutput([`./relative-path.test.ts:7`], cwd);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("✅ Target test ran");
    expect(stderr).toContain("1 pass");
    expect(stderr).toContain("1 filtered out");
  });

  test("should handle multiple describe blocks at different levels", () => {
    const cwd = tmpdirSync();
    const testFile = createTestFile(
      cwd,
      "multi-describe.test.ts",
      `import { test, expect, describe } from "bun:test";

describe("first block", () => {
  test("first test", () => {
    console.log("❌ First test ran");
    expect(1).toBe(1);
  });
});

describe("second block", () => {
  test("second test A", () => {
    console.log("✅ Second test A ran");
    expect(2).toBe(2);
  });

  test("second test B", () => {
    console.log("✅ Second test B ran");
    expect(3).toBe(3);
  });
});

describe("third block", () => {
  test("third test", () => {
    console.log("❌ Third test ran");
    expect(4).toBe(4);
  });
});`,
    );

    // Target line 10 which contains "describe second block"
    const { stdout, stderr, exitCode } = runTestWithOutput([`./multi-describe.test.ts:10`], cwd);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("✅ Second test A ran");
    expect(stdout).toContain("✅ Second test B ran");
    expect(stdout).not.toContain("❌ First test ran");
    expect(stdout).not.toContain("❌ Third test ran");
    expect(stderr).toContain("2 pass");
    expect(stderr).toContain("2 filtered out");
  });

  test("should work with test.each when targeting individual test line", () => {
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

    // Target line 8 which contains the test.each
    const { stdout, stderr, exitCode } = runTestWithOutput([`./test-each.test.ts:8`], cwd);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("✅ Each test 1 ran");
    expect(stdout).toContain("✅ Each test 2 ran");
    expect(stdout).toContain("✅ Each test 3 ran");
    expect(stdout).not.toContain("❌ Regular test ran");
    expect(stdout).not.toContain("❌ Another test ran");
  });

  test("should reject invalid line numbers", () => {
    const cwd = tmpdirSync();
    const testFile = createTestFile(
      cwd,
      "valid-file.test.ts",
      `import { test, expect } from "bun:test";

test("test", () => {
  expect(1).toBe(1);
});`,
    );

    // Target line 0 (invalid)
    const result1 = runTestWithOutput([`./valid-file.test.ts:0`], cwd);
    expect(result1.stderr).toContain("no tests found at line 0");

    // Target negative line (this should be treated as a filename, not file:line)
    const result2 = runTestWithOutput([`./valid-file.test.ts:-5`], cwd);
    expect(result2.stderr).toContain("had no matches"); // Treated as filename
  });

  test("should work with comment lines and empty lines by finding nearest test/describe", () => {
    const cwd = tmpdirSync();
    const testFile = createTestFile(
      cwd,
      "comment-lines.test.ts",
      `import { test, expect, describe } from "bun:test";

// This is a comment line
// Another comment
describe("comment test block", () => {
  // Comment inside describe
  
  test("test inside - SHOULD run", () => {
    console.log("✅ Test inside ran");
    expect(1).toBe(1);
  });
});

test("outside test - should NOT run", () => {
  console.log("❌ Outside test ran");
  expect(2).toBe(2);
});`,
    );

    // Target line 5 which is the describe line
    const { stdout, stderr, exitCode } = runTestWithOutput([`./comment-lines.test.ts:5`], cwd);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("✅ Test inside ran");
    expect(stdout).not.toContain("❌ Outside test ran");
    expect(stderr).toContain("1 pass");
    expect(stderr).toContain("1 filtered out");
  });

  test("should handle multiple file:line arguments for same file", () => {
    const cwd = tmpdirSync();
    const testFile = createTestFile(
      cwd,
      "multi-line.test.ts",
      `import { test, expect } from "bun:test";

test("test 1 - SHOULD run", () => {
  console.log("✅ Test 1 ran");
  expect(1).toBe(1);
});

test("test 2 - should NOT run", () => {
  console.log("❌ Test 2 ran");
  expect(2).toBe(2);
});

test("test 3 - SHOULD run", () => {
  console.log("✅ Test 3 ran");
  expect(3).toBe(3);
});`,
    );

    // Target lines 3 and 13 (test 1 and test 3)
    const { stdout, stderr, exitCode } = runTestWithOutput([`./multi-line.test.ts:3`, `./multi-line.test.ts:13`], cwd);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("✅ Test 1 ran");
    expect(stdout).toContain("✅ Test 3 ran");
    expect(stdout).not.toContain("❌ Test 2 ran");
    expect(stderr).toContain("2 pass");
    expect(stderr).toContain("1 filtered out");
  });

  test("should handle multiple file:line arguments for different files", () => {
    const cwd = tmpdirSync();
    const testFile1 = createTestFile(
      cwd,
      "file1.test.ts",
      `import { test, expect } from "bun:test";

test("file1 test1 - SHOULD run", () => {
  console.log("✅ File1 Test1 ran");
  expect(1).toBe(1);
});

test("file1 test2 - should NOT run", () => {
  console.log("❌ File1 Test2 ran");
  expect(2).toBe(2);
});`,
    );

    const testFile2 = createTestFile(
      cwd,
      "file2.test.ts",
      `import { test, expect } from "bun:test";

test("file2 test1 - should NOT run", () => {
  console.log("❌ File2 Test1 ran");
  expect(1).toBe(1);
});

test("file2 test2 - SHOULD run", () => {
  console.log("✅ File2 Test2 ran");
  expect(2).toBe(2);
});`,
    );

    // Target line 3 in file1 and line 8 in file2
    const { stdout, stderr, exitCode } = runTestWithOutput([`./file1.test.ts:3`, `./file2.test.ts:8`], cwd);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("✅ File1 Test1 ran");
    expect(stdout).toContain("✅ File2 Test2 ran");
    expect(stdout).not.toContain("❌ File1 Test2 ran");
    expect(stdout).not.toContain("❌ File2 Test1 ran");
    expect(stderr).toContain("2 pass");
    expect(stderr).toContain("2 filtered out");
  });

  test("should handle describe blocks in multiple files", () => {
    const cwd = tmpdirSync();
    const testFile1 = createTestFile(
      cwd,
      "describe1.test.ts",
      `import { test, expect, describe } from "bun:test";

describe("group1", () => {
  test("group1 test1 - SHOULD run", () => {
    console.log("✅ Group1 Test1 ran");
    expect(1).toBe(1);
  });

  test("group1 test2 - SHOULD run", () => {
    console.log("✅ Group1 Test2 ran");
    expect(2).toBe(2);
  });
});

test("outside test - should NOT run", () => {
  console.log("❌ Outside test ran");
  expect(3).toBe(3);
});`,
    );

    const testFile2 = createTestFile(
      cwd,
      "describe2.test.ts",
      `import { test, expect, describe } from "bun:test";

test("standalone test - should NOT run", () => {
  console.log("❌ Standalone test ran");
  expect(1).toBe(1);
});

describe("group2", () => {
  test("group2 test1 - SHOULD run", () => {
    console.log("✅ Group2 Test1 ran");
    expect(1).toBe(1);
  });

  test("group2 test2 - SHOULD run", () => {
    console.log("✅ Group2 Test2 ran");
    expect(2).toBe(2);
  });
});`,
    );

    // Target line 3 in describe1 (describe block) and line 7 in describe2 (describe block)
    const { stdout, stderr, exitCode } = runTestWithOutput([`./describe1.test.ts:3`, `./describe2.test.ts:7`], cwd);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("✅ Group1 Test1 ran");
    expect(stdout).toContain("✅ Group1 Test2 ran");
    expect(stdout).toContain("✅ Group2 Test1 ran");
    expect(stdout).toContain("✅ Group2 Test2 ran");
    expect(stdout).not.toContain("❌ Outside test ran");
    expect(stdout).not.toContain("❌ Standalone test ran");
    expect(stderr).toContain("4 pass");
    expect(stderr).toContain("2 filtered out");
  });

  test("should show error message for multiple file:line filters with no matches", () => {
    const cwd = tmpdirSync();
    const testFile1 = createTestFile(
      cwd,
      "empty1.test.ts",
      `import { test, expect } from "bun:test";

test("some test", () => {
  expect(1).toBe(1);
});`,
    );

    const testFile2 = createTestFile(
      cwd,
      "empty2.test.ts",
      `import { test, expect } from "bun:test";

test("another test", () => {
  expect(2).toBe(2);
});`,
    );

    // Target non-existent lines
    const { stdout, stderr, exitCode } = runTestWithOutput([`./empty1.test.ts:99`, `./empty2.test.ts:88`], cwd);

    expect(exitCode).toBe(1);
    expect(stderr).toContain("no tests found for file:line filters");
    expect(stderr).toContain("empty1.test.ts:99");
    expect(stderr).toContain("empty2.test.ts:88");
  });
});
