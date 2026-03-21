import { expect, test } from "bun:test";

test("FFI.closeCallback does not crash with non-pointer argument", () => {
  const ffi = Bun.FFI;
  // closeCallback expects a non-negative integer pointer value; passing
  // invalid types, non-integer numbers, or negative values should throw.
  expect(() => ffi.closeCallback("not a pointer")).toThrow("Expected a pointer");
  expect(() => ffi.closeCallback(function () {})).toThrow("Expected a pointer");
  expect(() => ffi.closeCallback({})).toThrow("Expected a pointer");
  expect(() => ffi.closeCallback(undefined)).toThrow("Expected a pointer");
  expect(() => ffi.closeCallback(1.5)).toThrow("Expected a pointer");
  expect(() => ffi.closeCallback(NaN)).toThrow("Expected a pointer");
  expect(() => ffi.closeCallback(Infinity)).toThrow("Expected a pointer");
  expect(() => ffi.closeCallback(-Infinity)).toThrow("Expected a pointer");
  expect(() => ffi.closeCallback(-1)).toThrow("Expected a pointer");
  expect(() => ffi.closeCallback(-1000)).toThrow("Expected a pointer");
  expect(() => ffi.closeCallback(Math.pow(2, 64))).toThrow("Expected a pointer");
  expect(() => ffi.closeCallback(Number.MAX_VALUE)).toThrow("Expected a pointer");
});
