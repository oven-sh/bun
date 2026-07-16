import { describe, expect, test } from "bun:test";
import { isArm64, isWindows } from "harness";

const isFFIUnavailable = isWindows && isArm64;

describe.skipIf(isFFIUnavailable)("FFI viewSource", () => {
  test("rejects non-object symbol descriptor values", () => {
    // viewSource returns (rather than throws) a TypeError when a symbol descriptor is not an object.
    // Non-object descriptors previously crashed with a debug assertion in generateSymbolForFunction.
    for (const value of [42, "not_an_object", true]) {
      const result = Bun.FFI.viewSource({ myFunc: value });
      expect(result).toBeInstanceOf(TypeError);
      expect((result as TypeError).message).toContain("Expected an object");
    }
  });
});
