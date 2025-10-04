import { test, expect, vi } from "bun:test";

test("vi.isFakeTimers() returns false by default", () => {
  // Ensure we start with real timers
  vi.useRealTimers();

  expect(vi.isFakeTimers()).toBe(false);
});

test("vi.isFakeTimers() returns true when fake timers are enabled", () => {
  vi.useFakeTimers();

  expect(vi.isFakeTimers()).toBe(true);

  vi.useRealTimers();
});

test("vi.isFakeTimers() returns false after useRealTimers", () => {
  vi.useFakeTimers();
  expect(vi.isFakeTimers()).toBe(true);

  vi.useRealTimers();
  expect(vi.isFakeTimers()).toBe(false);
});

test("vi.isFakeTimers() state persists across multiple calls", () => {
  // Start with real timers
  expect(vi.isFakeTimers()).toBe(false);
  expect(vi.isFakeTimers()).toBe(false); // Should be consistent

  // Enable fake timers
  vi.useFakeTimers();
  expect(vi.isFakeTimers()).toBe(true);
  expect(vi.isFakeTimers()).toBe(true); // Should be consistent

  // Set a system time (should still be fake)
  vi.setSystemTime(1234567890000);
  expect(vi.isFakeTimers()).toBe(true);

  // Back to real timers
  vi.useRealTimers();
  expect(vi.isFakeTimers()).toBe(false);
  expect(vi.isFakeTimers()).toBe(false); // Should be consistent
});

test("vi.isFakeTimers() works with getMockedSystemTime", () => {
  // When fake timers are off, both should indicate no mocking
  vi.useRealTimers();
  expect(vi.isFakeTimers()).toBe(false);
  expect(vi.getMockedSystemTime()).toBeNull();

  // When fake timers are on, both should indicate mocking
  vi.useFakeTimers();
  expect(vi.isFakeTimers()).toBe(true);
  expect(vi.getMockedSystemTime()).not.toBeNull();

  vi.useRealTimers();
});

test("vi.isFakeTimers() reflects state after setSystemTime", () => {
  vi.useRealTimers();
  expect(vi.isFakeTimers()).toBe(false);

  // setSystemTime should implicitly enable fake timers
  vi.setSystemTime(0);
  expect(vi.isFakeTimers()).toBe(true);

  vi.useRealTimers();
});

test("multiple transitions between real and fake timers", () => {
  const states = [];

  // Initial state
  states.push(vi.isFakeTimers());

  // Enable fake timers
  vi.useFakeTimers();
  states.push(vi.isFakeTimers());

  // Back to real
  vi.useRealTimers();
  states.push(vi.isFakeTimers());

  // Fake again
  vi.useFakeTimers();
  states.push(vi.isFakeTimers());

  // Set system time (should keep fake)
  vi.setSystemTime(1000000);
  states.push(vi.isFakeTimers());

  // Real again
  vi.useRealTimers();
  states.push(vi.isFakeTimers());

  expect(states).toEqual([false, true, false, true, true, false]);
});

test("vi.isFakeTimers() is type-safe", () => {
  const result = vi.isFakeTimers();

  // TypeScript would catch this, but we can verify at runtime too
  expect(typeof result).toBe("boolean");
  expect(result === true || result === false).toBe(true);

  vi.useRealTimers();
});

test("calling useFakeTimers multiple times keeps fake timers enabled", () => {
  vi.useFakeTimers();
  expect(vi.isFakeTimers()).toBe(true);

  vi.useFakeTimers();
  expect(vi.isFakeTimers()).toBe(true);

  vi.useFakeTimers();
  expect(vi.isFakeTimers()).toBe(true);

  vi.useRealTimers();
  expect(vi.isFakeTimers()).toBe(false);
});

test("isFakeTimers works correctly with Date behavior", () => {
  vi.useRealTimers();
  expect(vi.isFakeTimers()).toBe(false);

  // Real timers - dates should differ
  const date1 = new Date();
  const date2 = new Date();
  // They might be equal due to timing, but isFakeTimers should be false
  expect(vi.isFakeTimers()).toBe(false);

  vi.useFakeTimers();
  vi.setSystemTime(1234567890000);
  expect(vi.isFakeTimers()).toBe(true);

  // Fake timers - dates should be equal
  const fakeDate1 = new Date();
  const fakeDate2 = new Date();
  expect(fakeDate1.getTime()).toBe(fakeDate2.getTime());
  expect(vi.isFakeTimers()).toBe(true);

  vi.useRealTimers();
});