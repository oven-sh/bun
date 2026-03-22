import { expect, test } from "bun:test";

test("FFI closeCallback does not crash with invalid argument", () => {
  // closeCallback is an internal method on Bun.FFI that expects a numeric
  // pointer argument. Passing an invalid value should throw instead of
  // crashing with an assertion failure.
  const closeCallback = (Bun.FFI as any).closeCallback;
  expect(closeCallback).toBeDefined();
  expect(() => closeCallback("hello")).toThrow("Expected a callback pointer");
  expect(() => closeCallback({})).toThrow("Expected a callback pointer");
  expect(() => closeCallback(undefined)).toThrow("Expected a callback pointer");
  expect(() => closeCallback(NaN)).toThrow("Expected a callback pointer");
  expect(() => closeCallback(Infinity)).toThrow("Expected a callback pointer");
  expect(() => closeCallback(-1)).toThrow("Expected a callback pointer");
  expect(() => closeCallback(0)).toThrow("Expected a callback pointer");
  expect(() => closeCallback(1.5)).toThrow("Expected a callback pointer");
  expect(() => closeCallback(Number.MAX_VALUE)).toThrow("Expected a callback pointer");
});
