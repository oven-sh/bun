import { test, expect, jest } from "bun:test";

test("Reflect.construct on mock with non-object return value does not crash", () => {
  const m = jest.fn(() => 42);
  const result = Reflect.construct(m, []);
  expect(result).toBeObject();
  expect(m.mock.results[0].value).toBe(42);
});

test("Reflect.construct on mock with mockReturnValue does not crash", () => {
  const m = jest.fn();
  m.mockReturnValue(123);
  const result = Reflect.construct(m, []);
  expect(result).toBeObject();
  expect(m.mock.results[0].value).toBe(123);
});

test("Reflect.construct on mock with object return value returns that object", () => {
  const obj = { a: 1 };
  const m = jest.fn(() => obj);
  const result = Reflect.construct(m, []);
  expect(result).toBe(obj);
});

test("new on mock with non-object return value still works", () => {
  const m = jest.fn(() => 42);
  const result = new m();
  expect(result).toBeObject();
  expect(m.mock.results[0].value).toBe(42);
});
