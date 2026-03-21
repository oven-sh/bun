import { expect, test } from "bun:test";

test("FFI closeCallback does not crash with invalid arguments", () => {
  const ffi = Bun.FFI;
  // closeCallback is an internal function that expects a numeric pointer.
  // Calling it with non-number arguments should not crash the process.
  expect(() => ffi.closeCallback({})).toThrow("Expected a number");
  expect(() => ffi.closeCallback("str")).toThrow("Expected a number");
  expect(() => ffi.closeCallback(new Float64Array(1))).toThrow("Expected a number");
  expect(() => ffi.closeCallback(0)).toThrow("Expected a non-zero pointer");
});
