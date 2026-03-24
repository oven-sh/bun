import { test, expect } from "bun:test";

test("Bun.TOML.parse with non-string input does not crash", () => {
  // Passing a constructor function instead of a string should throw, not crash.
  expect(() => Bun.TOML.parse(SharedArrayBuffer as any)).toThrow();
});

test("Bun.TOML.parse with non-string input followed by GC does not crash", () => {
  try {
    Bun.TOML.parse(SharedArrayBuffer as any);
  } catch (e) {
    // expected
  }
  Bun.gc(true);
});
