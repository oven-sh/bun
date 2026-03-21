import { test, expect } from "bun:test";

test("FFI.closeCallback does not crash with invalid arguments", () => {
  const ffi = Bun.FFI;
  // closeCallback expects a numeric pointer argument;
  // calling with non-numeric values should throw, not crash.
  expect(() => ffi.closeCallback("not a pointer")).toThrow();
  expect(() => ffi.closeCallback(undefined)).toThrow();
  expect(() => ffi.closeCallback(null)).toThrow();
  expect(() => ffi.closeCallback(9n)).toThrow();
});
