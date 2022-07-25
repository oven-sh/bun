// STATUS: PASS
import { expect, it } from "bun:test";

it("should work with arrays", () => {
  // EXPECTNOT: toHaveLength.match.test.js:6:2
  expect(["a", "b", "c"]).toHaveLength(3);
});

it("should work with strings", () => {
  // EXPECTNOT: toHaveLength.match.test.js:11:2
  expect("abcd").toHaveLength(4);
});

it("should work with arbitrary objects", () => {
  // EXPECTNOT: toHaveLength.match.test.js:16:2
  expect({ length: 42 }).toHaveLength(42);
});

// EXPECT: 3 pass
// EXPECT: 0 fail
