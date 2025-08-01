import { test, expect } from "bun:test";

// Test the original syntax (should still work)
test("original syntax - function as second parameter", () => {
  expect(true).toBe(true);
}, { timeout: 1000 });

test("original syntax - function as second parameter with number timeout", () => {
  expect(true).toBe(true);
}, 500);

// Test the new syntax - options as second parameter
test("new syntax - options as second parameter", { timeout: 1000 }, () => {
  expect(true).toBe(true);
});

// Test with number options
test("new syntax with number timeout", 500, () => {
  expect(true).toBe(true);
});

// Test with todo
test.todo("todo with new syntax", { timeout: 1000 }, () => {
  expect(true).toBe(true);
});

// Test with skip
test.skip("skip with new syntax", { timeout: 1000 }, () => {
  expect(true).toBe(true);
});

// Test with only (but commented out so other tests can run)
// test.only("only with new syntax", { timeout: 1000 }, () => {
//   expect(true).toBe(true);
// });