import { expect, test } from "bun:test";

// https://github.com/oven-sh/bun/issues/27014
test("Bun.stripANSI does not hang on non-ANSI control characters", () => {
  const s = "\u0016zo\u00BAd\u0019\u00E8\u00E0\u0013?\u00C1+\u0014d\u00D3\u00E9";
  const result = Bun.stripANSI(s);
  expect(result).toBe(s);
});
