import { expect, test } from "bun:test";

// This is a fake test to trigger the canary workflow - will be removed
test("this should fail on canary", () => {
  // This will fail because the feature doesn't exist in canary
  expect(1 + 1).toBe(3);
});

test("this should pass", () => {
  expect(true).toBe(true);
});
