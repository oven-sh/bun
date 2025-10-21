import { afterEach, describe, expect, test, vi } from "vitest";

afterEach(() => vi.useRealTimers());

class Order {
  items: { timePerf: number; timeDate: number; message: string }[] = [];
  startPerf: number = 0;
  startDate: number = 0;
  constructor() {
    this.startPerf = performance.now();
    this.startDate = Date.now();
  }
  add(message: string) {
    this.items.push({
      timePerf: performance.now() - this.startPerf,
      timeDate: Date.now() - this.startDate,
      message,
    });
  }

  takeOrderMessages(): string[] {
    const result = this.items.map(item => item.message);
    this.items = [];
    return result;
  }
}

test("fake timers", async () => {
  expect(vi.useFakeTimers()).toBe(vi);
  const order = new Order();
  setTimeout(() => {
    order.add("setTimeout");
  }, 0);
  expect(vi.useRealTimers()).toBe(vi);
  await Bun.sleep(10);
  expect(order.takeOrderMessages()).toEqual([]); // it was created as a fake timer, so it should not have triggered
});

describe("advanceTimersToNextTimer", () => {
  test("one setTimeout", async () => {
    const order = new Order();
    vi.useFakeTimers();
    setTimeout(() => {
      order.add("setTimeout");
    }, 0);
    expect(order.takeOrderMessages()).toEqual([]);
    vi.advanceTimersToNextTimer();
    expect(order.takeOrderMessages()).toEqual(["setTimeout"]);
    vi.useRealTimers();
  });
  test("setInterval", async () => {
    const order = new Order();
    vi.useFakeTimers();
    const interval = setInterval(() => {
      order.add("setInterval");
    }, 10);
    expect(order.takeOrderMessages()).toEqual([]);
    vi.advanceTimersToNextTimer();
    expect(order.takeOrderMessages()).toEqual(["setInterval"]);
    vi.advanceTimersToNextTimer();
    expect(order.takeOrderMessages()).toEqual(["setInterval"]);
    clearInterval(interval);
    vi.advanceTimersToNextTimer();
    expect(order.takeOrderMessages()).toEqual([]);
    vi.useRealTimers();
  });
  test("sorted timeouts", async () => {
    const order = new Order();
    vi.useFakeTimers();
    setTimeout(() => {
      order.add("10");
    }, 10);
    setTimeout(() => {
      order.add("9");
      setTimeout(() => order.add("14"), 5);
    }, 9);
    setTimeout(() => {
      order.add("20");
    }, 20);
    expect(order.takeOrderMessages()).toEqual([]);
    vi.advanceTimersToNextTimer();
    expect(order.takeOrderMessages()).toEqual(["9"]);
    vi.advanceTimersToNextTimer();
    expect(order.takeOrderMessages()).toEqual(["10"]);
    vi.advanceTimersToNextTimer();
    expect(order.takeOrderMessages()).toEqual(["14"]);
    vi.advanceTimersToNextTimer();
    expect(order.takeOrderMessages()).toEqual(["20"]);
    vi.advanceTimersToNextTimer();
    expect(order.takeOrderMessages()).toEqual([]);
    vi.useRealTimers();
  });
  test("alternating intervals", async () => {
    vi.useFakeTimers();
    const order = new Order();
    setInterval(() => {
      order.add("setInterval 1");
    }, 9);
    setInterval(() => {
      order.add("setInterval 2");
    }, 10);
    expect(order.takeOrderMessages()).toEqual([]);
    vi.advanceTimersToNextTimer();
    expect(order.takeOrderMessages()).toEqual(["setInterval 1"]);
    vi.advanceTimersToNextTimer();
    expect(order.takeOrderMessages()).toEqual(["setInterval 2"]);
    vi.advanceTimersToNextTimer();
    expect(order.takeOrderMessages()).toEqual(["setInterval 1"]);
    vi.advanceTimersToNextTimer();
    expect(order.takeOrderMessages()).toEqual(["setInterval 2"]);
    vi.useRealTimers();
  });
});
describe("advanceTimersByTime", () => {
  test("setInterval", () => {
    vi.useFakeTimers();
    const order = new Order();

    const interval = setInterval(() => {
      order.add("setInterval");
    }, 6);
    vi.advanceTimersByTime(10);
    expect(order.takeOrderMessages()).toEqual(["setInterval"]);
    vi.advanceTimersByTime(10);
    expect(order.takeOrderMessages()).toEqual(["setInterval", "setInterval"]);
    clearInterval(interval);
    vi.advanceTimersByTime(10);
    expect(order.takeOrderMessages()).toEqual([]);
    vi.useRealTimers();
  });
});
describe("runOnlyPendingTimers", () => {
  test("two setIntervals", () => {
    vi.useFakeTimers();
    const order = new Order();
    setInterval(() => order.add("100"), 100);
    setInterval(() => order.add("24"), 24);
    expect(order.takeOrderMessages()).toEqual([]);
    vi.runOnlyPendingTimers();
    expect(order.takeOrderMessages()).toEqual(["24", "24", "24", "24", "100"]);
    vi.runOnlyPendingTimers();
    expect(order.takeOrderMessages()).toEqual(["24", "24", "24", "24", "100"]);
    vi.useRealTimers();
  });
});
describe("runAllTimers", () => {
  test("two setIntervals", () => {
    vi.useFakeTimers();
    const order = new Order();
    setTimeout(() => {
      order.add("10");
    }, 10);
    setTimeout(() => {
      order.add("9");
      setTimeout(() => order.add("14"), 5);
    }, 9);
    setTimeout(() => {
      order.add("20");
    }, 20);
    expect(order.takeOrderMessages()).toEqual([]);
    vi.runAllTimers();
    expect(order.takeOrderMessages()).toEqual(["9", "10", "14", "20"]);
  });
});
describe("getTimerCount", () => {
  test("returns correct count of pending timers", () => {
    vi.useFakeTimers();
    expect(vi.getTimerCount()).toBe(0);
    setTimeout(() => {}, 10);
    expect(vi.getTimerCount()).toBe(1);
    setTimeout(() => {}, 20);
    expect(vi.getTimerCount()).toBe(2);
    const interval = setInterval(() => {}, 30);
    expect(vi.getTimerCount()).toBe(3);
    vi.advanceTimersToNextTimer();
    expect(vi.getTimerCount()).toBe(2);
    clearInterval(interval);
    expect(vi.getTimerCount()).toBe(1);
    vi.runAllTimers();
    expect(vi.getTimerCount()).toBe(0);
  });
  test("throws error if fake timers not active", () => {
    expect(() => vi.getTimerCount()).toThrow("Fake timers are not active");
  });
});
describe("clearAllTimers", () => {
  test("clears all pending timers", () => {
    vi.useFakeTimers();
    const order = new Order();
    setTimeout(() => order.add("1"), 10);
    setTimeout(() => order.add("2"), 20);
    setInterval(() => order.add("3"), 30);
    expect(vi.getTimerCount()).toBe(3);
    expect(vi.clearAllTimers()).toBe(vi);
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(100);
    expect(order.takeOrderMessages()).toEqual([]);
  });
  test("throws error if fake timers not active", () => {
    expect(() => vi.clearAllTimers()).toThrow("Fake timers are not active");
  });
});
describe("isFakeTimers", () => {
  test("returns true when fake timers are active", () => {
    expect(vi.isFakeTimers()).toBe(false);
    vi.useFakeTimers();
    expect(vi.isFakeTimers()).toBe(true);
    vi.useRealTimers();
    expect(vi.isFakeTimers()).toBe(false);
  });
  test("returns false by default", () => {
    expect(vi.isFakeTimers()).toBe(false);
  });
});
describe("Date.now() mocking", () => {
  test("Date.now() before and after vi.useFakeTimers() should be roughly equal", () => {
    const beforeFake = Date.now();
    vi.useFakeTimers();
    const afterFake = Date.now();

    // The fake time should start at approximately the real time
    // Allow a tolerance of 100ms for the time it takes to call useFakeTimers()
    const diff = Math.abs(afterFake - beforeFake);
    expect(diff).toBeLessThan(100);
  });

  test("Date.now() should be mocked when fake timers are active", () => {
    vi.useFakeTimers();
    const start = Date.now();

    // Advance time by 1000ms
    vi.advanceTimersByTime(1000);

    // Date.now() should reflect the advanced time
    expect(Date.now()).toBe(start + 1000);

    // Advance more time
    vi.advanceTimersByTime(500);
    expect(Date.now()).toBe(start + 1500);
  });

  test("Date.now() returns to real time when fake timers are disabled", () => {
    vi.useFakeTimers();
    const initialFakeTime = Date.now();
    vi.advanceTimersByTime(1000);
    const advancedFakeTime = Date.now();
    expect(advancedFakeTime).toBe(initialFakeTime + 1000);

    vi.useRealTimers();

    // After disabling fake timers, Date.now() should return real time
    // The real time should be close to when we started (within a few ms)
    // It should NOT be the advanced fake time
    const realNow = Date.now();
    // Allow 1ms tolerance for rounding
    expect(Math.abs(realNow - initialFakeTime)).toBeLessThan(10);
    expect(realNow).toBeLessThan(advancedFakeTime); // Real time hasn't advanced as much as fake time
  });

  test("Date.now() advances with advanceTimersToNextTimer", () => {
    vi.useFakeTimers();
    const start = Date.now();

    setTimeout(() => {}, 100);
    setTimeout(() => {}, 200);

    vi.advanceTimersToNextTimer();
    expect(Date.now()).toBe(start + 100);

    vi.advanceTimersToNextTimer();
    expect(Date.now()).toBe(start + 200);
  });

  test("Date.now() is consistent with timer callbacks", () => {
    vi.useFakeTimers();
    const start = Date.now();
    let capturedTime = 0;

    setTimeout(() => {
      capturedTime = Date.now();
    }, 500);

    vi.advanceTimersByTime(500);

    // The time captured in the callback should match
    expect(capturedTime).toBe(start + 500);
    expect(Date.now()).toBe(start + 500);
  });
});

