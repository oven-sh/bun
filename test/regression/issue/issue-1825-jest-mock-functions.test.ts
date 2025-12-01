import { describe, expect, jest, test } from "bun:test";

describe("Jest mock functions from issue #1825", () => {
  test("jest.mock should be available and work with factory function", () => {
    // Should not throw - jest.mock should be available
    expect(() => {
      jest.mock("fs", () => ({ readFile: jest.fn() }));
    }).not.toThrow();
  });

  test("jest.resetAllMocks should be available and not throw", () => {
    const mockFn = jest.fn();
    mockFn();
    expect(mockFn).toHaveBeenCalledTimes(1);

    // Should not throw - jest.resetAllMocks should be available
    expect(() => {
      jest.resetAllMocks();
    }).not.toThrow();
  });

  test("mockReturnThis should return the mock function itself", () => {
    const mockFn = jest.fn();
    const result = mockFn.mockReturnThis();

    // mockReturnThis should return the mock function itself
    expect(result).toBe(mockFn);
  });
});
