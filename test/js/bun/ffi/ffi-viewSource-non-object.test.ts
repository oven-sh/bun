import { expect, test } from "bun:test";

test("FFI.viewSource throws TypeError for non-object symbol values", () => {
  // Non-object values as symbol definitions should throw a TypeError.
  // Previously they would either crash (in debug builds) or silently
  // produce incorrect output (in release builds).
  expect(() => Bun.FFI.viewSource({ a: 42 })).toThrow(TypeError);
  expect(() => Bun.FFI.viewSource({ a: "hello" })).toThrow(TypeError);
  expect(() => Bun.FFI.viewSource({ a: true })).toThrow(TypeError);
  expect(() => Bun.FFI.viewSource({ a: null })).toThrow(TypeError);
  expect(() => Bun.FFI.viewSource({ a: undefined })).toThrow(TypeError);
});
