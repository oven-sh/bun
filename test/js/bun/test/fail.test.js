import { test, fail, expect } from "bun:test";

test("fail", () => {
  expect(() => fail("This test should fail")).toThrow({ message: "\n\nThis test should fail\n" });
});

test("fail without message", () => {
  expect(() => fail()).toThrow({ message: "\n\nfails by fail() assertion\n" });
});

test("fail with non-string message", () => {
  expect(() => fail(123)).toThrow({ message: "Expected message to be a string for 'fail'." });
});
