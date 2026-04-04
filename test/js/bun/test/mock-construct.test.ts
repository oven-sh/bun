import { expect, jest, test } from "bun:test";

test("constructing a mock function with no implementation does not crash", () => {
  const fn = jest.fn();
  const obj = new fn();
  expect(obj).toBeObject();
});

test("constructing a mock function with mockReturnValue non-object returns an object", () => {
  const fn = jest.fn();
  fn.mockReturnValue(42);
  const obj = new fn();
  expect(obj).toBeObject();
});

test("constructing a mock function with mockImplementation returning object works", () => {
  const fn = jest.fn(() => ({ key: "value" }));
  const obj = new fn();
  expect(obj).toEqual({ key: "value" });
});

test("calling a mock with non-undefined this still returns the mock value", () => {
  const fn = jest.fn();
  fn.mockReturnValue(42);
  const obj = { method: fn };
  // Normal call with non-undefined this must return the mock's value, not `this`
  expect(obj.method()).toBe(42);
});

test("Reflect.construct with custom newTarget honors prototype chain", () => {
  const fn = jest.fn();
  class MyClass {}
  const obj = Reflect.construct(fn, [], MyClass);
  expect(obj).toBeInstanceOf(MyClass);
});
