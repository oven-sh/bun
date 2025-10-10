import { vi, test, beforeAll, afterAll, expect } from "vitest";

beforeAll(() => vi.useFakeTimers());
afterAll(() => vi.useRealTimers());

class TimeHelper {
  base: number = 0;
  order: string[] = [];
  orderNum: number[] = [];
  time(d: number, l: string, cb: () => void) {
    const start = this.base;
    setTimeout(() => {
      this.addOrder(start + d, l);
      if (this.base != 0) throw new Error("base is not 0");
      this.base = start + d;
      cb();
      this.base = 0;
    }, d);
  }
  addOrder(d: number, l: string) {
    this.orderNum.push(d);
    this.order.push(`${d}${l ? ` (${l})` : ""}`);
  }
  expectOrder() {
    expect(this.orderNum).toEqual(this.orderNum.toSorted((a, b) => a - b));
    const order = this.order;
    this.order = [];
    return expect(order);
  }
}

test.each(["runAllTimers", "advanceTimersToNextTimer"])("%s runs in order of time", mode => {
  const tester = new TimeHelper();
  const time = tester.time.bind(tester);

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
    tester.addOrder(intervalCount * 499, "interval");
    setTimeout(() => {
      tester.addOrder(intervalCount * 499 + 25, "interval + 25");
    }, 25);
  }, 499);

  if (mode === "runAllTimers") {
    vi.runAllTimers();
  } else if (mode === "advanceTimersToNextTimer") {
    let orderLen = 0;
    while (true) {
      vi.advanceTimersToNextTimer();
      if (tester.order.length > orderLen) {
        expect(tester.order.length).toBe(orderLen + 1);
        orderLen = tester.order.length;
      } else if (tester.order.length === orderLen) {
        break;
      } else {
        expect.fail();
      }
    }
  }

  tester.expectOrder().toMatchInlineSnapshot(`
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
