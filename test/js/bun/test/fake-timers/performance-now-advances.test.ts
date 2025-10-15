import { describe, expect, test, vi } from "bun:test";

describe("fake timers advance performance.now()", () => {
  test("vi.runAllTimers advances performance.now()", () => {
    vi.useFakeTimers();

    const initialTime = performance.now();

    const times: number[] = [];
    setTimeout(() => {
      times.push(performance.now());
      setTimeout(() => {
        times.push(performance.now());
      }, 3000);
    }, 1000);

    setTimeout(() => {
      times.push(performance.now());
    }, 2000);

    setTimeout(() => {
      times.push(performance.now());
    }, 3000);

    vi.runAllTimers();

    // Each timer should see performance.now() advanced to its scheduled time

    expect(times.map(t => t - initialTime)).toEqual([1000, 2000, 3000, 4000]);

    vi.useRealTimers();
  });

  test("vi.advanceTimersToNextTimer advances performance.now()", () => {
    vi.useFakeTimers();

    const initialTime = performance.now();

    const times: number[] = [];
    setTimeout(() => {
      times.push(performance.now());
    }, 1000);

    setTimeout(() => {
      times.push(performance.now());
    }, 5000);

    // Advance to first timer
    vi.advanceTimersToNextTimer();
    expect(times[0]).toBeCloseTo(initialTime + 1000, 5);

    // Advance to second timer
    vi.advanceTimersToNextTimer();
    expect(times[1]).toBeCloseTo(initialTime + 5000, 5);

    vi.useRealTimers();
  });

  test("vi.runOnlyPendingTimers advances performance.now()", () => {
    vi.useFakeTimers();

    const initialTime = performance.now();

    const times: number[] = [];
    let nestedCalled = false;

    setTimeout(() => {
      times.push(performance.now());
      // Schedule a nested timer - should not run in runOnlyPendingTimers
      setTimeout(() => {
        nestedCalled = true;
      }, 1000);
    }, 1000);

    setTimeout(() => {
      times.push(performance.now());
    }, 2000);

    vi.runOnlyPendingTimers();

    // Both pending timers should have run
    expect(times[0]).toBeCloseTo(initialTime + 1000, 5);
    expect(times[1]).toBeCloseTo(initialTime + 2000, 5);

    // Nested timer should not have run yet
    expect(nestedCalled).toBe(false);

    vi.useRealTimers();
  });

  test("performance.now() stays consistent within same timer", () => {
    vi.useFakeTimers();

    const initialTime = performance.now();

    let time1: number;
    let time2: number;

    setTimeout(() => {
      time1 = performance.now();
      // Multiple calls within same callback should return same time
      time2 = performance.now();
    }, 1000);

    vi.runAllTimers();

    expect(time1).toBeCloseTo(initialTime + 1000, 5);
    expect(time2).toBeCloseTo(initialTime + 1000, 5);

    vi.useRealTimers();
  });

  test("setInterval advances performance.now() each iteration", () => {
    vi.useFakeTimers();

    const initialTime = performance.now();

    const times: number[] = [];
    let count = 0;
    const intervalId = setInterval(() => {
      times.push(performance.now());
      count++;
      if (count >= 3) {
        clearInterval(intervalId);
      }
    }, 1000);

    vi.runAllTimers();

    // Use toBeCloseTo for floating point comparisons to avoid precision issues
    expect(times[0]).toBeCloseTo(initialTime + 1000, 5);
    expect(times[1]).toBeCloseTo(initialTime + 2000, 5);
    expect(times[2]).toBeCloseTo(initialTime + 3000, 5);

    vi.useRealTimers();
  });

  test("performance.now() reflects current virtual time", () => {
    vi.useFakeTimers();

    const initialTime = performance.now();

    // First check that performance.now() doesn't advance without running timers
    setTimeout(() => {}, 1000);
    expect(performance.now()).toBeCloseTo(initialTime, 5);

    // Now advance timers
    vi.advanceTimersToNextTimer();

    // performance.now() should now reflect the advanced time
    expect(performance.now()).toBeCloseTo(initialTime + 1000, 5);

    vi.useRealTimers();
  });

  test("both Date.now() and performance.now() advance together", () => {
    vi.useFakeTimers();

    const initialDate = Date.now();
    const initialPerf = performance.now();

    const dateTime: number[] = [];
    const perfTime: number[] = [];

    setTimeout(() => {
      dateTime.push(Date.now());
      perfTime.push(performance.now());
    }, 1000);

    setTimeout(() => {
      dateTime.push(Date.now());
      perfTime.push(performance.now());
    }, 2500);

    vi.runAllTimers();

    // Both should advance by the same amount
    expect(dateTime[0]).toBe(initialDate + 1000);
    expect(perfTime[0]).toBeCloseTo(initialPerf + 1000, 5);
    expect(dateTime[1]).toBe(initialDate + 2500);
    expect(perfTime[1]).toBeCloseTo(initialPerf + 2500, 5);

    vi.useRealTimers();
  });

  test("performance.now() returns to real time after useRealTimers", () => {
    vi.useFakeTimers();

    // Advance time with fake timers
    setTimeout(() => {}, 5000);
    vi.runAllTimers();

    const fakeTime = performance.now();

    vi.useRealTimers();

    // After switching back to real timers, performance.now() should return to real time
    const realTime = performance.now();

    // Real time should be much less than fake time (we advanced 5 seconds)
    // This checks that we're not still using the fake offset
    expect(realTime).toBeLessThan(fakeTime);
  });
});
