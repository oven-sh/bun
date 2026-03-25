import { expect, spyOn, test } from "bun:test";

test("spyOn with numeric index property does not crash", () => {
  const obj = { 0: "value" };
  const spy = spyOn(obj, "0" as any);
  expect(obj[0]).toBe("value");
  spy.mockRestore();
  expect(obj[0]).toBe("value");
});

test("spyOn with numeric index on callable property does not crash", () => {
  const obj = { 0: () => 42 };
  const spy = spyOn(obj, "0" as any);
  expect(obj[0]()).toBe(42);
  spy.mockRestore();
  expect(obj[0]()).toBe(42);
});
