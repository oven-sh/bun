import { test, mock, expect } from "bun:test";

test("are callable", () => {
  const fn = mock(() => 42);
  expect(fn()).toBe(42);
  expect(fn).toHaveBeenCalled();
  expect(fn).toHaveBeenCalledTimes(1);
  expect(fn.mock.calls).toHaveLength(1);
  expect(fn.mock.calls[0]).toBeEmpty();

  expect(fn()).toBe(42);
  expect(fn).toHaveBeenCalledTimes(2);

  expect(fn.mock.calls).toHaveLength(2);
  expect(fn.mock.calls[1]).toBeEmpty();
});

test("include arguments", () => {
  const fn = mock(f => f);
  expect(fn(43)).toBe(43);
  expect(fn.mock.results[0]).toEqual({
    type: "return",
    value: 43,
  });
  expect(fn.mock.calls[0]).toEqual([43]);
});

test("works when throwing", () => {
  const instance = new Error("foo");
  const fn = mock(f => {
    throw instance;
  });
  expect(() => fn(43)).toThrow("foo");
  expect(fn.mock.results[0]).toEqual({
    type: "throw",
    value: instance,
  });
  expect(fn.mock.calls[0]).toEqual([43]);
});
