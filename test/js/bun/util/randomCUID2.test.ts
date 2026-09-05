import { randomCUID2 } from "bun";
import { describe, expect, test } from "bun:test";

const CUID2_PATTERN = /^[a-z][0-9a-z]+$/;

describe("randomCUID2", () => {
  test("returns canonical CUID2 strings from the Bun namespace and bun module", () => {
    for (const id of [Bun.randomCUID2(), randomCUID2()]) {
      expect(id).toBeTypeOf("string");
      expect(id).toHaveLength(24);
      expect(id).toMatch(CUID2_PATTERN);
    }
  });

  describe.each([2, 3, 10, 24, 32])("supports length %d", length => {
    test("returns the requested length", () => {
      const id = Bun.randomCUID2(length);
      expect(id).toHaveLength(length);
      expect(id).toMatch(CUID2_PATTERN);
    });
  });

  test("uses the default length for undefined", () => {
    expect(Bun.randomCUID2(undefined)).toHaveLength(24);
  });

  test("generates unique values", () => {
    const ids = Array.from({ length: 10_000 }, () => Bun.randomCUID2());
    expect(new Set(ids).size).toBe(ids.length);
  });

  describe.each([
    ["negative", -1],
    ["zero", 0],
    ["one", 1],
    ["above 32", 33],
    ["NaN", NaN],
    ["positive infinity", Infinity],
    ["negative infinity", -Infinity],
  ])("rejects %s", (_, length) => {
    test("throws a RangeError", () => {
      expect(() => Bun.randomCUID2(length)).toThrow(RangeError);
    });
  });

  test("rejects fractional and non-numeric lengths", () => {
    expect(() => Bun.randomCUID2(23.5)).toThrow(TypeError);
    expect(() => Bun.randomCUID2(null as any)).toThrow(TypeError);
    expect(() => Bun.randomCUID2("24" as any)).toThrow(TypeError);
    expect(() => Bun.randomCUID2(24n as any)).toThrow(TypeError);
  });
});
