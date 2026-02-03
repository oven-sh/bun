import { test, expect } from "bun:test";

test("TextDecoder accepts undefined as encoding parameter", () => {
  // Issue #5211: TextDecoder should accept undefined and default to UTF-8
  const decoder1 = new TextDecoder(undefined);
  const decoder2 = new TextDecoder();
  
  expect(decoder1.encoding).toBe("utf-8");
  expect(decoder2.encoding).toBe("utf-8");
  
  // Test that they behave identically
  const testData = new Uint8Array([72, 101, 108, 108, 111]); // "Hello"
  const result1 = decoder1.decode(testData);
  const result2 = decoder2.decode(testData);
  
  expect(result1).toBe(result2);
  expect(result1).toBe("Hello");
});

test("TextDecoder accepts null as encoding parameter", () => {
  // Should also accept null and default to UTF-8
  const decoder = new TextDecoder(null);
  expect(decoder.encoding).toBe("utf-8");
});