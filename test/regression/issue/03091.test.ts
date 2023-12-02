import { test, expect } from "bun:test";

test("global defines should not be replaced with undefined", () => {
  expect(typeof Symbol["for"]).toBe("function");
});
