import { expect, jest, test } from "bun:test";

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
