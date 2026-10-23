import { expect, test } from "bun:test";

test("Bun.JSON is the global JSON", async () => {
  expect(Bun.JSON).toBe(JSON);
  expect((await import("bun")).JSON).toBe(JSON);
  expect(Object.getOwnPropertyDescriptor(Bun, "JSON")).toEqual({
    value: JSON,
    writable: true,
    enumerable: true,
    configurable: false,
  });
});
