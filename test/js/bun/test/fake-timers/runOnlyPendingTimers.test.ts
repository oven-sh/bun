import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

beforeAll(() => vi.useFakeTimers());
afterAll(() => vi.useRealTimers());

describe("vi.runOnlyPendingTimers", () => {
  test("runs only timers that were pending when called", () => {
    let i = 0;
    setInterval(() => {
      i++;
    }, 50);

    vi.runOnlyPendingTimers();

    // Should have run exactly once, not the timer that was scheduled during execution
    expect(i).toBe(1);
  });

  test("does not run timers created during execution", () => {
    const order: number[] = [];

    setTimeout(() => {
      order.push(1);
      // This timer should NOT run in the same runOnlyPendingTimers call
      setTimeout(() => {
        order.push(2);
      }, 100);
    }, 100);

    vi.runOnlyPendingTimers();

    expect(order).toEqual([1]);

    // Now run again to execute the timer that was scheduled during the first execution
    vi.runOnlyPendingTimers();
    expect(order).toEqual([1, 2]);
  });

  test("runs multiple pending timers", () => {
    const order: number[] = [];

    setTimeout(() => order.push(1), 100);
    setTimeout(() => order.push(2), 200);
    setTimeout(() => order.push(3), 300);

    vi.runOnlyPendingTimers();

    expect(order).toEqual([1, 2, 3]);
  });

  test("handles nested setTimeout calls correctly", () => {
    const order: string[] = [];

    setTimeout(() => {
      order.push("outer1");
      setTimeout(() => {
        order.push("inner1");
      }, 50);
    }, 100);

    setTimeout(() => {
      order.push("outer2");
      setTimeout(() => {
        order.push("inner2");
      }, 50);
    }, 200);

    // First call: runs outer1 and outer2, but not inner1 and inner2
    vi.runOnlyPendingTimers();
    expect(order).toEqual(["outer1", "outer2"]);

    // Second call: runs inner1 and inner2
    vi.runOnlyPendingTimers();
    expect(order).toEqual(["outer1", "outer2", "inner1", "inner2"]);

    // Third call: no more timers
    vi.runOnlyPendingTimers();
    expect(order).toEqual(["outer1", "outer2", "inner1", "inner2"]);
  });

  test("handles setInterval correctly", () => {
    let count = 0;
    const interval = setInterval(() => {
      count++;
      if (count >= 3) clearInterval(interval);
    }, 50);

    // First call: runs once
    vi.runOnlyPendingTimers();
    expect(count).toBe(1);

    // Second call: runs the rescheduled interval
    vi.runOnlyPendingTimers();
    expect(count).toBe(2);

    // Third call: runs again and clears
    vi.runOnlyPendingTimers();
    expect(count).toBe(3);

    // Fourth call: no more timers
    vi.runOnlyPendingTimers();
    expect(count).toBe(3);
  });

  test("example from vitest documentation", () => {
    let i = 0;
    setInterval(() => {
      console.log(++i);
    }, 50);

    vi.runOnlyPendingTimers();

    // log: 1
    expect(i).toBe(1);
  });

  test("handles multiple intervals", () => {
    const order: string[] = [];

    const interval1 = setInterval(() => {
      order.push("interval1");
    }, 50);

    const interval2 = setInterval(() => {
      order.push("interval2");
    }, 100);

    // First call: both intervals fire once
    vi.runOnlyPendingTimers();
    expect(order).toEqual(["interval1", "interval2"]);

    // Second call: both intervals fire again (they were rescheduled)
    vi.runOnlyPendingTimers();
    expect(order).toEqual(["interval1", "interval2", "interval1", "interval2"]);

    clearInterval(interval1);
    clearInterval(interval2);
  });

  test("handles mixed setTimeout and setInterval", () => {
    const order: string[] = [];

    setTimeout(() => order.push("timeout"), 100);

    const interval = setInterval(() => {
      order.push("interval");
    }, 50);

    // First call: both fire
    vi.runOnlyPendingTimers();
    expect(order).toEqual(["interval", "timeout"]);

    // Second call: only interval fires (timeout doesn't repeat)
    vi.runOnlyPendingTimers();
    expect(order).toEqual(["interval", "timeout", "interval"]);

    clearInterval(interval);
  });

  test("handles timers with same delay", () => {
    const order: number[] = [];

    setTimeout(() => order.push(1), 100);
    setTimeout(() => order.push(2), 100);
    setTimeout(() => order.push(3), 100);

    vi.runOnlyPendingTimers();

    expect(order).toEqual([1, 2, 3]);
  });

  test("does not run timers with zero delay scheduled during execution", () => {
    const order: string[] = [];

    setTimeout(() => {
      order.push("outer");
      setTimeout(() => {
        order.push("inner");
      }, 0);
    }, 0);

    vi.runOnlyPendingTimers();
    expect(order).toEqual(["outer"]);

    vi.runOnlyPendingTimers();
    expect(order).toEqual(["outer", "inner"]);
  });

  test("works with order.test.ts TimeHelper pattern", () => {
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

    const tester = new TimeHelper();
    const time = tester.time.bind(tester);

    time(100, "first", () => {
      time(50, "nested1", () => {});
    });
    time(200, "second", () => {
      time(100, "nested2", () => {});
    });

    // First call: runs "first" and "second"
    vi.runOnlyPendingTimers();
    expect(tester.order).toEqual(["100 (first)", "200 (second)"]);
    tester.order = []; // Clear for next assertion

    // Second call: runs "nested1" and "nested2"
    vi.runOnlyPendingTimers();
    expect(tester.order).toEqual(["150 (nested1)", "300 (nested2)"]);
    tester.order = []; // Clear for next assertion

    // Third call: no more timers
    vi.runOnlyPendingTimers();
    expect(tester.order).toEqual([]);
  });
});
