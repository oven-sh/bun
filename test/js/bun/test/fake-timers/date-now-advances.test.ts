import { describe, expect, test, vi } from "bun:test";

describe("fake timers advance Date.now()", () => {
  test("vi.runAllTimers advances Date.now()", () => {
    vi.useFakeTimers();

    const initialTime = Date.now();

    const times: number[] = [];
    setTimeout(() => {
      times.push(Date.now());
    }, 1000);

    setTimeout(() => {
      times.push(Date.now());
    }, 2000);

    setTimeout(() => {
      times.push(Date.now());
    }, 3000);

    vi.runAllTimers();

    // Each timer should see Date.now() advanced to its scheduled time
    expect(times[0]).toBe(initialTime + 1000);
    expect(times[1]).toBe(initialTime + 2000);
    expect(times[2]).toBe(initialTime + 3000);

    vi.useRealTimers();
  });

  test("vi.advanceTimersToNextTimer advances Date.now()", () => {
    vi.useFakeTimers();

    const initialTime = Date.now();

    const times: number[] = [];
    setTimeout(() => {
      times.push(Date.now());
    }, 1000);

    setTimeout(() => {
      times.push(Date.now());
    }, 5000);

    // Advance to first timer
    vi.advanceTimersToNextTimer();
    expect(times[0]).toBe(initialTime + 1000);

    // Advance to second timer
    vi.advanceTimersToNextTimer();
    expect(times[1]).toBe(initialTime + 5000);

    vi.useRealTimers();
  });

  test("vi.runOnlyPendingTimers advances Date.now()", () => {
    vi.useFakeTimers();

    const initialTime = Date.now();

    const times: number[] = [];
    let nestedCalled = false;

    setTimeout(() => {
      times.push(Date.now());
      // Schedule a nested timer - should not run in runOnlyPendingTimers
      setTimeout(() => {
        nestedCalled = true;
      }, 1000);
    }, 1000);

    setTimeout(() => {
      times.push(Date.now());
    }, 2000);

    vi.runOnlyPendingTimers();

    // Both pending timers should have run
    expect(times[0]).toBe(initialTime + 1000);
    expect(times[1]).toBe(initialTime + 2000);

    // Nested timer should not have run yet
    expect(nestedCalled).toBe(false);

    vi.useRealTimers();
  });

  test("Date.now() stays consistent within same timer", () => {
    vi.useFakeTimers();

    const initialTime = Date.now();

    let time1: number;
    let time2: number;

    setTimeout(() => {
      time1 = Date.now();
      // Multiple calls within same callback should return same time
      time2 = Date.now();
    }, 1000);

    vi.runAllTimers();

    expect(time1).toBe(initialTime + 1000);
    expect(time2).toBe(initialTime + 1000);

    vi.useRealTimers();
  });

  test("setInterval advances Date.now() each iteration", () => {
    vi.useFakeTimers();

    const initialTime = Date.now();

    const times: number[] = [];
    let count = 0;
    const intervalId = setInterval(() => {
      times.push(Date.now());
      count++;
      if (count >= 3) {
        clearInterval(intervalId);
      }
    }, 1000);

    vi.runAllTimers();

    expect(times[0]).toBe(initialTime + 1000);
    expect(times[1]).toBe(initialTime + 2000);
    expect(times[2]).toBe(initialTime + 3000);

    vi.useRealTimers();
  });

  test("Date.now() reflects current virtual time", () => {
    vi.useFakeTimers();

    const initialTime = Date.now();

    // First check that Date.now() doesn't advance without running timers
    setTimeout(() => {}, 1000);
    expect(Date.now()).toBe(initialTime);

    // Now advance timers
    vi.advanceTimersToNextTimer();

    // Date.now() should now reflect the advanced time
    expect(Date.now()).toBe(initialTime + 1000);

    vi.useRealTimers();
  });
});
