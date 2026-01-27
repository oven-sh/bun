import { afterEach, describe, expect, it, jest } from "bun:test";

describe("GitHub issue #26037: useFakeTimers with advanceTimers option", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it("advanceTimers: true auto-advances timers (default 20ms)", async () => {
    jest.useFakeTimers({ advanceTimers: true });

    let timerFired = false;
    setTimeout(() => {
      timerFired = true;
    }, 10);

    // Wait for the auto-advance timer to fire using setImmediate loop
    for (let i = 0; i < 100 && !timerFired; i++) {
      await new Promise(resolve => setImmediate(resolve));
    }

    expect(timerFired).toBe(true);
  });

  it("advanceTimers: <number> auto-advances timers by that amount", async () => {
    jest.useFakeTimers({ advanceTimers: 10 });

    const values: number[] = [];
    setTimeout(() => values.push(1), 5);
    setTimeout(() => values.push(2), 15);
    setTimeout(() => values.push(3), 25);

    // Wait for auto-advance timers to fire multiple times
    for (let i = 0; i < 100 && values.length < 3; i++) {
      await new Promise(resolve => setImmediate(resolve));
    }

    expect(values).toEqual([1, 2, 3]);
  });

  it("advanceTimers: false does not auto-advance timers", async () => {
    jest.useFakeTimers({ advanceTimers: false });

    let timerFired = false;
    setTimeout(() => {
      timerFired = true;
    }, 10);

    // Run setImmediate a few times to ensure no auto-advance happens
    for (let i = 0; i < 10; i++) {
      await new Promise(resolve => setImmediate(resolve));
    }

    expect(timerFired).toBe(false);

    // Now manually advance to verify the timer works
    jest.advanceTimersByTime(10);
    expect(timerFired).toBe(true);
  });

  it("without advanceTimers option, timers do not auto-advance (default behavior)", async () => {
    jest.useFakeTimers();

    let timerFired = false;
    setTimeout(() => {
      timerFired = true;
    }, 10);

    // Run setImmediate a few times to ensure no auto-advance happens
    for (let i = 0; i < 10; i++) {
      await new Promise(resolve => setImmediate(resolve));
    }

    expect(timerFired).toBe(false);

    // Now manually advance to verify the timer works
    jest.advanceTimersByTime(10);
    expect(timerFired).toBe(true);
  });

  it("useRealTimers stops auto-advancing", async () => {
    jest.useFakeTimers({ advanceTimers: true });

    let count = 0;
    const intervalId = setInterval(() => {
      count++;
    }, 10);

    // Let some timers fire via auto-advance
    for (let i = 0; i < 50 && count === 0; i++) {
      await new Promise(resolve => setImmediate(resolve));
    }
    const countAfterAutoAdvance = count;
    expect(countAfterAutoAdvance).toBeGreaterThan(0);

    // Clear the interval before switching timers
    clearInterval(intervalId);

    // Switch to real timers - should stop auto-advancing
    jest.useRealTimers();

    // Re-enable fake timers without auto-advance
    jest.useFakeTimers();

    let newTimer = false;
    setTimeout(() => {
      newTimer = true;
    }, 10);

    // Run setImmediate - without advanceTimers, the timer should NOT fire
    for (let i = 0; i < 10; i++) {
      await new Promise(resolve => setImmediate(resolve));
    }

    // New timer should NOT have fired because we didn't enable advanceTimers
    expect(newTimer).toBe(false);
  });

  it("advanceTimers works with setInterval", async () => {
    jest.useFakeTimers({ advanceTimers: 5 });

    const values: number[] = [];
    setInterval(() => values.push(values.length + 1), 10);

    // Wait for multiple interval fires
    for (let i = 0; i < 100 && values.length < 4; i++) {
      await new Promise(resolve => setImmediate(resolve));
    }

    // Should have fired multiple times
    expect(values.length).toBeGreaterThan(3);
  });

  it("advanceTimers combined with now option", async () => {
    const startTime = 1000000;
    jest.useFakeTimers({ now: startTime, advanceTimers: 10 });

    expect(Date.now()).toBe(startTime);

    // Let time advance via auto-advance
    for (let i = 0; i < 50; i++) {
      await new Promise(resolve => setImmediate(resolve));
    }

    // Time should have advanced
    expect(Date.now()).toBeGreaterThan(startTime);
  });

  it("timers work correctly after useRealTimers is called during auto-advance", async () => {
    // This tests the race condition where useRealTimers() is called during
    // the auto-advance timer's execution (while it's firing fake timers).
    jest.useFakeTimers({ advanceTimers: 20 });

    // Wait using the auto-advance feature
    await new Promise(resolve => setTimeout(resolve, 30));

    // Switch back to real timers
    jest.useRealTimers();

    // Now a new setTimeout should work correctly with real time
    let timerFired = false;
    setTimeout(() => {
      timerFired = true;
    }, 10);

    // Wait with real time
    await new Promise(resolve => setTimeout(resolve, 50));

    expect(timerFired).toBe(true);
  });
});
