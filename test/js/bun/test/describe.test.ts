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
      expect(true).toBeTrue();
    });
  });

  describe("also here", () => {
    test("Should also pass", () => {
      stringBlockRan = true;
      expect(true).toBeTrue();
    });
  });

  test("both blocks should have run", () => {
    expect(functionBlockRan).toBeTrue();
    expect(stringBlockRan).toBeTrue();
  });
});
