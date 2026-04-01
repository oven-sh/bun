import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// Test that test files are sorted alphabetically for consistent execution order.
// https://github.com/oven-sh/bun/issues/25797
//
// This ensures that running `bun test .` produces the same order as running
// `bun test file1.test.ts file2.test.ts ...` (which VSCode does).

describe("issue #25797", () => {
  test("test files are sorted alphabetically", async () => {
    // Create test files with names that would appear in different orders
    // depending on filesystem vs alphabetical sorting
    using dir = tempDir("test-sort-order", {
      "z_last.test.ts": `
        import { test, expect } from "bun:test";
        test("z_last", () => { console.log("FILE:z_last"); expect(true).toBe(true); });
      `,
      "a_first.test.ts": `
        import { test, expect } from "bun:test";
        test("a_first", () => { console.log("FILE:a_first"); expect(true).toBe(true); });
      `,
      "m_middle.test.ts": `
        import { test, expect } from "bun:test";
        test("m_middle", () => { console.log("FILE:m_middle"); expect(true).toBe(true); });
      `,
    });

    // Run tests using directory scanning (bun test .)
    await using proc1 = Bun.spawn({
      cmd: [bunExe(), "test", "."],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout1, stderr1, exitCode1] = await Promise.all([proc1.stdout.text(), proc1.stderr.text(), proc1.exited]);

    // Run tests using explicit file paths in reverse alphabetical order
    // (simulating how VSCode might pass them in a different order)
    await using proc2 = Bun.spawn({
      cmd: [bunExe(), "test", "z_last.test.ts", "m_middle.test.ts", "a_first.test.ts"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout2, stderr2, exitCode2] = await Promise.all([proc2.stdout.text(), proc2.stderr.text(), proc2.exited]);

    expect(exitCode1).toBe(0);
    expect(exitCode2).toBe(0);

    // Extract the order of FILE: markers from output
    const getFileOrder = (output: string): string[] => {
      const matches = output.match(/FILE:(\w+)/g) || [];
      return matches.map(m => m.replace("FILE:", ""));
    };

    const order1 = getFileOrder(stdout1);
    const order2 = getFileOrder(stdout2);

    // Both should produce alphabetical order
    expect(order1).toEqual(["a_first", "m_middle", "z_last"]);
    expect(order2).toEqual(["a_first", "m_middle", "z_last"]);

    // Both methods should produce the same order
    expect(order1).toEqual(order2);
  });

  test("test files in subdirectories are sorted alphabetically", async () => {
    using dir = tempDir("test-sort-subdirs", {
      "tests/b_second.test.ts": `
        import { test, expect } from "bun:test";
        test("b_second", () => { console.log("FILE:b_second"); expect(true).toBe(true); });
      `,
      "tests/a_first.test.ts": `
        import { test, expect } from "bun:test";
        test("a_first", () => { console.log("FILE:a_first"); expect(true).toBe(true); });
      `,
      "other/c_third.test.ts": `
        import { test, expect } from "bun:test";
        test("c_third", () => { console.log("FILE:c_third"); expect(true).toBe(true); });
      `,
    });

    // Run tests using directory scanning
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "."],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(exitCode).toBe(0);

    // Extract the order of FILE: markers from output
    const getFileOrder = (output: string): string[] => {
      const matches = output.match(/FILE:(\w+)/g) || [];
      return matches.map(m => m.replace("FILE:", ""));
    };

    const order = getFileOrder(stdout);

    // Files should be sorted alphabetically by full path
    // other/c_third.test.ts comes before tests/a_first.test.ts and tests/b_second.test.ts
    expect(order).toEqual(["c_third", "a_first", "b_second"]);
  });

  test("explicit paths and directory scanning produce same order", async () => {
    using dir = tempDir("test-explicit-vs-scan", {
      "test_c.test.ts": `
        import { test, expect } from "bun:test";
        test("test_c", () => { console.log("FILE:test_c"); expect(true).toBe(true); });
      `,
      "test_a.test.ts": `
        import { test, expect } from "bun:test";
        test("test_a", () => { console.log("FILE:test_a"); expect(true).toBe(true); });
      `,
      "test_b.test.ts": `
        import { test, expect } from "bun:test";
        test("test_b", () => { console.log("FILE:test_b"); expect(true).toBe(true); });
      `,
    });

    // Method 1: Directory scanning
    await using proc1 = Bun.spawn({
      cmd: [bunExe(), "test", "."],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    // Method 2: Explicit paths in scrambled order
    await using proc2 = Bun.spawn({
      cmd: [bunExe(), "test", "./test_b.test.ts", "./test_c.test.ts", "./test_a.test.ts"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout1, , exitCode1] = await Promise.all([proc1.stdout.text(), proc1.stderr.text(), proc1.exited]);

    const [stdout2, , exitCode2] = await Promise.all([proc2.stdout.text(), proc2.stderr.text(), proc2.exited]);

    expect(exitCode1).toBe(0);
    expect(exitCode2).toBe(0);

    const getFileOrder = (output: string): string[] => {
      const matches = output.match(/FILE:(\w+)/g) || [];
      return matches.map(m => m.replace("FILE:", ""));
    };

    const order1 = getFileOrder(stdout1);
    const order2 = getFileOrder(stdout2);

    // Both should be alphabetically sorted
    expect(order1).toEqual(["test_a", "test_b", "test_c"]);
    expect(order2).toEqual(["test_a", "test_b", "test_c"]);
  });
});
