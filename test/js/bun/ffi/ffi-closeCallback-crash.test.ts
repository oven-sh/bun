import { test, expect } from "bun:test";

test("FFI closeCallback does not crash with invalid arguments", () => {
  // @ts-expect-error - internal API
  const closeCallback = Bun.FFI.closeCallback;
  expect(closeCallback).toBeFunction();

  // Calling closeCallback with non-pointer values should throw, not crash
  expect(() => closeCallback(0)).toThrow();
  expect(() => closeCallback(1)).toThrow();
  expect(() => closeCallback(8)).toThrow();
  expect(() => closeCallback(16)).toThrow();
  expect(() => closeCallback(0x1000)).toThrow();
  expect(() => closeCallback(-1)).toThrow();
  expect(() => closeCallback(-8)).toThrow();
  expect(() => closeCallback(NaN)).toThrow();
  expect(() => closeCallback(Infinity)).toThrow();
  expect(() => closeCallback(-Infinity)).toThrow();
  expect(() => closeCallback("hello")).toThrow();
  expect(() => closeCallback(undefined)).toThrow();
  expect(() => closeCallback(null)).toThrow();
  expect(() => closeCallback({})).toThrow();
});
