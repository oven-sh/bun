import { test, expect } from "bun:test";

test("closeCallback with non-pointer argument throws instead of crashing", () => {
  expect(() => Bun.FFI.closeCallback("hello")).toThrow("Expected a pointer");
  expect(() => Bun.FFI.closeCallback({})).toThrow("Expected a pointer");
  expect(() => Bun.FFI.closeCallback(null)).toThrow("Expected a pointer");
  expect(() => Bun.FFI.closeCallback(undefined)).toThrow("Expected a pointer");
  expect(() => Bun.FFI.closeCallback(0)).toThrow("Expected a non-null pointer");
});
