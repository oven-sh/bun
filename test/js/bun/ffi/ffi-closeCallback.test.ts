import { test, expect } from "bun:test";

test("FFI.closeCallback does not crash with invalid arguments", () => {
  const closeCallback = Bun.FFI.closeCallback;
  // Calling closeCallback with non-pointer values should not crash
  expect(() => closeCallback(42)).not.toThrow();
  expect(() => closeCallback(0)).not.toThrow();
  expect(() => closeCallback(undefined)).not.toThrow();
  expect(() => closeCallback("hello")).not.toThrow();
  expect(() => closeCallback(null)).not.toThrow();
});
