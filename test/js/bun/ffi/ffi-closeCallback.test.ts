import { expect, test } from "bun:test";

test("FFI.closeCallback does not crash with invalid arguments", () => {
  const closeCallback = Bun.FFI.closeCallback;
  // Calling closeCallback with non-pointer values should not crash
  expect(() => closeCallback(42)).not.toThrow();
  expect(() => closeCallback(0)).not.toThrow();
  expect(() => closeCallback(undefined)).not.toThrow();
  expect(() => closeCallback("hello")).not.toThrow();
  expect(() => closeCallback(null)).not.toThrow();
  expect(() => closeCallback(NaN)).not.toThrow();
  expect(() => closeCallback(Infinity)).not.toThrow();
  expect(() => closeCallback(-1)).not.toThrow();
  expect(() => closeCallback(1e20)).not.toThrow();
});
