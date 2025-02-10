import { describe, expect, test } from "bun:test";

function add(a: number, b: number) {
  return a + b;
}

let functionBlockRan = false;
let stringBlockRan = false;

describe("blocks should handle both a string or function for the first arg", () => {
  describe(add, () => {
    test("should pass", () => {
      functionBlockRan = true;
      expect(true).toBe(true);
    });
  });

  describe("also here", () => {
    test("Should also pass", () => {
      stringBlockRan = true;
      expect(true).toBe(true);
    });
  });

  // Add a final test to verify both blocks ran
  test("both blocks should have run", () => {
    expect(functionBlockRan).toBe(true);
    expect(stringBlockRan).toBe(true);
  });
});
