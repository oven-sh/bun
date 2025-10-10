import { describe, expect, test, vi } from "bun:test";

describe("vi.runAllTicks", () => {
  test("runs all pending nextTick callbacks", () => {
    const callback1 = vi.fn();
    const callback2 = vi.fn();
    const callback3 = vi.fn();

    process.nextTick(callback1);
    process.nextTick(callback2);
    process.nextTick(callback3);

    expect(callback1).not.toHaveBeenCalled();
    expect(callback2).not.toHaveBeenCalled();
    expect(callback3).not.toHaveBeenCalled();

    vi.runAllTicks();

    expect(callback1).toHaveBeenCalledTimes(1);
    expect(callback2).toHaveBeenCalledTimes(1);
    expect(callback3).toHaveBeenCalledTimes(1);
  });

  test("runs nested nextTick callbacks", () => {
    const order: number[] = [];
    const callback1 = vi.fn(() => {
      order.push(1);
      process.nextTick(callback3);
    });
    const callback2 = vi.fn(() => {
      order.push(2);
    });
    const callback3 = vi.fn(() => {
      order.push(3);
    });

    process.nextTick(callback1);
    process.nextTick(callback2);

    expect(order).toEqual([]);

    vi.runAllTicks();

    expect(callback1).toHaveBeenCalledTimes(1);
    expect(callback2).toHaveBeenCalledTimes(1);
    expect(callback3).toHaveBeenCalledTimes(1);
    expect(order).toEqual([1, 2, 3]);
  });

  test("runs recursively scheduled nextTick callbacks", () => {
    let count = 0;
    const maxCount = 5;

    const scheduleNext = vi.fn(() => {
      count++;
      if (count < maxCount) {
        process.nextTick(scheduleNext);
      }
    });

    process.nextTick(scheduleNext);

    vi.runAllTicks();

    expect(count).toBe(maxCount);
    expect(scheduleNext).toHaveBeenCalledTimes(maxCount);
  });

  test("does nothing when there are no pending nextTick callbacks", () => {
    // Should not throw or hang
    vi.runAllTicks();
    vi.runAllTicks();
  });

  test("handles errors in nextTick callbacks", () => {
    const callback1 = vi.fn(() => {
      throw new Error("nextTick error");
    });
    const callback2 = vi.fn();

    process.nextTick(callback1);
    process.nextTick(callback2);

    // runAllTicks should throw when a callback throws
    expect(() => vi.runAllTicks()).toThrow("nextTick error");

    expect(callback1).toHaveBeenCalledTimes(1);
  });

  test("works with async callbacks", async () => {
    let resolved = false;
    const promise = new Promise<void>(resolve => {
      process.nextTick(() => {
        resolved = true;
        resolve();
      });
    });

    expect(resolved).toBe(false);

    vi.runAllTicks();

    expect(resolved).toBe(true);
    await promise; // Should resolve immediately since nextTick already fired
  });

  test("runs nextTick callbacks scheduled during microtasks", () => {
    const order: string[] = [];

    process.nextTick(() => order.push("nextTick1"));

    Promise.resolve().then(() => {
      order.push("microtask1");
      process.nextTick(() => order.push("nextTick2"));
    });

    vi.runAllTicks();

    // nextTick1 runs first, then microtask1, then nextTick2
    expect(order).toEqual(["nextTick1", "microtask1", "nextTick2"]);
  });

  test("returns the vi object for chaining", () => {
    const result = vi.runAllTicks();
    expect(result).toBe(vi);
  });
});
