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

describe("process.hrtime", () => {
  test("does not crash when array has an accessor property", () => {
    const time = [1, 2];
    Object.defineProperty(time, 0, {
      configurable: true,
      get: () => 0,
    });
    const result = process.hrtime(time);
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(2);
  });

  test("propagates exceptions thrown from an accessor", () => {
    const time = [1, 2];
    Object.defineProperty(time, 0, {
      configurable: true,
      get: () => {
        throw new Error("getter threw");
      },
    });
    expect(() => process.hrtime(time)).toThrow("getter threw");
  });
});
