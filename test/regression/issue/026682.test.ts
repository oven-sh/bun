import { expect, test } from "bun:test";

// Test for https://github.com/oven-sh/bun/issues/26682
// String.prototype.slice() should have O(1) complexity on rope strings,
// not O(n) which causes O(n²) overall when iterating through a concatenated string.
//
// The fix for this issue is in the WebKit fork: https://github.com/oven-sh/WebKit/pull/154
// These tests are marked as todo until the WebKit fix is merged and the commit hash is updated.

test.todo("rope string slice should be efficient (not O(n²))", () => {
  // Create a rope string by concatenation
  // Using 50,000 iterations - enough to detect O(n²) behavior
  const iterations = 50000;
  let s = "";
  for (let i = 0; i < iterations; i++) s += "A";

  // Test slice performance
  const start = performance.now();
  const m = new Map();
  for (let i = 0; i < iterations; i++) {
    const k = s.slice(i, i + 1);
    m.set(k, 1);
  }
  const elapsed = performance.now() - start;

  // With O(n²) complexity, this would take several seconds (>5000ms)
  // With O(n) complexity, this should complete in under 500ms
  // We use a generous threshold to avoid flakiness while still catching the regression
  expect(elapsed).toBeLessThan(2000);
});

test.todo("rope string slice across multiple fibers should be efficient", () => {
  // Create a rope string with multiple concatenations to ensure multiple fibers
  const chunkSize = 10000;
  let s = "";
  for (let i = 0; i < 5; i++) {
    let chunk = "";
    for (let j = 0; j < chunkSize; j++) {
      chunk += String.fromCharCode(65 + i); // A, B, C, D, E
    }
    s += chunk;
  }

  // Test slices that cross fiber boundaries
  const start = performance.now();
  const slices: string[] = [];

  // Take slices near fiber boundaries (every 10000 chars)
  for (let i = 0; i < s.length - 100; i += 1000) {
    slices.push(s.slice(i, i + 100));
  }
  const elapsed = performance.now() - start;

  // Verify correctness
  expect(slices.length).toBeGreaterThan(0);
  expect(slices[0].length).toBe(100);

  // Performance check - should be fast
  expect(elapsed).toBeLessThan(1000);
});

test("rope string charAt and bracket notation should be efficient", () => {
  // This test verifies that charAt and bracket notation remain efficient
  // (they were not affected by the bug, but we should ensure they stay fast)
  const iterations = 50000;
  let s = "";
  for (let i = 0; i < iterations; i++) s += "A";

  const start = performance.now();
  let count = 0;
  for (let i = 0; i < iterations; i++) {
    if (s[i] === "A") count++;
  }
  const elapsed = performance.now() - start;

  expect(count).toBe(iterations);
  expect(elapsed).toBeLessThan(500);
});
