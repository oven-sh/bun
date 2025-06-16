import { describe, expect, test } from "bun:test";
import { accessSync, constants, existsSync } from "node:fs";
import { platform } from "node:os";

// Test for Windows path length crash bug
// https://github.com/oven-sh/bun/issues/[ISSUE_NUMBER]
describe.skipIf(platform() !== "win32")("Windows long path handling", () => {
  test("existsSync should not crash with paths of length 49151", () => {
    const path = "A".repeat(49151);
    expect(() => existsSync(path)).not.toThrow();
    // Path too long should return false
    expect(existsSync(path)).toBe(false);
  });

  test("existsSync should not crash with paths of length 98302", () => {
    const path = "A".repeat(98302);
    expect(() => existsSync(path)).not.toThrow();
    // Path too long should return false
    expect(existsSync(path)).toBe(false);
  });

  test("existsSync should handle various edge case lengths", () => {
    const testLengths = [49150, 49151, 98302, 98303];

    for (const len of testLengths) {
      const path = "A".repeat(len);
      expect(() => existsSync(path)).not.toThrow();
      expect(existsSync(path)).toBe(false);
    }
  });

  test("accessSync should handle long paths gracefully", () => {
    const path = "A".repeat(49151);

    // Should throw ENAMETOOLONG error instead of crashing
    expect(() => accessSync(path, constants.F_OK)).toThrow();

    try {
      accessSync(path, constants.F_OK);
    } catch (err: any) {
      // Should get appropriate error, not a crash
      expect(err.code).toMatch(/ENAMETOOLONG|ENOENT/);
    }
  });

  test("empty paths should work correctly", () => {
    expect(existsSync("")).toBe(false);
    expect(() => accessSync("", constants.F_OK)).toThrow();
  });
});
