// STATUS: FAIL
import { expect, it } from "bun:test";

it("should fail", () => {
  // EXPECT: Expected: 2
  // EXPECT: Received: 1
  // EXPECT: toBe.mismatch.test.js:8:2
  expect(1).toBe(2);
});

// EXPECT: 0 pass
// EXPECT: 1 fail
