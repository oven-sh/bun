import { describe, expect, test } from "bun:test";
import { diff } from "node:util";

describe("util.diff", () => {
  test("identical inputs", () => {
    expect(diff("abc", "abc")).toEqual([]);
  });

  test("string replacement", () => {
    expect(diff("abc", "abd")).toEqual([
      [0, "a"],
      [0, "b"],
      [1, "c"],
      [-1, "d"],
    ]);
  });

  test("string insertion/deletion", () => {
    expect(diff("", "a")).toEqual([[-1, "a"]]);
    expect(diff("a", "")).toEqual([[1, "a"]]);
  });

  test("arrays of strings", () => {
    expect(diff(["a", "b", "c"], ["a", "b", "d"])).toEqual([
      [0, "a"],
      [0, "b"],
      [1, "c"],
      [-1, "d"],
    ]);
  });

  test("throws on non-string values", () => {
    expect(() => diff(1, 2)).toThrow();
    expect(() => diff(["a", 1], ["a"])).toThrow();
  });
});