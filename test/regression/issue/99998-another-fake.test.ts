import { describe, expect, test } from "bun:test";

describe("Another fake test suite", () => {
  test("math should work", () => {
    expect(2 + 2).toBe(4);
  });

  test("this will fail on canary", () => {
    expect("hello").toBe("world");
  });

  test("arrays should match", () => {
    expect([1, 2, 3]).toEqual([1, 2, 3]);
  });
});
