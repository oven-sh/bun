// Regression test for issue #22161: Bun.color ansi-16 output is incorrect
// https://github.com/oven-sh/bun/issues/22161
import { test, expect } from "bun:test";
import { color } from "bun";

test("Bun.color ansi-16 should not contain control characters", () => {
  // Test colors that previously produced malformed escape sequences
  const testColors = [
    { name: 'Red', value: 0xFF0000, description: 'should not contain tab character' },
    { name: 'Blue', value: 0x0000FF, description: 'should not contain form feed character' },
    { name: 'Green', value: 0x00FF00, description: 'should not contain newline character' },
    { name: 'White', value: 0xFFFFFF, description: 'should produce valid escape sequence' },
  ];

  testColors.forEach(({ name, value, description }) => {
    const result = color(value, 'ansi-16');
    expect(result).toBeDefined();
    expect(typeof result).toBe('string');
    
    // The result should not contain control characters (ASCII 0-31 except escape at start)
    // Check that no control characters (except escape char at position 0) are present
    const hasInvalidControlChars = result!.split('').some((char, idx) => {
      const code = char.charCodeAt(0);
      // Allow escape character (27) at start, disallow other control chars (0-31)
      return idx > 0 && code >= 0 && code <= 31 && code !== 27;
    });
    
    expect(hasInvalidControlChars).toBe(false);
    
    // Should follow the pattern \x1b[38;5;<number>m
    expect(result).toMatch(/^\x1b\[38;5;\d+m$/);
    
    // Should specifically not contain problematic characters that were in the bug
    expect(result).not.toContain('\t'); // tab (ASCII 9)
    expect(result).not.toContain('\n'); // newline (ASCII 10) 
    expect(result).not.toContain('\f'); // form feed (ASCII 12)
    expect(result).not.toContain('\r'); // carriage return (ASCII 13)
  });
});

test("Bun.color ansi-16 produces expected format for specific values", () => {
  // Test specific color mappings to ensure proper formatting
  const cases = [
    { input: 0xFF0000, expectedPattern: /^\x1b\[38;5;9m$/ }, // Red -> bright red (index 9)
    { input: 0x0000FF, expectedPattern: /^\x1b\[38;5;12m$/ }, // Blue -> bright blue (index 12)
    { input: 0x00FF00, expectedPattern: /^\x1b\[38;5;10m$/ }, // Green -> bright green (index 10)
    { input: 0xFFFFFF, expectedPattern: /^\x1b\[38;5;15m$/ }, // White -> bright white (index 15)
  ];

  cases.forEach(({ input, expectedPattern }) => {
    const result = color(input, 'ansi-16');
    expect(result).toMatch(expectedPattern);
  });
});