import { describe, expect, test } from "bun:test";
import { isWindows } from "harness";

describe.skipIf(isWindows)("process.setgroups", () => {
  test("does not crash when array has an accessor property", () => {
    const groups = [1, 2, 3];
    Object.defineProperty(groups, 1, {
      configurable: true,
      get: () => new Date(),
    });
    expect(() => process.setgroups(groups)).toThrow(TypeError);
  });

  test("propagates exceptions thrown from an accessor", () => {
    const groups = [1, 2, 3];
    Object.defineProperty(groups, 1, {
      configurable: true,
      get: () => {
        throw new Error("getter threw");
      },
    });
    expect(() => process.setgroups(groups)).toThrow("getter threw");
  });

  test("does not crash on a sparse array", () => {
    const groups = new Array(3);
    groups[0] = 1;
    expect(() => process.setgroups(groups)).toThrow(TypeError);
  });
});
