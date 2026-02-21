import { $ } from "bun";
import { describe, expect, test } from "bun:test";

describe("$.braces", () => {
  test("no-op", () => {
    const result = $.braces(`echo 123`);
    expect(result).toEqual(["echo 123"]);
  });

  test("2", () => {
    const result = $.braces(`echo {123,456}`);
    expect(result).toEqual(["echo 123", "echo 456"]);
  });

  test("3", () => {
    const result = $.braces(`echo {123,456,789}`);
    expect(result).toEqual(["echo 123", "echo 456", "echo 789"]);
  });

  test("nested", () => {
    const result = $.braces(`echo {123,{456,789}}`);
    expect(result).toEqual(["echo 123", "echo 456", "echo 789"]);
  });

  test("nested 2", () => {
    const result = $.braces(`echo {123,{456,789},abc}`);
    expect(result).toEqual(["echo 123", "echo 456", "echo 789", "echo abc"]);
  });

  test("very deeply nested", () => {
    const result = $.braces(`{1,{2,{3,{4,{5,{6,{7,{8,{9,{10,{11,{12,{13,{14,{15,{16,{17}}}}}}}}}}}}}}}}}`);
    expect(result).toEqual([
      "1",
      "2",
      "3",
      "4",
      "5",
      "6",
      "7",
      "8",
      "9",
      "10",
      "11",
      "12",
      "13",
      "14",
      "15",
      "16",
      "17",
    ]);
  });

  test("unicode", () => {
    const result = $.braces(`lol {😂,🫵,🤣}`);
    expect(result).toEqual(["lol 😂", "lol 🫵", "lol 🤣"]);
  });

  test("257 elements does not crash (u8 overflow regression)", () => {
    // Regression test: calculateExpandedAmount used a u8 counter that would
    // wrap at 256 elements, causing a heap buffer overflow in release builds.
    const elements = Array.from({ length: 257 }, (_, i) => String(i)).join(",");
    const result = $.braces(`{${elements}}`);
    expect(result.length).toBe(257);
    expect(result[0]).toBe("0");
    expect(result[256]).toBe("256");
  });

  test("256 elements does not crash", () => {
    const elements = Array.from({ length: 256 }, (_, i) => String(i)).join(",");
    const result = $.braces(`{${elements}}`);
    expect(result.length).toBe(256);
  });
});
