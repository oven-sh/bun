import { expect, it } from "bun:test";

it("shadow realm works", () => {
  const red = new ShadowRealm();
  globalThis.someValue = 1;
  // Affects only the ShadowRealm's global
  const result = red.evaluate("globalThis.someValue = 2;");
  expect(globalThis.someValue).toBe(1);
  expect(result).toBe(2);
});
