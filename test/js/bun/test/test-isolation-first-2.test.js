import { test, expect } from "bun:test";

test("Object.foo", () => {
  expect(Object.foo).toBeUndefined();
  Object.bar = false;
});
