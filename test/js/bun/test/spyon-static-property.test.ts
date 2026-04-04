import { expect, spyOn, test } from "bun:test";

test("spyOn works on static hash table function properties", () => {
  const spy = spyOn(Bun, "gc");
  try {
    Bun.gc(true);
    expect(spy).toHaveBeenCalledTimes(1);
  } finally {
    spy.mockRestore();
  }
});

test("spyOn preserves correct attributes after mockRestore", () => {
  const spy = spyOn(Bun, "peek");
  spy.mockRestore();
  const p = Promise.resolve(42);
  expect(Bun.peek(p)).toBe(42);
});
