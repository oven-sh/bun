import { test, expect } from "bun:test";

test("Object.foo", () => {
  Object.foo = true;
  expect(Object.bar).toBeUndefined();
});
