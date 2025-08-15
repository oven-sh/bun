// Test for process.env value stringification compatibility with Node.js
// This tests Bun's behavior to ensure it matches Node.js exactly
import { test, expect } from "bun:test";

test("process.env converts all values to strings like Node.js", () => {
  // Test various value types that should be converted to strings
  const testCases = [
    { value: undefined, expected: "undefined", description: "undefined" },
    { value: null, expected: "null", description: "null" },
    { value: true, expected: "true", description: "boolean true" },
    { value: false, expected: "false", description: "boolean false" },
    { value: 0, expected: "0", description: "number 0" },
    { value: 123, expected: "123", description: "positive number" },
    { value: -456, expected: "-456", description: "negative number" },
    { value: 3.14, expected: "3.14", description: "decimal number" },
    { value: NaN, expected: "NaN", description: "NaN" },
    { value: Infinity, expected: "Infinity", description: "Infinity" },
    { value: -Infinity, expected: "-Infinity", description: "-Infinity" },
    { value: "", expected: "", description: "empty string" },
    { value: "hello", expected: "hello", description: "regular string" },
    { value: {}, expected: "[object Object]", description: "empty object" },
    { value: [], expected: "", description: "empty array" },
    { value: [1, 2, 3], expected: "1,2,3", description: "array with values" },
    { value: { foo: "bar" }, expected: "[object Object]", description: "object with properties" },
    { value: function() { return "test"; }, expected: 'function() { return "test"; }', description: "function" },
  ];

  testCases.forEach(({ value, expected, description }, index) => {
    const key = `TEST_STRINGIFY_${index}`;
    
    // Clean up any existing value
    delete process.env[key];
    
    // Set the value
    process.env[key] = value as any;
    
    // Check the result
    const result = process.env[key];
    expect(result).toBe(expected);
    expect(typeof result).toBe("string");
    
    // Clean up
    delete process.env[key];
  });
});

test("process.env Symbol assignment throws error like Node.js", () => {
  const key = "TEST_SYMBOL";
  const symbolValue = Symbol("test");
  
  expect(() => {
    process.env[key] = symbolValue as any;
  }).toThrow("Cannot convert a Symbol value to a string");
});

test("process.env undefined vs delete behavior", () => {
  const key1 = "TEST_UNDEFINED_BEHAVIOR";
  const key2 = "TEST_DELETE_BEHAVIOR";
  
  // Set initial values
  process.env[key1] = "initial";
  process.env[key2] = "initial";
  
  // Test setting to undefined vs delete
  process.env[key1] = undefined;
  delete process.env[key2];
  
  // After setting to undefined: property exists with string "undefined"
  expect(process.env[key1]).toBe("undefined");
  expect(typeof process.env[key1]).toBe("string");
  expect(Object.hasOwnProperty.call(process.env, key1)).toBe(true);
  
  // After delete: property doesn't exist, returns undefined
  expect(process.env[key2]).toBe(undefined);
  expect(typeof process.env[key2]).toBe("undefined");
  expect(Object.hasOwnProperty.call(process.env, key2)).toBe(false);
  
  // Clean up
  delete process.env[key1];
});

test("process.env string conversion matches String() behavior", () => {
  const testValues = [
    undefined, null, true, false, 0, 123, -456, 3.14, NaN, Infinity, -Infinity,
    "", "hello", {}, [], [1, 2, 3], { foo: "bar" },
    function() { return "test"; }
  ];
  
  testValues.forEach((value, index) => {
    const key = `TEST_STRING_CONVERSION_${index}`;
    
    // Set the value in process.env
    process.env[key] = value as any;
    
    // Should match JavaScript's String() conversion
    expect(process.env[key]).toBe(String(value));
    
    // Clean up
    delete process.env[key];
  });
});