// Test for https://github.com/oven-sh/bun/issues/15673
// `Bun.deepMatch` always returns `true` when comparing `Set` and `Map` instances with different number of entries

import { test, expect } from "bun:test";

test.each([
  // Maps with different number of entries should return false
  [
    new Map<number, number>([ [1, 2], [2, 3], [3, 4] ]),
    new Map<number, number>([ [1, 2], [2, 3] ]),
  ],
  [
    new Map<number, number>([ [1, 2], [2, 3], [3, 4] ]),
    new Map<number, number>([ [1, 2], [2, 3], [3, 4], [4, 5] ]),
  ],
  // Sets with different number of entries should return false  
  [
    new Set([1, 2, 3]),
    new Set([1, 2]),
  ],
  [
    new Set([1, 2, 3]),
    new Set([4, 5, 6]),
  ],
])("Bun.deepMatch should return false for Maps/Sets with different contents (%p, %p)", (a, b) => {
  expect(Bun.deepMatch(a, b)).toBe(false);
});

// Additional cases that were not working in the original issue
test.each([
  [new Map([ ["foo", 1] ]), new Map([ [ "bar", 1 ] ])],
  [new Map([ ["foo", 1] ]), new Map([ [ "foo", 2 ] ])],
])("Bun.deepMatch should return false for Maps with different keys/values (%p, %p)", (a, b) => {
  expect(Bun.deepMatch(a, b)).toBe(false);
});

// These cases should also return false (different sizes, even if subset)
test.each([
  [new Map([ ["foo", 1] ]), new Map([ [ "foo", 1 ], ["bar", 2] ])],
  [new Set([1, 2]), new Set([1, 2, 3])],
])("Bun.deepMatch should return false for Maps/Sets with different sizes (%p, %p)", (a, b) => {
  expect(Bun.deepMatch(a, b)).toBe(false);
});