import { describe, expect, test } from "bun:test";
import { isArm64, isWindows } from "harness";

const isFFIUnavailable = isWindows && isArm64;

describe.skipIf(isFFIUnavailable)("FFI viewSource", () => {
  test("rejects non-object symbol descriptor values", () => {
    // Each symbol descriptor must be an object like { args: [...], returns: "void" }.
    // Previously, non-object values like numbers or strings would cause a debug
    // assertion failure (crash) in generateSymbolForFunction.
    // viewSource currently returns the TypeError rather than throwing it; this
    // test used to rely on toThrow() accepting a returned Error, which it no
    // longer does.
    for (const value of [42, "not_an_object", true]) {
      const result = Bun.FFI.viewSource({ myFunc: value });
      expect(result).toBeInstanceOf(TypeError);
      expect((result as TypeError).message).toContain("Expected an object");
    }
  });
});
