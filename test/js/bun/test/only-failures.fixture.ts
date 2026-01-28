import { expect, test } from "bun:test";

test("passing test 1", () => {
  expect(1 + 1).toBe(2);
});

test("passing test 2", () => {
  expect(2 + 2).toBe(4);
});

test("failing test", () => {
  expect(1 + 1).toBe(3);
});

test("passing test 3", () => {
  expect(3 + 3).toBe(6);
});

test.skip("skipped test", () => {
  expect(true).toBe(false);
});

test.todo("todo test");

test("another failing test", () => {
  throw new Error("This test fails");
});