describe("async timer methods", () => {
  test("advanceTimersToNextTimerAsync waits for async callbacks", async () => {
    vi.useFakeTimers();
    const order = new Order();

    setTimeout(async () => {
      order.add("start async");
      await Bun.sleep(5);
      order.add("end async");
    }, 100);

    const result = await vi.advanceTimersToNextTimerAsync();
    expect(result).toBe(vi);
    expect(order.takeOrderMessages()).toEqual(["start async", "end async"]);
  });

  test("advanceTimersByTimeAsync waits for multiple async callbacks", async () => {
    vi.useFakeTimers();
    const order = new Order();

    setTimeout(async () => {
      order.add("timeout 1 start");
      await Bun.sleep(5);
      order.add("timeout 1 end");
    }, 10);

    setTimeout(async () => {
      order.add("timeout 2 start");
      await Bun.sleep(5);
      order.add("timeout 2 end");
    }, 20);

    const result = await vi.advanceTimersByTimeAsync(25);
    expect(result).toBe(vi);
    expect(order.takeOrderMessages()).toEqual(["timeout 1 start", "timeout 1 end", "timeout 2 start", "timeout 2 end"]);
  });

  test("runAllTimersAsync waits for async callbacks", async () => {
    vi.useFakeTimers();
    const order = new Order();

    setTimeout(async () => {
      order.add("timeout 1 start");
      await Bun.sleep(5);
      order.add("timeout 1 end");
    }, 10);

    setTimeout(async () => {
      order.add("timeout 2 start");
      await Bun.sleep(5);
      order.add("timeout 2 end");
    }, 20);

    const result = await vi.runAllTimersAsync();
    expect(result).toBe(vi);
    expect(order.takeOrderMessages()).toEqual(["timeout 1 start", "timeout 1 end", "timeout 2 start", "timeout 2 end"]);
  });

  test("runOnlyPendingTimersAsync waits for async callbacks from setInterval", async () => {
    vi.useFakeTimers();
    const order = new Order();
    let count = 0;

    const interval = setInterval(async () => {
      count++;
      order.add(`interval ${count} start`);
      await Bun.sleep(5);
      order.add(`interval ${count} end`);
      if (count >= 3) {
        clearInterval(interval);
      }
    }, 100);

    const result = await vi.runOnlyPendingTimersAsync();
    expect(result).toBe(vi);
    expect(count).toBe(3);
    expect(order.takeOrderMessages()).toEqual([
      "interval 1 start",
      "interval 1 end",
      "interval 2 start",
      "interval 2 end",
      "interval 3 start",
      "interval 3 end",
    ]);
  });

  test("async methods work with non-async callbacks", async () => {
    vi.useFakeTimers();
    const order = new Order();

    setTimeout(() => {
      order.add("sync callback");
    }, 100);

    const result = await vi.advanceTimersToNextTimerAsync();
    expect(result).toBe(vi);
    expect(order.takeOrderMessages()).toEqual(["sync callback"]);
  });

  test("async methods handle Promise.resolve returns", async () => {
    vi.useFakeTimers();
    const order = new Order();

    setTimeout(() => {
      order.add("before promise");
      return Promise.resolve().then(() => {
        order.add("in promise");
      });
    }, 100);

    const result = await vi.advanceTimersToNextTimerAsync();
    expect(result).toBe(vi);
    expect(order.takeOrderMessages()).toEqual(["before promise", "in promise"]);
  });

  test("async methods handle mixed sync and async callbacks", async () => {
    vi.useFakeTimers();
    const order = new Order();

    setTimeout(() => {
      order.add("sync 1");
    }, 10);

    setTimeout(async () => {
      order.add("async 1 start");
      await Bun.sleep(5);
      order.add("async 1 end");
    }, 20);

    setTimeout(() => {
      order.add("sync 2");
    }, 30);

    const result = await vi.advanceTimersByTimeAsync(35);
    expect(result).toBe(vi);
    expect(order.takeOrderMessages()).toEqual(["sync 1", "async 1 start", "async 1 end", "sync 2"]);
  });

  test("async methods allow chaining", async () => {
    vi.useFakeTimers();
    const order = new Order();

    setTimeout(async () => {
      order.add("step 1");
      await Bun.sleep(5);
    }, 10);

    setTimeout(async () => {
      order.add("step 2");
      await Bun.sleep(5);
    }, 20);

    await vi.advanceTimersToNextTimerAsync().then(v => {
      expect(v).toBe(vi);
      return v.advanceTimersToNextTimerAsync();
    });

    expect(order.takeOrderMessages()).toEqual(["step 1", "step 2"]);
  });
});
