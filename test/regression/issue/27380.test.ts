import { expect, test } from "bun:test";

test("Map.prototype.getOrInsert", () => {
  const m = new Map<string, number>();

  // Insert new key
  expect(m.getOrInsert("a", 1)).toBe(1);
  expect(m.get("a")).toBe(1);

  // Return existing value
  expect(m.getOrInsert("a", 99)).toBe(1);
  expect(m.get("a")).toBe(1);
});

test("Map.prototype.getOrInsertComputed", () => {
  const m = new Map<string, string>();

  // Insert computed value for new key
  expect(m.getOrInsertComputed("key", k => k + "_value")).toBe("key_value");
  expect(m.get("key")).toBe("key_value");

  // Return existing value, callback not called
  let called = false;
  expect(
    m.getOrInsertComputed("key", () => {
      called = true;
      return "other";
    }),
  ).toBe("key_value");
  expect(called).toBe(false);
});

test("WeakMap.prototype.getOrInsert", () => {
  const wm = new WeakMap<object, string>();
  const obj = {};

  expect(wm.getOrInsert(obj, "value")).toBe("value");
  expect(wm.getOrInsert(obj, "other")).toBe("value");
});

test("WeakMap.prototype.getOrInsertComputed", () => {
  const wm = new WeakMap<object, number>();
  const obj = {};

  expect(wm.getOrInsertComputed(obj, () => 42)).toBe(42);
  expect(wm.getOrInsertComputed(obj, () => 99)).toBe(42);
});
