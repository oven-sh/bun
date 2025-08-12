import { expect as jestExpect, test as jestTest } from "@jest/globals";

// Test that bun's test globals are still available even with @jest/globals import
test('should have bun test globals available with @jest/globals import', () => {
  expect(typeof test).toBe('function');
  expect(typeof expect).toBe('function');  
  expect(typeof describe).toBe('function');
});

// Test that jest imports also work
jestTest('jest imports should work too', () => {
  jestExpect(1 + 1).toBe(2);
});