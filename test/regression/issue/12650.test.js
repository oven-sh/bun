import { describe, expect, it } from "bun:test";

// Custom class for testing
class CustomException extends Error {
  constructor(message) {
    super(message);
    this.name = "CustomException";
  }
}

describe("Test expect.toThrow(expect.any())", () => {
  it("should throw an error", () => {
    expect(() => {
      throw new CustomException("Custom error message");
    }).toThrow(expect.any(Error));
  });

  it("should throw a CustomException", () => {
    expect(() => {
      throw new CustomException("Custom error message");
    }).toThrow(expect.any(CustomException));
  });
});
