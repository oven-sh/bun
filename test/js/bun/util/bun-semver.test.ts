import { expect, test } from "bun:test";

test("semver version comparison: 1.0.0 < 1.0.1", () => {
  const result = Bun.semver.order("1.0.0", "1.0.1");
  expect(result).toBe(-1);
});