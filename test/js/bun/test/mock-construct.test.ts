import { test, expect, jest } from "bun:test";

test("constructing a mock function with no implementation does not crash", () => {
  const fn = jest.fn();
  const obj = new fn();
  expect(obj).toBeObject();
});

test("constructing a mock function with mockReturnValue does not crash", () => {
  const fn = jest.fn();
  fn.mockReturnValue(42);
  const obj = new fn();
  // When called as constructor and impl returns non-object, `this` is returned
  expect(obj).toBeObject();
});

test("constructing a mock function with mockImplementation returning object works", () => {
  const fn = jest.fn(() => ({ key: "value" }));
  const obj = new fn();
  expect(obj).toEqual({ key: "value" });
});
