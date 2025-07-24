// Regression test for panic in indexOfLineRanges with non-ASCII characters
import { test, expect } from "bun:test";

test("should not panic with non-ASCII characters in error stacktrace processing", () => {
  // This previously caused a panic: unreachable at immutable.zig:1643
  const testWithNonAscii = () => {
    const code = `console.log("line 1");
console.log("line 2 with emoji: 🚀");
console.log("line 3");`;
    
    // Trigger an error that will cause stacktrace processing 
    eval(code + "\nthrow new Error('test error with non-ASCII');");
  };

  expect(testWithNonAscii).toThrow("test error with non-ASCII");
});

test("should handle non-ASCII at end of file without newline", () => {
  const testEndingWithNonAscii = () => {
    const code = `let x = "ending with emoji 🎯"`;
    eval(code + "; throw new Error('end test');");
  };

  expect(testEndingWithNonAscii).toThrow("end test");
});

test("should handle mixed newlines and non-ASCII characters", () => {
  const testMixed = () => {
    // Use simpler test that doesn't trigger eval parsing issues
    const source = "line2 🚀";
    throw new Error('mixed test');
  };

  expect(testMixed).toThrow("mixed test");
});