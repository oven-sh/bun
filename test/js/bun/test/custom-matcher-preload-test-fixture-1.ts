import { expect } from "bun:test";

expect.extend({
  toBeGoat(actual, expected, message) {
    return {
      pass: actual === "goat",
      message: () => `expected ${actual} to be goat`,
    };
  },
});
