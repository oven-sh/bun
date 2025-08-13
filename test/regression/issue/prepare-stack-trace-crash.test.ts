import { test, expect } from "bun:test";

test("Error.prepareStackTrace should not crash when stacktrace parameter is not an array", () => {
  const e = new Error("test message");
  
  // Test with undefined as second argument
  expect(() => {
    const result = Error.prepareStackTrace(e);
    expect(typeof result).toBe("string");
    expect(result).toBe("Error: test message");
  }).not.toThrow();

  // Test with null as second argument
  expect(() => {
    const result = Error.prepareStackTrace(e, null);
    expect(typeof result).toBe("string");
    expect(result).toBe("Error: test message");
  }).not.toThrow();

  // Test with number as second argument
  expect(() => {
    const result = Error.prepareStackTrace(e, 123);
    expect(typeof result).toBe("string");
    expect(result).toBe("Error: test message");
  }).not.toThrow();

  // Test with string as second argument
  expect(() => {
    const result = Error.prepareStackTrace(e, "not an array");
    expect(typeof result).toBe("string");
    expect(result).toBe("Error: test message");
  }).not.toThrow();

  // Test with object as second argument
  expect(() => {
    const result = Error.prepareStackTrace(e, {});
    expect(typeof result).toBe("string");
    expect(result).toBe("Error: test message");
  }).not.toThrow();
});

test("Error.prepareStackTrace should work with empty message", () => {
  const e = new Error("");
  
  expect(() => {
    const result = Error.prepareStackTrace(e);
    expect(typeof result).toBe("string");
    expect(result).toBe("Error");
  }).not.toThrow();
});

test("Error.prepareStackTrace should work with no message", () => {
  const e = new Error();
  
  expect(() => {
    const result = Error.prepareStackTrace(e);
    expect(typeof result).toBe("string");
    expect(result).toBe("Error");
  }).not.toThrow();
});