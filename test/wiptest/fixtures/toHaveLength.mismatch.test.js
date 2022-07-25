// STATUS: FAIL
import { expect, it } from "bun:test";

it("should work with arrays", () => {
  // EXPECT: toHaveLength.mismatch.test.js:6:2
  expect(["a", "b", "c"]).toHaveLength(2);
});

it("should work with strings", () => {
  // EXPECT: toHaveLength.mismatch.test.js:11:2
  expect("abcd").toHaveLength(5);
});

it("should work with arbitrary objects", () => {
  // EXPECT: toHaveLength.mismatch.test.js:16:2
  expect({ length: 42 }).toHaveLength(24);
});

// EXPECT: 0 pass
// EXPECT: 3 fail
