import { test, expect } from "bun:test";

test("FFI.closeCallback does not crash with invalid argument", () => {
  const ffi = Bun.FFI;
  expect(() => ffi.closeCallback("not a pointer")).toThrow("Expected a callback context");
  expect(() => ffi.closeCallback(undefined)).toThrow("Expected a callback context");
  expect(() => ffi.closeCallback({})).toThrow("Expected a callback context");
  expect(() => ffi.closeCallback(0)).toThrow("Expected a callback context");
  expect(() => ffi.closeCallback(NaN)).toThrow("Expected a callback context");
  expect(() => ffi.closeCallback(Infinity)).toThrow("Expected a callback context");
  expect(() => ffi.closeCallback(1.5)).toThrow("Expected a callback context");
  expect(() => ffi.closeCallback(16.5)).toThrow("Expected a callback context");
  expect(() => ffi.closeCallback(Number.MAX_VALUE)).toThrow("Expected a callback context");
  expect(() => ffi.closeCallback(2 ** 64)).toThrow("Expected a callback context");
  expect(() => ffi.closeCallback(-1.0)).toThrow("Expected a callback context");
});
