import { describe, expect, test } from "bun:test";
import { isArm64, isWindows } from "harness";

const isFFIUnavailable = isWindows && isArm64;

describe.skipIf(isFFIUnavailable)("FFI viewSource", () => {
  test("throws TypeError for non-object symbol values", () => {
    const FFI = Bun.FFI;

    // Non-object values as symbol definitions should throw a TypeError.
    // Previously they would either crash (in debug builds) or silently
    // produce incorrect output (in release builds).
    expect(() => FFI.viewSource({ a: 42 })).toThrow(TypeError);
    expect(() => FFI.viewSource({ a: "hello" })).toThrow(TypeError);
    expect(() => FFI.viewSource({ a: true })).toThrow(TypeError);
    expect(() => FFI.viewSource({ a: null })).toThrow(TypeError);
    expect(() => FFI.viewSource({ a: undefined })).toThrow(TypeError);
  });
});
