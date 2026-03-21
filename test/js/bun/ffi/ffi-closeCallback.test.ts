import { test, expect } from "bun:test";

test("FFI.closeCallback with invalid argument does not crash", () => {
  const FFI = Bun.FFI;

  expect(() => FFI.closeCallback("not a pointer")).toThrow();
  expect(() => FFI.closeCallback({})).toThrow();
  expect(() => FFI.closeCallback(undefined)).toThrow();
  expect(() => FFI.closeCallback(null)).toThrow();
  expect(() => FFI.closeCallback(0)).toThrow();
  expect(() => FFI.closeCallback(NaN)).toThrow();
  expect(() => FFI.closeCallback(Infinity)).toThrow();
  expect(() => FFI.closeCallback(-Infinity)).toThrow();
  expect(() => FFI.closeCallback(-1)).toThrow();
});
