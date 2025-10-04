import { test, expect, vi } from "bun:test";

test("vi.useFakeTimers() freezes Date", () => {
  const beforeFakeTimers = new Date();

  vi.useFakeTimers();

  // Date should be frozen at the time useFakeTimers was called
  const duringFakeTimers1 = new Date();
  const duringFakeTimers2 = new Date();

  // Both dates should be equal since time is frozen
  expect(duringFakeTimers1.getTime()).toBe(duringFakeTimers2.getTime());

  // Should be close to when we enabled fake timers (within a few ms)
  expect(Math.abs(duringFakeTimers1.getTime() - beforeFakeTimers.getTime())).toBeLessThan(100);

  vi.useRealTimers();
});

test("vi.setSystemTime() sets a specific date", () => {
  vi.useFakeTimers();

  // Test with number (timestamp)
  const timestamp = 1000000000000; // September 9, 2001
  vi.setSystemTime(timestamp);

  const date1 = new Date();
  expect(date1.getTime()).toBe(timestamp);

  // Date.now() should also return the mocked time
  expect(Date.now()).toBe(timestamp);

  vi.useRealTimers();
});

test("vi.setSystemTime() accepts Date object", () => {
  vi.useFakeTimers();

  const targetDate = new Date(2023, 0, 1, 12, 0, 0); // January 1, 2023, 12:00:00
  vi.setSystemTime(targetDate);

  const date = new Date();
  expect(date.getTime()).toBe(targetDate.getTime());
  expect(date.getFullYear()).toBe(2023);
  expect(date.getMonth()).toBe(0);
  expect(date.getDate()).toBe(1);
  expect(date.getHours()).toBe(12);

  vi.useRealTimers();
});

test("vi.setSystemTime() accepts date string", () => {
  vi.useFakeTimers();

  const dateString = "2024-06-15T10:30:00.000Z";
  vi.setSystemTime(dateString);

  const date = new Date();
  expect(date.toISOString()).toBe(dateString);

  vi.useRealTimers();
});

test("vi.useRealTimers() restores real Date behavior", () => {
  vi.useFakeTimers();
  vi.setSystemTime(1000000000000);

  const fakeDate = new Date();
  expect(fakeDate.getTime()).toBe(1000000000000);

  vi.useRealTimers();

  // After restoring, dates should be current
  const realDate1 = new Date();
  const realDate2 = new Date();

  // Real dates should be recent (within the last minute)
  const now = Date.now();
  expect(Math.abs(realDate1.getTime() - now)).toBeLessThan(1000);

  // Two consecutive dates might have slightly different times
  expect(realDate2.getTime()).toBeGreaterThanOrEqual(realDate1.getTime());
});

test("vi.setSystemTime() works without calling useFakeTimers first", () => {
  // This should implicitly enable fake timers
  const timestamp = 1500000000000;
  vi.setSystemTime(timestamp);

  const date = new Date();
  expect(date.getTime()).toBe(timestamp);

  vi.useRealTimers();
});

test("Date constructor with arguments still works with fake timers", () => {
  vi.useFakeTimers();
  vi.setSystemTime(1000000000000);

  // Creating a date with specific arguments should still work
  const specificDate = new Date(2025, 5, 15, 14, 30, 0);
  expect(specificDate.getFullYear()).toBe(2025);
  expect(specificDate.getMonth()).toBe(5);
  expect(specificDate.getDate()).toBe(15);

  // But Date.now() and new Date() should use the mocked time
  expect(Date.now()).toBe(1000000000000);
  expect(new Date().getTime()).toBe(1000000000000);

  vi.useRealTimers();
});

test("vi.setSystemTime(0) sets epoch time", () => {
  vi.useFakeTimers();
  vi.setSystemTime(0);

  const date = new Date();
  expect(date.getTime()).toBe(0);
  expect(date.toISOString()).toBe("1970-01-01T00:00:00.000Z");

  vi.useRealTimers();
});

test("multiple calls to vi.setSystemTime() update the mocked time", () => {
  vi.useFakeTimers();

  vi.setSystemTime(1000000000000);
  expect(new Date().getTime()).toBe(1000000000000);

  vi.setSystemTime(2000000000000);
  expect(new Date().getTime()).toBe(2000000000000);

  vi.setSystemTime(3000000000000);
  expect(new Date().getTime()).toBe(3000000000000);

  vi.useRealTimers();
});

test("calling vi.useFakeTimers() multiple times preserves the set time", () => {
  vi.useFakeTimers();
  vi.setSystemTime(1234567890000);

  // Call useFakeTimers again
  vi.useFakeTimers();

  // Time should still be the previously set time
  expect(new Date().getTime()).toBe(1234567890000);

  vi.useRealTimers();
});