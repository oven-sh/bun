// STATUS: PASS
import { expect, it } from "bun:test";

it("should pass", () => {
  // EXPECTNOT: toBe.match.test.js:6:2
  expect(1).toBe(1);
});

// EXPECT: 1 pass
// EXPECT: 0 fail
