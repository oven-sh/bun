import { vi, test, beforeAll, afterAll, expect } from "vitest";

beforeAll(() => vi.useFakeTimers());
afterAll(() => vi.useRealTimers());

test.each(Array.from({ length: 2 }).map((_, i) => i))("runAllTimers runs in order of time", i => {
  const order: string[] = [];
  const orderNum: number[] = [];

  let base = 0;
  const time = (d: number, l: string, cb: () => void) => {
    const start = base;
    setTimeout(() => {
      orderNum.push(start + d);
      order.push(`${start + d}${l ? ` (${l})` : ""}`);
      if (base != 0) throw new Error("base is not 0");
      base = start + d;
      cb();
      base = 0;
    }, d);
  };

  time(1000, "", () => {
    time(500, "", () => {});
    time(1500, "", () => {});
  });
  time(500, "", () => {
    time(600, "", () => {});
    time(0, "500 + 0", () => {});
  });
  time(2000, "", () => {});
  time(0, "zero 1", () => {
    time(0, "zero 1.1", () => {});
    time(0, "zero 1.2", () => {});
  });
  time(0, "zero 2", () => {
    time(0, "zero 2.1", () => {});
    time(0, "zero 2.2", () => {});
  });
  let intervalCount = 0;
  const interval = setInterval(() => {
    if (intervalCount > 3) clearInterval(interval);
    intervalCount += 1;
    orderNum.push(intervalCount * 499);
    order.push(`${intervalCount * 499} (interval)`);
    setTimeout(() => {
      orderNum.push(intervalCount * 499 + 25);
      order.push(`${intervalCount * 499 + 25} (interval + 25)`);
    }, 25);
  }, 499);

  vi.runAllTimers();

  expect(orderNum).toEqual(orderNum.toSorted((a, b) => a - b));
  expect(order).toMatchInlineSnapshot(`
    [
      "0 (zero 1)",
      "0 (zero 2)",
      "0 (zero 1.1)",
      "0 (zero 1.2)",
      "0 (zero 2.1)",
      "0 (zero 2.2)",
      "499 (interval)",
      "500",
      "500 (500 + 0)",
      "524 (interval + 25)",
      "998 (interval)",
      "1000",
      "1023 (interval + 25)",
      "1100",
      "1497 (interval)",
      "1500",
      "1522 (interval + 25)",
      "1996 (interval)",
      "2000",
      "2021 (interval + 25)",
      "2495 (interval)",
      "2500",
      "2520 (interval + 25)",
    ]
  `);
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
  // TODO: check for memory leak of the callbacks
});
