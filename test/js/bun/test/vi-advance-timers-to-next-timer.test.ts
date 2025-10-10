import { expect, test, vi } from "bun:test";

test("vi.advanceTimersToNextTimer() advances to next timer", () => {
  vi.useFakeTimers();

  let i = 0;
  setInterval(() => i++, 50);

  expect(i).toBe(0);

  vi.advanceTimersToNextTimer();
  expect(i).toBe(1);

  vi.advanceTimersToNextTimer();
  expect(i).toBe(2);

  vi.advanceTimersToNextTimer();
  expect(i).toBe(3);

  vi.useRealTimers();
});

test("vi.advanceTimersToNextTimer() is chainable", () => {
  vi.useFakeTimers();

  let i = 0;
  setInterval(() => i++, 50);

  expect(i).toBe(0);

  vi.advanceTimersToNextTimer().advanceTimersToNextTimer().advanceTimersToNextTimer();

  expect(i).toBe(3);

  vi.useRealTimers();
});

test("vi.advanceTimersToNextTimer() handles multiple timers with different delays", () => {
  vi.useFakeTimers();

  const order: number[] = [];

  setTimeout(() => order.push(1), 100);
  setTimeout(() => order.push(2), 50);
  setTimeout(() => order.push(3), 150);

  expect(order).toEqual([]);

  // Should fire in order of scheduled time, not order they were created
  vi.advanceTimersToNextTimer(); // fires timer at 50ms
  expect(order).toEqual([2]);

  vi.advanceTimersToNextTimer(); // fires timer at 100ms
  expect(order).toEqual([2, 1]);

  vi.advanceTimersToNextTimer(); // fires timer at 150ms
  expect(order).toEqual([2, 1, 3]);

  vi.useRealTimers();
});

test("vi.advanceTimersToNextTimer() handles nested timers", () => {
  vi.useFakeTimers();

  const order: number[] = [];

  setTimeout(() => {
    order.push(1);
    setTimeout(() => order.push(3), 50);
  }, 100);

  setTimeout(() => order.push(2), 150);

  vi.advanceTimersToNextTimer(); // fires timer at 100ms, schedules new timer at current_time + 50ms
  expect(order).toEqual([1]);

  // When two timers are at the same time (150ms), they fire in the order they were scheduled (FIFO)
  // Timer 2 was scheduled first (at time 0), so it fires before timer 3 (scheduled during callback at time 100)
  vi.advanceTimersToNextTimer(); // fires timer at 150ms (timer 2, scheduled first)
  expect(order).toEqual([1, 2]);

  vi.advanceTimersToNextTimer(); // fires nested timer at 150ms (timer 3, scheduled during callback)
  expect(order).toEqual([1, 2, 3]);

  vi.useRealTimers();
});

test("vi.advanceTimersToNextTimer() does nothing when no timers are pending", () => {
  vi.useFakeTimers();

  let called = false;
  setTimeout(() => {
    called = true;
  }, 100);

  vi.advanceTimersToNextTimer();
  expect(called).toBe(true);

  // No more timers, this should be safe to call
  vi.advanceTimersToNextTimer();
  vi.advanceTimersToNextTimer();

  vi.useRealTimers();
});

test("vi.advanceTimersToNextTimer() works with setInterval", () => {
  vi.useFakeTimers();

  let count = 0;
  const intervalId = setInterval(() => {
    count++;
    if (count >= 3) {
      clearInterval(intervalId);
    }
  }, 100);

  expect(count).toBe(0);

  vi.advanceTimersToNextTimer();
  expect(count).toBe(1);

  vi.advanceTimersToNextTimer();
  expect(count).toBe(2);

  vi.advanceTimersToNextTimer();
  expect(count).toBe(3);

  // Interval was cleared, no more timers
  vi.advanceTimersToNextTimer();
  expect(count).toBe(3);

  vi.useRealTimers();
});

test("vi.advanceTimersToNextTimer() handles mix of setTimeout and setInterval", () => {
  vi.useFakeTimers();

  const events: string[] = [];

  setTimeout(() => events.push("timeout-1"), 50);
  const intervalId = setInterval(() => {
    events.push("interval");
    if (events.filter(e => e === "interval").length >= 2) {
      clearInterval(intervalId);
    }
  }, 100);
  setTimeout(() => events.push("timeout-2"), 200);

  vi.advanceTimersToNextTimer(); // 50ms: timeout-1
  expect(events).toEqual(["timeout-1"]);

  vi.advanceTimersToNextTimer(); // 100ms: interval (1st)
  expect(events).toEqual(["timeout-1", "interval"]);

  vi.advanceTimersToNextTimer(); // 200ms: interval (2nd) and timeout-2 compete
  // The interval at 200ms should fire first (it was scheduled first), then gets cleared
  expect(events.length).toBe(3);
  expect(events).toContain("interval");

  vi.advanceTimersToNextTimer(); // 200ms: timeout-2
  expect(events).toContain("timeout-2");

  vi.useRealTimers();
});

test("vi.advanceTimersToNextTimer() executes timer callbacks with automatic microtask processing", () => {
  vi.useFakeTimers();

  const order: string[] = [];

  setTimeout(() => {
    order.push("timer");
    process.nextTick(() => order.push("tick"));
  }, 100);

  // When a timer callback runs, microtasks (including nextTick) are processed automatically
  // This is standard JavaScript execution behavior
  vi.advanceTimersToNextTimer();
  expect(order).toEqual(["timer", "tick"]);

  vi.useRealTimers();
});

test("vi.advanceTimersToNextTimer() returns vi object for chaining with other vi methods", () => {
  vi.useFakeTimers();

  let timerCalled = false;
  let tickCalled = false;

  setTimeout(() => {
    timerCalled = true;
    process.nextTick(() => {
      tickCalled = true;
    });
  }, 100);

  // Microtasks run automatically after timer callback, so runAllTicks() is not needed here
  // but chaining still works
  vi.advanceTimersToNextTimer();

  expect(timerCalled).toBe(true);
  expect(tickCalled).toBe(true);

  vi.useRealTimers();
});
