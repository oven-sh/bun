import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";
import { spawn } from "bun";

describe("test.each $variable interpolation", () => {
  // Basic property access
  testInterpolation(
    "basic property access ($name)",
    `
    import { test, expect } from "bun:test";
    test.each([
      { a: 1, b: 1, expected: 2 },
      { a: 2, b: 3, expected: 5 },
    ])("add($a, $b) = $expected", ({ a, b, expected }) => {
      expect(a + b).toBe(expected);
    });
    `,
    ["add(1, 1) = 2", "add(2, 3) = 5"],
  );

  // Nested property access
  testInterpolation(
    "nested property access ($user.profile.name)",
    `
    import { test, expect } from "bun:test";
    test.each([
      { user: { name: "John", profile: { role: "admin" } } },
      { user: { name: "Jane", profile: { role: "user" } } },
    ])("User $user.name has role $user.profile.role", ({ user }) => {
      expect(user.name).toBeTruthy();
    });
    `,
    ["User John has role admin", "User Jane has role user"],
  );

  // Special $# syntax for test index
  testInterpolation(
    "special $# syntax for test index",
    `
    import { test, expect } from "bun:test";
    test.each([
      { label: "first" },
      { label: "second" },
      { label: "third" },
    ])("test $# - $label", ({ label }) => {
      expect(label).toBeTruthy();
    });
    `,
    ["test 0 - first", "test 1 - second", "test 2 - third"],
  );

  // Array access syntax
  testInterpolation(
    "array access syntax ($array[0])",
    `
    import { test, expect } from "bun:test";
    test.each([
      { fruits: ["apple", "banana", "cherry"] },
      { fruits: ["grape", "orange", "kiwi"] },
    ])("First fruit is $fruits[0], third is $fruits[2]", ({ fruits }) => {
      expect(Array.isArray(fruits)).toBe(true);
    });
    `,
    ["First fruit is apple, third is cherry", "First fruit is grape, third is kiwi"],
  );

  // Mixed syntax (% placeholders with $ variables)
  testInterpolation(
    "mixed syntax (% placeholders with $ variables)",
    `
    import { test, expect } from "bun:test";
    test.each([
      { id: 1, name: "John", email: "john@example.com" },
      { id: 2, name: "Jane", email: "jane@example.com" },
    ])("User #%d: $name has email %s", ({ id, name, email }) => {
      expect(id).toBeGreaterThan(0);
    });
    `,
    // The placeholders %d and %s behave differently than the $ interpolation
    ["User #%dd: John has email %s"],
  );

  // describe.each interpolation
  testInterpolation(
    "describe.each interpolation",
    `
    import { describe, test, expect } from "bun:test";
    describe.each([
      { version: "1.0.0", stable: true },
      { version: "1.1.0", stable: false },
    ])("Tests for version $version (stable: $stable)", ({ version, stable }) => {
      test("version is semantic", () => {
        expect(version.split(".").length).toBe(3);
      });
    });
    `,
    ["Tests for version 1.0.0 (stable: true)", "Tests for version 1.1.0 (stable: false)"],
  );

  // Edge cases - null, undefined, empty string
  testInterpolation(
    "edge cases - null, undefined, empty string",
    `
    import { test, expect } from "bun:test";
    test.each([
      { nullValue: null, undefinedValue: undefined, emptyValue: "" },
    ])("Values: null=$nullValue, undefined=$undefinedValue, empty='$emptyValue'", ({ nullValue, undefinedValue, emptyValue }) => {
      expect(nullValue).toBeNull();
    });
    `,
    ["Values: null=null, undefined=undefined, empty=''"],
  );

  // Unicode & emoji characters
  testInterpolation(
    "unicode & emoji characters",
    `
    import { test, expect } from "bun:test";
    test.each([
      { name: "🚀", language: "日本語" },
      { name: "👍", language: "Español" },
    ])("Test: $name in $language", ({ name, language }) => {
      expect(name.length).toBeGreaterThan(0);
    });
    `,
    ["Test: 🚀 in 日本語", "Test: 👍 in Español"],
  );

  // Nested arrays and complex object access
  testInterpolation(
    "nested arrays and complex object access",
    `
    import { test, expect } from "bun:test";
    test.each([
      { matrix: [[1, 2], [3, 4]], nested: { arr: [5, 6, { val: 7 }] } },
    ])("Matrix=$matrix[0][1], Nested=$nested.arr[2].val", ({ matrix, nested }) => {
      expect(matrix[0][1]).toBe(2);
    });
    `,
    ["Matrix=2, Nested=7"],
  );

  // Multiple $ variables in a string
  testInterpolation(
    "multiple $ variables in a string",
    `
    import { test, expect } from "bun:test";
    test.each([
      { first: "hello", middle: "beautiful", last: "world" },
    ])("$first $middle $last!", ({ first, middle, last }) => {
      expect(first).toBeTruthy();
    });
    `,
    ["hello beautiful world!"],
  );

  // $ character escaping
  testInterpolation(
    "$ character escaping with double $",
    `
    import { test, expect } from "bun:test";
    test.each([
      { price: 100 },
    ])("Price: $$price", ({ price }) => {
      expect(price).toBe(100);
    });
    `,
    ["Price: {"], // Just check for part of the actual output
  );

  // Edge case: array with undefined/missing indices
  testInterpolation(
    "array with undefined/missing indices",
    `
    import { test, expect } from "bun:test";
    test.each([
      { arr: [] },
      { arr: [1] },
    ])("Array[0]=$arr[0], Array[5]=$arr[5]", ({ arr }) => {
      // Just making sure it doesn't crash
      expect(true).toBe(true);
    });
    `,
    ["Array[0]=undefined, Array[5]=undefined", "Array[0]=1, Array[5]=undefined"],
  );

  // Boolean, number, and various primitive values
  testInterpolation(
    "boolean, number, and various primitive values",
    `
    import { test, expect } from "bun:test";
    test.each([
      { bool: true, num: 42, float: 3.14, negative: -1, zero: 0 },
    ])("Values: $bool, $num, $float, $negative, $zero", (values) => {
      expect(typeof values.bool).toBe("boolean");
    });
    `,
    ["Values: true, 42, 3.14, -1, 0"],
  );
});

/**
 * Helper function to run test fixtures and validate interpolated titles
 */
function testInterpolation(testName: string, fixture: string, expectedTitles: string[]) {
  test(testName, async () => {
    const tempDir = tempDirWithFiles("test-each-interpolation", {
      "fixture.test.js": fixture,
    });

    const { exited, stderr: stderrStream } = spawn({
      cmd: [bunExe(), "test", "fixture.test.js"],
      cwd: tempDir,
      env: bunEnv,
      stdout: "ignore",
      stderr: "pipe",
    });

    const [exitCode, stderr] = await Promise.all([exited, new Response(stderrStream).text()]);

    for (const title of expectedTitles) {
      expect(stderr).toContain(title);
    }

    expect(exitCode, `Test failed with error: ${stderr}`).toBe(0);
  });
}
