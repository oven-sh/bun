import { expect, it } from "bun:test";

it("performance.now() should be monotonic", () => {
  const first = performance.now();
  const second = performance.now();
  const third = performance.now();
  const fourth = performance.now();
  const fifth = performance.now();
  const sixth = performance.now();
  expect(first < second).toBe(true);
  expect(second < third).toBe(true);
  expect(third < fourth).toBe(true);
  expect(fourth < fifth).toBe(true);
  expect(fifth < sixth).toBe(true);
  expect(Bun.nanoseconds() > 0).toBe(true);
  expect(Bun.nanoseconds() > sixth).toBe(true);
  expect(typeof Bun.nanoseconds() === "number").toBe(true);
});

it("performance.timeOrigin + performance.now() should be similar to Date.now()", () => {
  expect(Math.abs(performance.timeOrigin + performance.now() - Date.now()) < 1000).toBe(true);
});

it("performance.now() should never return NaN", () => {
  for (let i = 0; i < 10e6; i++) {
    const now = performance.now()
    expect(Number.isNaN(now)).toBe(false);
  }
});
