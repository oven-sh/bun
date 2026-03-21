import { expect, test } from "bun:test";

test("FFI.closeCallback does not crash with invalid arguments", () => {
  const ffi = Bun.FFI;

  // closeCallback should not crash when called with non-pointer arguments
  expect(() => ffi.closeCallback("not a pointer")).not.toThrow();
  expect(() => ffi.closeCallback({})).not.toThrow();
  expect(() => ffi.closeCallback(undefined)).not.toThrow();
  expect(() => ffi.closeCallback(null)).not.toThrow();
  expect(() => ffi.closeCallback(0)).not.toThrow();
  expect(() => ffi.closeCallback(NaN)).not.toThrow();
  expect(() => ffi.closeCallback(Infinity)).not.toThrow();
  expect(() => ffi.closeCallback(-Infinity)).not.toThrow();
  expect(() => ffi.closeCallback(-1)).not.toThrow();
  expect(() => ffi.closeCallback(1e100)).not.toThrow();
  expect(() => ffi.closeCallback(Number.MAX_VALUE)).not.toThrow();
  expect(() => ffi.closeCallback(2 ** 64)).not.toThrow();
  expect(() => ffi.closeCallback(1.5)).not.toThrow();
  expect(() => ffi.closeCallback(2.9)).not.toThrow();
  expect(() => ffi.closeCallback(100.7)).not.toThrow();
});
