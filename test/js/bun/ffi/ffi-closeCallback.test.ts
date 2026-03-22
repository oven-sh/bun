import { expect, test } from "bun:test";

test("FFI.closeCallback does not crash with invalid argument", () => {
  const closeCallback = Bun.FFI.closeCallback;

  // Passing a non-number should throw, not crash with an assertion failure
  expect(() => closeCallback("not a number")).toThrow();
  expect(() => closeCallback([1, 2, 3])).toThrow();
  expect(() => closeCallback({})).toThrow();

  // Numeric values that are not valid pointers
  expect(() => closeCallback(0)).toThrow();
  expect(() => closeCallback(NaN)).toThrow();
  expect(() => closeCallback(Infinity)).toThrow();
  expect(() => closeCallback(-Infinity)).toThrow();
  expect(() => closeCallback(-1)).toThrow();
  expect(() => closeCallback(1.5)).toThrow();
  expect(() => closeCallback(1e30)).toThrow();
  expect(() => closeCallback(2 ** 64)).toThrow();
  expect(() => closeCallback(Number.MAX_VALUE)).toThrow();
});
