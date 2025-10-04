import { test, expect, vi } from "bun:test";

test("vi.setSystemTime properly handles invalid date strings", () => {
  vi.useFakeTimers();
  const beforeInvalid = new Date().getTime();

  // Invalid date string should not change the time
  vi.setSystemTime("invalid-date");
  const afterInvalid = new Date().getTime();

  // Time should remain unchanged
  expect(afterInvalid).toBe(beforeInvalid);

  vi.useRealTimers();
});

test("vi.setSystemTime with negative numbers doesn't set time", () => {
  vi.useFakeTimers();
  vi.setSystemTime(1000000000000);

  // Negative numbers should be ignored
  vi.setSystemTime(-1000);
  expect(new Date().getTime()).toBe(1000000000000);

  vi.useRealTimers();
});

test("vi timer methods can be chained", () => {
  // Should not throw
  const result = vi
    .useFakeTimers()
    .setSystemTime(1234567890000)
    .useRealTimers();

  // Result should be the vi object for chaining
  expect(result).toBe(vi);
});

test("Date constructor respects fake timer when called without arguments", () => {
  vi.useFakeTimers();
  vi.setSystemTime(1000000000000);

  // These should all give the same mocked time
  const date1 = new Date();
  const date2 = new Date(Date.now());
  const timestamp = Date.now();

  expect(date1.getTime()).toBe(1000000000000);
  expect(date2.getTime()).toBe(1000000000000);
  expect(timestamp).toBe(1000000000000);

  vi.useRealTimers();
});

test("vi.setSystemTime accepts undefined/null to reset", () => {
  vi.useFakeTimers();
  vi.setSystemTime(1000000000000);
  expect(new Date().getTime()).toBe(1000000000000);

  // Reset with undefined
  vi.setSystemTime(undefined);
  const afterReset = new Date().getTime();

  // Should no longer be the old mocked time
  expect(afterReset).not.toBe(1000000000000);

  vi.useRealTimers();
});