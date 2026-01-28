import { expect, test } from "bun:test";

// Test for https://github.com/oven-sh/bun/issues/26534
// Array.filter (and other array methods) should not skip callbacks or return stale results
// when the callback captures a closure variable that changes between calls.
//
// This is a DFG JIT bug in JavaScriptCore where the JIT incorrectly memoizes filter results,
// ignoring that the callback's closure environment changes between iterations.
//
// The bug is timing-dependent and requires specific conditions to trigger:
// - JIT compilation warmup (multiple iterations)
// - Closure variables that change between array method calls
// - Memory pressure can increase the likelihood (--smol flag)
//
// Workaround: Set JSC_useDFGJIT=0 environment variable to disable DFG JIT.
//
// Note: This test may not reliably reproduce the bug in all environments because
// the original reproduction required a 6-second delay, dynamic imports, and memory pressure.
// The test documents the expected correct behavior.

test("Array.filter should call callback with changing closure variable", () => {
  // This reproduction is based on the minimal case from the issue.
  // The bug manifests when:
  // 1. Array.filter is called in a loop
  // 2. The callback captures a variable that changes each iteration
  // 3. The JIT incorrectly caches/memoizes the result and stops calling the callback

  // Create test data - enough items to trigger JIT compilation
  const items: { id: number; category: number }[] = [];
  for (let i = 0; i < 300; i++) {
    items.push({ id: i, category: Math.floor(i / 30) });
  }

  const categories = [0, 1, 2, 3, 4];

  for (const category of categories) {
    // This predicate captures the 'category' variable from the closure
    const matchesCategory = (item: { category: number }) => item.category === category;

    let callbackCount = 0;
    const filtered = items.filter(item => {
      callbackCount++;
      return matchesCategory(item);
    });

    const expected = items.filter(item => item.category === category).length;

    // Check that the callback was actually called for all items
    expect(callbackCount).toBe(items.length);

    // Check that the correct number of items were returned
    expect(filtered.length).toBe(expected);

    // Verify the returned items actually match the current category
    for (const item of filtered) {
      expect(item.category).toBe(category);
    }
  }
});

test("Array.map should call callback with changing closure variable", () => {
  // Similar test for Array.map to ensure other array methods aren't affected

  const items: number[] = [];
  for (let i = 0; i < 300; i++) {
    items.push(i);
  }

  const multipliers = [1, 2, 3, 4, 5];

  for (const multiplier of multipliers) {
    let callbackCount = 0;
    const mapped = items.map(item => {
      callbackCount++;
      return item * multiplier;
    });

    // Check that callback was called for all items
    expect(callbackCount).toBe(items.length);

    // Verify results match expected
    for (let idx = 0; idx < mapped.length; idx++) {
      expect(mapped[idx]).toBe(items[idx] * multiplier);
    }
  }
});

test("Array.some should call callback with changing closure variable", () => {
  const items: { id: number; value: number }[] = [];
  for (let i = 0; i < 300; i++) {
    items.push({ id: i, value: i % 10 });
  }

  const targets = [0, 1, 2, 3, 4];

  for (const target of targets) {
    let callbackCount = 0;
    const result = items.some(item => {
      callbackCount++;
      return item.value === target;
    });

    // some() should find a match (since we have items with value 0-9)
    expect(result).toBe(true);

    // Callback should be called at least once (may short-circuit on match)
    expect(callbackCount).toBeGreaterThan(0);
  }
});
