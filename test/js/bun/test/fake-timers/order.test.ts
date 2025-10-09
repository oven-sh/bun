import { vi, test, beforeAll, afterAll, expect } from "vitest";

beforeAll(() => vi.useFakeTimers());
afterAll(() => vi.useRealTimers());

test("runAllTimers runs in order of time", () => {
  const order: number[] = [];

  setTimeout(() => {
    order.push(1000);
    setTimeout(() => {
      order.push(1000 + 500);
    }, 500);
    setTimeout(() => {
      order.push(1000 + 1500);
    }, 1500);
  }, 1000);
  setTimeout(() => {
    order.push(500);
  }, 500);
  setTimeout(() => {
    order.push(2000);
  }, 2000);

  vi.runAllTimers();

  expect(order).toEqual(order.toSorted((a, b) => a - b));
});

test("runAllTimers supports interval", () => {
  let ticks = 0;
  const interval = setInterval(() => {
    ticks += 1;
    if (ticks >= 10) clearInterval(interval);
  }, 25);

  vi.runAllTimers();

  expect(ticks).toBe(10);
});

test("fake timers clear after useRealTimers", () => {
  let ticks = 0;
  setTimeout(() => {
    ticks += 1;
  }, 10);
  expect(ticks).toBe(0);
  vi.useRealTimers();
  expect(ticks).toBe(0);
  vi.useFakeTimers();
  vi.runAllTimers();
  expect(ticks).toBe(0);
});
