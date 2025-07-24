import { beforeEach, describe, expect, jest, test } from "bun:test";

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

describe("toHaveLastReturnedWith Examples", () => {
  let mockAdd: ReturnType<typeof jest.fn>;
  let mockMultiply: ReturnType<typeof jest.fn>;
  let mockGreet: ReturnType<typeof jest.fn>;
  let mockGetRandomNumber: ReturnType<typeof jest.fn>;
  let mockCreateUser: ReturnType<typeof jest.fn>;
  let mockDrink: ReturnType<typeof jest.fn>;

  beforeEach(() => {
    // Reset all mocks before each test
    mockAdd = jest.fn(add);
    mockMultiply = jest.fn(multiply);
    mockGreet = jest.fn(greet);
    mockGetRandomNumber = jest.fn(getRandomNumber);
    mockCreateUser = jest.fn(createUser);
    mockDrink = jest.fn((beverage: { name: string }) => beverage.name);
  });

  describe("Success Cases - toHaveLastReturnedWith", () => {
    test("should pass when last call returns expected value", () => {
      mockAdd(1, 1); // Returns 2
      mockAdd(2, 3); // Returns 5
      mockAdd(3, 4); // Returns 7 - last call

      expect(mockAdd).toHaveLastReturnedWith(7);
    });

    test("should pass when last call returns expected string", () => {
      mockGreet("Alice"); // Returns "Hello, Alice!"
      mockGreet("Bob"); // Returns "Hello, Bob!"
      mockGreet("Carol"); // Returns "Hello, Carol!" - last call

      expect(mockGreet).toHaveLastReturnedWith("Hello, Carol!");
    });

    test("should pass when last call returns expected object", () => {
      mockCreateUser("Alice", 25);
      mockCreateUser("Bob", 30);
      mockCreateUser("Carol", 35); // Last call

      expect(mockCreateUser).toHaveLastReturnedWith({ name: "Carol", age: 35 });
    });

    test("drink returns La Croix (Orange) last", () => {
      const beverage1 = { name: "La Croix (Lemon)" };
      const beverage2 = { name: "La Croix (Orange)" };

      mockDrink(beverage1);
      mockDrink(beverage2);

      expect(mockDrink).toHaveLastReturnedWith("La Croix (Orange)");
    });

    test("should pass with single call", () => {
      mockMultiply(5, 6); // Only one call, returns 30

      expect(mockMultiply).toHaveLastReturnedWith(30);
    });

    test("should pass with null as last return value", () => {
      const mockNullFunction = jest.fn().mockReturnValueOnce(5).mockReturnValueOnce("test").mockReturnValueOnce(null);

      mockNullFunction();
      mockNullFunction();
      mockNullFunction(); // Returns null

      expect(mockNullFunction).toHaveLastReturnedWith(null);
    });

    test("should pass with undefined as last return value", () => {
      const mockUndefinedFunction = jest.fn().mockReturnValueOnce(10).mockReturnValueOnce(undefined);

      mockUndefinedFunction();
      mockUndefinedFunction(); // Returns undefined

      expect(mockUndefinedFunction).toHaveLastReturnedWith(undefined);
    });

    test("should pass with array as last return value", () => {
      const mockArrayFunction = jest.fn();
      mockArrayFunction.mockReturnValueOnce([1, 2]);
      mockArrayFunction.mockReturnValueOnce([3, 4, 5]);

      mockArrayFunction();
      mockArrayFunction(); // Returns [3, 4, 5]

      expect(mockArrayFunction).toHaveLastReturnedWith([3, 4, 5]);
    });
  });

  describe("Fail Cases - toHaveLastReturnedWith", () => {
    test("should fail when last call returns different value", () => {
      mockAdd(1, 1); // Returns 2
      mockAdd(2, 3); // Returns 5
      mockAdd(3, 4); // Returns 7 - last call

      // This will fail because last call returned 7, not 5
      expect(() => {
        expect(mockAdd).toHaveLastReturnedWith(5);
      }).toThrow();
    });

    test("should fail when checking non-last return value", () => {
      mockGreet("Alice"); // Returns "Hello, Alice!"
      mockGreet("Bob"); // Returns "Hello, Bob!" - last call

      // This will fail because last call returned "Hello, Bob!", not "Hello, Alice!"
      expect(() => {
        expect(mockGreet).toHaveLastReturnedWith("Hello, Alice!");
      }).toThrow();
    });

    test("should fail when function was never called", () => {
      // mockAdd was never called
      expect(() => {
        expect(mockAdd).toHaveLastReturnedWith(5);
      }).toThrow();
    });

    test("should fail when last call threw an error", () => {
      const mockThrowFunction = jest
        .fn()
        .mockReturnValueOnce(5)
        .mockImplementationOnce(() => {
          throw new Error("Test error");
        });

      mockThrowFunction(); // Returns 5

      // Last call will throw
      expect(() => {
        mockThrowFunction();
      }).toThrow("Test error");

      // This will fail because last call threw an error
      expect(() => {
        expect(mockThrowFunction).toHaveLastReturnedWith(5);
      }).toThrow();
    });

    test("should fail with wrong object in last call", () => {
      mockCreateUser("Alice", 25);
      mockCreateUser("Bob", 30); // Last call

      // This will fail because last call returned Bob, not Alice
      expect(() => {
        expect(mockCreateUser).toHaveLastReturnedWith({ name: "Alice", age: 25 });
      }).toThrow();
    });

    test("should fail with wrong array in last call", () => {
      const mockArrayFunction = jest.fn();
      mockArrayFunction.mockReturnValueOnce([1, 2]);
      mockArrayFunction.mockReturnValueOnce([3, 4, 5]);

      mockArrayFunction();
      mockArrayFunction(); // Returns [3, 4, 5]

      // This will fail because last call returned [3, 4, 5], not [1, 2]
      expect(() => {
        expect(mockArrayFunction).toHaveLastReturnedWith([1, 2]);
      }).toThrow();
    });
  });

  describe("Edge Cases - toHaveLastReturnedWith", () => {
    test("should work with functions returning functions", () => {
      const mockFunctionFactory = jest.fn();
      const fn1 = (x: number) => x * 2;
      const fn2 = (x: number) => x * 3;

      mockFunctionFactory.mockReturnValueOnce(fn1);
      mockFunctionFactory.mockReturnValueOnce(fn2);

      mockFunctionFactory();
      const lastResult = mockFunctionFactory(); // Returns fn2

      expect(mockFunctionFactory).toHaveLastReturnedWith(fn2);
      expect(lastResult(5)).toBe(15); // 5 * 3
    });

    test("should work with complex nested objects", () => {
      const mockComplexFunction = jest.fn();
      const obj1 = { id: 1, data: { nested: { value: 10 } } };
      const obj2 = { id: 2, data: { nested: { value: 20 } } };

      mockComplexFunction.mockReturnValueOnce(obj1);
      mockComplexFunction.mockReturnValueOnce(obj2);

      mockComplexFunction();
      mockComplexFunction(); // Returns obj2

      expect(mockComplexFunction).toHaveLastReturnedWith({
        id: 2,
        data: { nested: { value: 20 } },
      });
    });

    test("should distinguish between similar values in sequence", () => {
      mockAdd(1, 1); // Returns 2
      mockAdd(1, 1); // Returns 2
      mockAdd(2, 0); // Returns 2 - last call

      // All calls return 2, but toHaveLastReturnedWith should still pass
      expect(mockAdd).toHaveLastReturnedWith(2);
    });

    test("should work after many calls", () => {
      // Make 100 calls
      for (let i = 0; i < 100; i++) {
        mockMultiply(i, 2); // Returns i * 2
      }

      // Last call was mockMultiply(99, 2) which returns 198
      expect(mockMultiply).toHaveLastReturnedWith(198);
    });

    test("should handle symbol return values", () => {
      const sym1 = Symbol("first");
      const sym2 = Symbol("last");
      const mockSymbolFunction = jest.fn();

      mockSymbolFunction.mockReturnValueOnce(sym1);
      mockSymbolFunction.mockReturnValueOnce(sym2);

      mockSymbolFunction();
      mockSymbolFunction(); // Returns sym2

      expect(mockSymbolFunction).toHaveLastReturnedWith(sym2);
    });
  });

  describe("Comparison with toHaveReturnedWith", () => {
    test("toHaveReturnedWith checks any call, toHaveLastReturnedWith checks only last", () => {
      mockAdd(1, 1); // Returns 2
      mockAdd(2, 3); // Returns 5
      mockAdd(3, 4); // Returns 7 - last call

      // toHaveReturnedWith passes for any return value
      expect(mockAdd).toHaveReturnedWith(2);
      expect(mockAdd).toHaveReturnedWith(5);
      expect(mockAdd).toHaveReturnedWith(7);

      // toHaveLastReturnedWith only passes for the last return value
      expect(mockAdd).toHaveLastReturnedWith(7);
      expect(() => {
        expect(mockAdd).toHaveLastReturnedWith(2);
      }).toThrow();
      expect(() => {
        expect(mockAdd).toHaveLastReturnedWith(5);
      }).toThrow();
    });
  });
});
