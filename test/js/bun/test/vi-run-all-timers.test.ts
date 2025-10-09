import { test, expect, vi, describe } from "bun:test";

describe("vi.runAllTimers", () => {
  test("runs all pending timers immediately", () => {
    vi.useFakeTimers();

    const callback1 = vi.fn();
    const callback2 = vi.fn();
    const callback3 = vi.fn();

    setTimeout(callback1, 1000);
    setTimeout(callback2, 5000);
    setTimeout(callback3, 10000);

    expect(callback1).not.toHaveBeenCalled();
    expect(callback2).not.toHaveBeenCalled();
    expect(callback3).not.toHaveBeenCalled();

    vi.runAllTimers();

    expect(callback1).toHaveBeenCalledTimes(1);
    expect(callback2).toHaveBeenCalledTimes(1);
    expect(callback3).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });

  test("runs nested timers", () => {
    vi.useFakeTimers();

    const order: number[] = [];
    const callback1 = vi.fn(() => {
      order.push(1);
      setTimeout(callback3, 1000);
    });
    const callback2 = vi.fn(() => {
      order.push(2);
    });
    const callback3 = vi.fn(() => {
      order.push(3);
    });

    setTimeout(callback1, 1000);
    setTimeout(callback2, 2000);

    expect(order).toEqual([]);

    vi.runAllTimers();

    expect(callback1).toHaveBeenCalledTimes(1);
    expect(callback2).toHaveBeenCalledTimes(1);
    expect(callback3).toHaveBeenCalledTimes(1);
    expect(order).toEqual([1, 2, 3]);

    vi.useRealTimers();
  });

  test("handles setInterval correctly", () => {
    vi.useFakeTimers();

    let count = 0;
    const callback = vi.fn(() => {
      count++;
      if (count >= 3) {
        clearInterval(intervalId);
      }
    });

    const intervalId = setInterval(callback, 1000);

    expect(callback).not.toHaveBeenCalled();

    // runAllTimers should run intervals multiple times until cleared
    vi.runAllTimers();

    expect(callback).toHaveBeenCalledTimes(3);
    expect(count).toBe(3);

    vi.useRealTimers();
  });

  test("handles mix of setTimeout and setInterval", () => {
    vi.useFakeTimers();

    const timeoutCallback = vi.fn();
    const intervalCallback = vi.fn();
    let intervalCount = 0;

    setTimeout(timeoutCallback, 5000);
    const intervalId = setInterval(() => {
      intervalCallback();
      intervalCount++;
      if (intervalCount >= 2) {
        clearInterval(intervalId);
      }
    }, 2000);

    vi.runAllTimers();

    expect(timeoutCallback).toHaveBeenCalledTimes(1);
    expect(intervalCallback).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
  });

  test("does nothing when fake timers are disabled", async () => {
    // Don't use fake timers
    const callback = vi.fn();

    const timeoutId = setTimeout(callback, 10);

    // This should do nothing since fake timers are not enabled
    vi.runAllTimers();

    expect(callback).not.toHaveBeenCalled();

    // Wait for the real timer to fire
    await new Promise(resolve => setTimeout(resolve, 20));

    expect(callback).toHaveBeenCalledTimes(1);

    clearTimeout(timeoutId);
  });

  test("runs timers in order they were scheduled", () => {
    vi.useFakeTimers();

    const order: string[] = [];

    setTimeout(() => order.push("first"), 100);
    setTimeout(() => order.push("second"), 200);
    setTimeout(() => order.push("third"), 300);
    setTimeout(() => order.push("also-100ms"), 100);

    vi.runAllTimers();

    // Timers with same delay should fire in order they were scheduled
    expect(order).toEqual(["first", "also-100ms", "second", "third"]);

    vi.useRealTimers();
  });

  test("handles timer that schedules another timer with same delay", () => {
    vi.useFakeTimers();

    const order: string[] = [];

    setTimeout(() => {
      order.push("first");
      setTimeout(() => order.push("nested"), 1000);
    }, 1000);

    setTimeout(() => order.push("second"), 1000);

    vi.runAllTimers();

    // The nested timer should fire after the second timer
    expect(order).toEqual(["first", "second", "nested"]);

    vi.useRealTimers();
  });

  test("handles zero-delay timers", () => {
    vi.useFakeTimers();

    const callback1 = vi.fn();
    const callback2 = vi.fn();

    setTimeout(callback1, 0);
    setTimeout(callback2, 0);

    expect(callback1).not.toHaveBeenCalled();
    expect(callback2).not.toHaveBeenCalled();

    vi.runAllTimers();

    expect(callback1).toHaveBeenCalledTimes(1);
    expect(callback2).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });

  test("handles timers that throw errors", () => {
    vi.useFakeTimers();

    const callback1 = vi.fn(() => {
      throw new Error("Timer error");
    });
    const callback2 = vi.fn();

    setTimeout(callback1, 1000);
    setTimeout(callback2, 2000);

    // Even if one timer throws, others should still run
    expect(() => vi.runAllTimers()).toThrow("Timer error");

    expect(callback1).toHaveBeenCalledTimes(1);
    // The second callback may or may not run depending on error handling
    // This behavior might need to be verified

    vi.useRealTimers();
  });

  test("works with promises and async callbacks", async () => {
    vi.useFakeTimers();

    let resolved = false;
    const promise = new Promise<void>(resolve => {
      setTimeout(() => {
        resolved = true;
        resolve();
      }, 1000);
    });

    expect(resolved).toBe(false);

    vi.runAllTimers();

    expect(resolved).toBe(true);
    await promise; // Should resolve immediately since timer already fired

    vi.useRealTimers();
  });

  test("handles recursive timer scheduling", () => {
    vi.useFakeTimers();

    let count = 0;
    const maxCount = 5;

    const scheduleNext = () => {
      count++;
      if (count < maxCount) {
        setTimeout(scheduleNext, 1000);
      }
    };

    setTimeout(scheduleNext, 1000);

    vi.runAllTimers();

    expect(count).toBe(maxCount);

    vi.useRealTimers();
  });

  test("clears timers correctly with clearTimeout during execution", () => {
    vi.useFakeTimers();

    const callback1 = vi.fn();
    const callback2 = vi.fn();
    let timerId2: ReturnType<typeof setTimeout>;

    setTimeout(() => {
      callback1();
      clearTimeout(timerId2);
    }, 1000);

    timerId2 = setTimeout(callback2, 2000);

    vi.runAllTimers();

    expect(callback1).toHaveBeenCalledTimes(1);
    expect(callback2).not.toHaveBeenCalled();

    vi.useRealTimers();
  });

  // Note: setImmediate uses a different queue system (not the timer heap)
  // and would require additional implementation in runAllTimers to support
});
