import { test, expect } from "bun:test";

test.only("only", () => {
  expect(1 + 1).toBe(2);
});
