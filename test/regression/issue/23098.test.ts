import { test, expect } from "bun:test";
import { inspect } from "node:util";

test("util.inspect formats negative fractional numbers correctly with numericSeparator: true (#23098)", () => {
  // Test the specific cases from the issue
  const values = [0.1234, -0.12, -0.123, -0.1234, -1.234];
  const text = inspect(values, { numericSeparator: true });
  expect(text).toBe("[ 0.123_4, -0.12, -0.123, -0.123_4, -1.234 ]");

  // Test individual values
  expect(inspect(-0.12, { numericSeparator: true })).toBe("-0.12");
  expect(inspect(-0.123, { numericSeparator: true })).toBe("-0.123");
  expect(inspect(-0.1234, { numericSeparator: true })).toBe("-0.123_4");
  expect(inspect(-0.123456789, { numericSeparator: true })).toBe("-0.123_456_789");

  // Test edge cases
  expect(inspect(-0, { numericSeparator: true })).toBe("-0");
  expect(inspect(0, { numericSeparator: true })).toBe("0");

  // Test scientific notation doesn't get separators
  expect(inspect(1.23e-10, { numericSeparator: true })).toBe("1.23e-10");
  expect(inspect(-1.23e-10, { numericSeparator: true })).toBe("-1.23e-10");
  expect(inspect(1.23e10, { numericSeparator: true })).toBe("12_300_000_000");
  expect(inspect(-1.23e10, { numericSeparator: true })).toBe("-12_300_000_000");

  // Test large negative numbers still work
  expect(inspect(-123456789.123456789, { numericSeparator: true })).toBe("-123_456_789.123_456_79");
});