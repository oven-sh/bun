// Converted from Node.js test: test/parallel/test-process-env-deprecation.js
// Tests that assigning undefined to process.env converts to string "undefined"
import { test, expect } from "bun:test";

test("process.env undefined assignment converts to string", () => {
  // Make sure setting a valid environment variable works
  process.env.FOO = 'apple';
  expect(process.env.FOO).toBe('apple');
  
  // The main test: undefined should become string "undefined"
  process.env.ABC = undefined;
  expect(process.env.ABC).toBe('undefined');
  expect(typeof process.env.ABC).toBe('string');
  
  // Clean up
  delete process.env.FOO;
  delete process.env.ABC;
});