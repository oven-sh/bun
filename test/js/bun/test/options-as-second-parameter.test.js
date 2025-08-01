import { test, expect } from "bun:test";

// Test that both the original and new syntax work correctly
// This is a regression test to ensure the new parameter order doesn't break existing usage

describe("test() parameter order", () => {
  // Original syntax: test(name, fn, options)
  test("original syntax works", () => {
    expect(true).toBe(true);
  }, { timeout: 1000 });

  test("original syntax with number timeout", () => {
    expect(true).toBe(true);
  }, 500);

  // New syntax: test(name, options, fn) 
  test("new syntax - options object as second parameter", { timeout: 1000 }, () => {
    expect(true).toBe(true);
  });

  test("new syntax - number as second parameter", 500, () => {
    expect(true).toBe(true);
  });

  // Test other methods work with new syntax
  test.skip("skip with new syntax", { timeout: 1000 }, () => {
    expect(true).toBe(true);
  });

  test.todo("todo with new syntax", { timeout: 1000 });
});