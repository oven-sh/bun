import { describe, test, expect, beforeEach, jest } from "bun:test";

// Example functions for testing toHaveReturnedWith
export function add(a: number, b: number): number {
  return a + b;
}

export function multiply(a: number, b: number): number {
  return a * b;
}

export function greet(name: string): string {
  return `Hello, ${name}!`;
}

export function getRandomNumber(): number {
  return Math.floor(Math.random() * 100);
}

export function createUser(name: string, age: number): { name: string; age: number } {
  return { name, age };
}

console.log("Hello via Bun!");

describe("toHaveReturnedWith Examples", () => {
  let mockAdd: ReturnType<typeof jest.fn>;
  let mockMultiply: ReturnType<typeof jest.fn>;
  let mockGreet: ReturnType<typeof jest.fn>;
  let mockGetRandomNumber: ReturnType<typeof jest.fn>;
  let mockCreateUser: ReturnType<typeof jest.fn>;

  beforeEach(() => {
    // Reset all mocks before each test
    mockAdd = jest.fn(add);
    mockMultiply = jest.fn(multiply);
    mockGreet = jest.fn(greet);
    mockGetRandomNumber = jest.fn(getRandomNumber);
    mockCreateUser = jest.fn(createUser);
  });

  describe("Success Cases - toHaveReturnedWith", () => {
    test("should pass when function returns expected number", () => {
      const result = mockAdd(2, 3);
      expect(mockAdd).toHaveReturnedWith(5);
      expect(result).toBe(5);
    });

    test("should pass when function returns expected string", () => {
      const result = mockGreet("Alice");
      expect(mockGreet).toHaveReturnedWith("Hello, Alice!");
      expect(result).toBe("Hello, Alice!");
    });

    test("should pass when function returns expected object", () => {
      const result = mockCreateUser("Bob", 30);
      expect(mockCreateUser).toHaveReturnedWith({ name: "Bob", age: 30 });
      expect(result).toEqual({ name: "Bob", age: 30 });
    });

    test("should pass when function returns expected value after multiple calls", () => {
      mockMultiply(2, 3); // Returns 6
      mockMultiply(4, 5); // Returns 20
      mockMultiply(1, 1); // Returns 1

      expect(mockMultiply).toHaveReturnedWith(6);
      expect(mockMultiply).toHaveReturnedWith(20);
      expect(mockMultiply).toHaveReturnedWith(1);
    });

    test("should pass with exact array match", () => {
      const mockArrayFunction = jest.fn(() => [1, 2, 3]);
      const result = mockArrayFunction();
      expect(mockArrayFunction).toHaveReturnedWith([1, 2, 3]);
      expect(result).toEqual([1, 2, 3]);
    });

    test("should pass with null return value", () => {
      const mockNullFunction = jest.fn(() => null);
      const result = mockNullFunction();
      expect(mockNullFunction).toHaveReturnedWith(null);
      expect(result).toBeNull();
    });

    test("should pass with undefined return value", () => {
      const mockUndefinedFunction = jest.fn(() => undefined);
      const result = mockUndefinedFunction();
      expect(mockUndefinedFunction).toHaveReturnedWith(undefined);
      expect(result).toBeUndefined();
    });
  });

  describe("Fail Cases - toHaveReturnedWith", () => {
    test("should fail when function returns different number", () => {
      const result = mockAdd(2, 3);
      // This will fail because add(2, 3) returns 5, not 10
      expect(() => {
        expect(mockAdd).toHaveReturnedWith(10);
      }).toThrow();
    });

    test("should fail when function returns different string", () => {
      const result = mockGreet("Alice");
      // This will fail because greet("Alice") returns "Hello, Alice!", not "Hi, Alice!"
      expect(() => {
        expect(mockGreet).toHaveReturnedWith("Hi, Alice!");
      }).toThrow();
    });

    test("should fail when function returns different object", () => {
      const result = mockCreateUser("Bob", 30);
      // This will fail because the returned object has different age
      expect(() => {
        expect(mockCreateUser).toHaveReturnedWith({ name: "Bob", age: 25 });
      }).toThrow();
    });

    test("should fail when function was never called", () => {
      // mockAdd was never called, so this will fail
      expect(() => {
        expect(mockAdd).toHaveReturnedWith(5);
      }).toThrow();
    });

    test("should fail when function returns different array", () => {
      const mockArrayFunction = jest.fn(() => [1, 2, 3]);
      const result = mockArrayFunction();
      // This will fail because the expected array is different
      expect(() => {
        expect(mockArrayFunction).toHaveReturnedWith([1, 2, 4]);
      }).toThrow();
    });

    test("should fail when expecting null but function returns value", () => {
      const result = mockAdd(2, 3);
      // This will fail because add returns 5, not null
      expect(() => {
        expect(mockAdd).toHaveReturnedWith(null);
      }).toThrow();
    });

    test("should fail when expecting value but function returns null", () => {
      const mockNullFunction = jest.fn(() => null);
      const result = mockNullFunction();
      // This will fail because function returns null, not 5
      expect(() => {
        expect(mockNullFunction).toHaveReturnedWith(5);
      }).toThrow();
    });
  });

  describe("Edge Cases and Advanced Examples", () => {
    test("should work with multiple return values in sequence", () => {
      mockAdd(1, 1); // Returns 2
      mockAdd(2, 2); // Returns 4
      mockAdd(3, 3); // Returns 6

      // All these should pass
      expect(mockAdd).toHaveReturnedWith(2);
      expect(mockAdd).toHaveReturnedWith(4);
      expect(mockAdd).toHaveReturnedWith(6);
    });

    test("should work with complex objects", () => {
      const mockComplexFunction = jest.fn(() => ({
        id: 1,
        name: "Test",
        metadata: {
          createdAt: "2024-01-01",
          tags: ["tag1", "tag2"],
        },
      }));

      const result = mockComplexFunction();
      expect(mockComplexFunction).toHaveReturnedWith({
        id: 1,
        name: "Test",
        metadata: {
          createdAt: "2024-01-01",
          tags: ["tag1", "tag2"],
        },
      });
    });

    test("should fail with partial object match", () => {
      const mockComplexFunction = jest.fn(() => ({
        id: 1,
        name: "Test",
        metadata: {
          createdAt: "2024-01-01",
          tags: ["tag1", "tag2"],
        },
      }));

      const result = mockComplexFunction();
      // This will fail because the expected object is missing the metadata property
      expect(() => {
        expect(mockComplexFunction).toHaveReturnedWith({
          id: 1,
          name: "Test",
        });
      }).toThrow();
    });

    test("should work with functions that return functions", () => {
      const mockFunctionFactory = jest.fn(() => (x: number) => x * 2);
      const result = mockFunctionFactory();

      expect(mockFunctionFactory).toHaveReturnedWith(expect.any(Function));
      expect(result(5)).toBe(10);
    });
  });

  describe("Common Mistakes and How to Avoid Them", () => {
    test("mistake: checking return value instead of using toHaveReturnedWith", () => {
      const result = mockAdd(2, 3);

      // ❌ Wrong way - checking the result directly
      expect(result).toBe(5);

      // ✅ Correct way - checking that the mock returned the expected value
      expect(mockAdd).toHaveReturnedWith(5);
    });

    test("mistake: not calling the function before checking toHaveReturnedWith", () => {
      // ❌ This will fail because the function was never called
      expect(() => {
        expect(mockAdd).toHaveReturnedWith(5);
      }).toThrow();

      // ✅ Correct way - call the function first
      mockAdd(2, 3);
      expect(mockAdd).toHaveReturnedWith(5);
    });

    test("mistake: using toHaveReturnedWith on non-mock functions", () => {
      // ❌ This won't work because add is not a mock
      const result = add(2, 3);
      expect(() => {
        expect(add).toHaveReturnedWith(5);
      }).toThrow();

      // ✅ Correct way - use the mock
      const mockResult = mockAdd(2, 3);
      expect(mockAdd).toHaveReturnedWith(5);
    });
  });
});
