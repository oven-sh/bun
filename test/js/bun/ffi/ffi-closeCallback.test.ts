import { describe, expect, test } from "bun:test";

describe("FFI.closeCallback", () => {
  test("throws on invalid arguments instead of crashing", () => {
    const closeCallback = (Bun as any).FFI.closeCallback;
    // closeCallback is an internal function that expects a pointer to a compiled
    // FFI callback context. Passing invalid values should throw, not segfault.
    const invalidArgs = [208, 0, -1, null, undefined, "hello", {}, [], NaN, Infinity, true, false];
    for (const arg of invalidArgs) {
      expect(() => closeCallback(arg)).toThrow("Expected a FFI callback context");
    }
  });
});
