import { describe, expect, test } from "bun:test";

// https://github.com/oven-sh/bun/issues/25959
// test.todo and describe.todo should accept a single string argument

// Test.todo with single argument - the reported issue
test.todo("unimplemented feature");

// Test.todo with callback - should still work
test.todo("feature with callback that would fail", () => {
  expect(1).toBe(2);
});

// describe.todo with single argument
describe.todo("unimplemented feature group");

// describe.todo with callback - should still work
describe.todo("feature group with callback", () => {
  test("nested test that would fail", () => {
    expect(1).toBe(2);
  });
});

// Regular test to make the file run
test("this test passes", () => {
  expect(true).toBe(true);
});
