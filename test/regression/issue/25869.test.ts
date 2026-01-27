// https://github.com/oven-sh/bun/issues/25869
// useFakeTimers with testing-library/react hangs when using user-event
import { expect, jest, test } from "bun:test";

// Test that jestFakeTimersAreEnabled() detection works properly.
// testing-library/react checks for setTimeout.clock or setTimeout._isMockFunction
// to determine if fake timers are enabled.
function jestFakeTimersAreEnabled(): boolean {
  // @ts-expect-error - checking for Jest fake timers markers
  if (typeof jest !== "undefined" && jest !== null) {
    return (
      // @ts-expect-error - checking for mock function marker
      (globalThis.setTimeout as any)._isMockFunction === true ||
      Object.prototype.hasOwnProperty.call(globalThis.setTimeout, "clock")
    );
  }
  return false;
}

test("setTimeout.clock is not set before useFakeTimers", () => {
  expect(jestFakeTimersAreEnabled()).toBe(false);
  expect(Object.prototype.hasOwnProperty.call(globalThis.setTimeout, "clock")).toBe(false);
});

test("setTimeout.clock is set after useFakeTimers", () => {
  jest.useFakeTimers();
  try {
    expect(jestFakeTimersAreEnabled()).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(globalThis.setTimeout, "clock")).toBe(true);
  } finally {
    jest.useRealTimers();
  }
});

test("setTimeout.clock is deleted after useRealTimers", () => {
  jest.useFakeTimers();
  jest.useRealTimers();
  // The clock property should be deleted when disabling fake timers.
  // This matches Jest/Sinon behavior and ensures hasOwnProperty returns false.
  expect(Object.prototype.hasOwnProperty.call(globalThis.setTimeout, "clock")).toBe(false);
  expect((globalThis.setTimeout as any).clock).toBe(undefined);
});

test("advanceTimersByTime(0) fires setTimeout(fn, 0) timers", async () => {
  jest.useFakeTimers();
  try {
    let called = false;
    setTimeout(() => {
      called = true;
    }, 0);

    expect(called).toBe(false);
    jest.advanceTimersByTime(0);
    expect(called).toBe(true);
  } finally {
    jest.useRealTimers();
  }
});

test("user-event style wait pattern does not hang", async () => {
  jest.useFakeTimers();
  try {
    // This is the pattern used by @testing-library/user-event in wait.js
    // It was hanging before the fix because:
    // 1. advanceTimersByTime(0) didn't fire setTimeout(fn, 0) timers
    // 2. jestFakeTimersAreEnabled() returned false, so advanceTimers wasn't called
    const delay = 0;

    const result = await Promise.all([
      new Promise<string>(resolve => globalThis.setTimeout(() => resolve("timeout"), delay)),
      Promise.resolve().then(() => {
        jest.advanceTimersByTime(delay);
        return "advanced";
      }),
    ]);

    expect(result).toEqual(["timeout", "advanced"]);
  } finally {
    jest.useRealTimers();
  }
});
