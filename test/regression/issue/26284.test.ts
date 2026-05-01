// https://github.com/oven-sh/bun/issues/26284
// After useRealTimers(), hasOwnProperty('clock') should return false
import { afterEach, expect, jest, test } from "bun:test";

// Simulates testing-library/react's jestFakeTimersAreEnabled() function
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

// Ensure fake timers are always cleaned up after each test
afterEach(() => {
  jest.useRealTimers();
});

test("hasOwnProperty('clock') returns false before useFakeTimers", () => {
  expect(Object.prototype.hasOwnProperty.call(globalThis.setTimeout, "clock")).toBe(false);
  expect(jestFakeTimersAreEnabled()).toBe(false);
});

test("hasOwnProperty('clock') returns true after useFakeTimers", () => {
  jest.useFakeTimers();
  expect(Object.prototype.hasOwnProperty.call(globalThis.setTimeout, "clock")).toBe(true);
  expect((globalThis.setTimeout as any).clock).toBe(true);
  expect(jestFakeTimersAreEnabled()).toBe(true);
});

test("hasOwnProperty('clock') returns false after useRealTimers", () => {
  // First enable fake timers
  jest.useFakeTimers();
  expect(Object.prototype.hasOwnProperty.call(globalThis.setTimeout, "clock")).toBe(true);

  // Then disable them
  jest.useRealTimers();

  // The clock property should be deleted, not just set to false
  expect(Object.prototype.hasOwnProperty.call(globalThis.setTimeout, "clock")).toBe(false);
  expect((globalThis.setTimeout as any).clock).toBe(undefined);
  expect(jestFakeTimersAreEnabled()).toBe(false);
});

test("multiple useFakeTimers/useRealTimers cycles work correctly", () => {
  // Cycle 1
  jest.useFakeTimers();
  expect(jestFakeTimersAreEnabled()).toBe(true);
  jest.useRealTimers();
  expect(jestFakeTimersAreEnabled()).toBe(false);

  // Cycle 2
  jest.useFakeTimers();
  expect(jestFakeTimersAreEnabled()).toBe(true);
  jest.useRealTimers();
  expect(jestFakeTimersAreEnabled()).toBe(false);

  // Cycle 3
  jest.useFakeTimers();
  expect(jestFakeTimersAreEnabled()).toBe(true);
  jest.useRealTimers();
  expect(jestFakeTimersAreEnabled()).toBe(false);
});
