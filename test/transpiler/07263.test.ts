import { test, expect } from "bun:test";

export const Infinity = 1 / 0;

test("Infinity", async () => {
  expect(Infinity).toBe(globalThis.Infinity);
  const Mod = await import(import.meta.path);
  expect(Mod.Infinity).toBe(1 / 0);
  expect(Mod.Infinity).toBe(globalThis.Infinity);
});
