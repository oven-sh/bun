import { test, expect, vi } from "bun:test";

test("vi.getMockedSystemTime() returns null when timers are not mocked", () => {
  // Ensure we start with real timers
  vi.useRealTimers();

  const mockedTime = vi.getMockedSystemTime();
  expect(mockedTime).toBeNull();
});

test("vi.getMockedSystemTime() returns Date when fake timers are active", () => {
  vi.useFakeTimers();

  const mockedTime = vi.getMockedSystemTime();
  expect(mockedTime).toBeInstanceOf(Date);
  expect(mockedTime).not.toBeNull();

  // The mocked time should be frozen
  const time1 = vi.getMockedSystemTime();
  const time2 = vi.getMockedSystemTime();
  expect(time1.getTime()).toBe(time2.getTime());

  vi.useRealTimers();
});

test("vi.getMockedSystemTime() reflects setSystemTime changes", () => {
  vi.useFakeTimers();

  // Set a specific time
  const targetTime = new Date(2024, 5, 15, 12, 0, 0);
  vi.setSystemTime(targetTime);

  const mockedTime = vi.getMockedSystemTime();
  expect(mockedTime).toBeInstanceOf(Date);
  expect(mockedTime.getTime()).toBe(targetTime.getTime());
  expect(mockedTime.getFullYear()).toBe(2024);
  expect(mockedTime.getMonth()).toBe(5);
  expect(mockedTime.getDate()).toBe(15);

  // Change the time again
  vi.setSystemTime(0);
  const epochTime = vi.getMockedSystemTime();
  expect(epochTime.getTime()).toBe(0);
  expect(epochTime.toISOString()).toBe("1970-01-01T00:00:00.000Z");

  vi.useRealTimers();
});

test("vi.getRealSystemTime() returns real time regardless of mocking", () => {
  // Test without fake timers
  const realTime1 = vi.getRealSystemTime();
  expect(typeof realTime1).toBe("number");
  expect(realTime1).toBeGreaterThan(0);

  // Should be close to Date.now()
  const now1 = Date.now();
  expect(Math.abs(realTime1 - now1)).toBeLessThan(100);

  // Enable fake timers and set to past
  vi.useFakeTimers();
  vi.setSystemTime(1000000000000); // September 9, 2001

  // getRealSystemTime should still return current time, not mocked time
  const realTime2 = vi.getRealSystemTime();
  const now2 = Date.now(); // This will return mocked time (1000000000000)

  expect(now2).toBe(1000000000000); // Date.now() is mocked
  expect(realTime2).toBeGreaterThan(1700000000000); // Real time should be recent (after 2023)
  expect(realTime2).not.toBe(1000000000000); // Should NOT be the mocked time

  vi.useRealTimers();
});

test("vi.getRealSystemTime() always returns increasing values", () => {
  vi.useFakeTimers();
  vi.setSystemTime(0); // Set to epoch

  const times = [];
  for (let i = 0; i < 5; i++) {
    times.push(vi.getRealSystemTime());
  }

  // Real times should be monotonically increasing (or equal)
  for (let i = 1; i < times.length; i++) {
    expect(times[i]).toBeGreaterThanOrEqual(times[i - 1]);
  }

  // All real times should be recent (not epoch)
  for (const time of times) {
    expect(time).toBeGreaterThan(1700000000000); // After 2023
  }

  vi.useRealTimers();
});

test("vi.getMockedSystemTime() and new Date() return same time when mocked", () => {
  vi.useFakeTimers();
  vi.setSystemTime(1234567890000);

  const mockedTime = vi.getMockedSystemTime();
  const newDate = new Date();

  expect(mockedTime.getTime()).toBe(newDate.getTime());
  expect(mockedTime.getTime()).toBe(1234567890000);

  vi.useRealTimers();
});

test("vi.getRealSystemTime() differs from Date.now() when timers are mocked", () => {
  vi.useFakeTimers();
  vi.setSystemTime(1000000000000);

  const realTime = vi.getRealSystemTime();
  const mockedNow = Date.now();

  // They should be very different
  expect(Math.abs(realTime - mockedNow)).toBeGreaterThan(1000000000); // More than ~31 years difference

  vi.useRealTimers();
});

test("after useRealTimers, getMockedSystemTime returns null", () => {
  vi.useFakeTimers();
  vi.setSystemTime(1234567890000);

  // Should have a mocked time
  expect(vi.getMockedSystemTime()).not.toBeNull();
  expect(vi.getMockedSystemTime().getTime()).toBe(1234567890000);

  // After restoring real timers
  vi.useRealTimers();

  // Should return null
  expect(vi.getMockedSystemTime()).toBeNull();
});

test("getRealSystemTime works correctly across multiple timer state changes", () => {
  const realTimes = [];

  // Real timer mode
  vi.useRealTimers();
  realTimes.push(vi.getRealSystemTime());

  // Fake timer mode
  vi.useFakeTimers();
  vi.setSystemTime(0);
  realTimes.push(vi.getRealSystemTime());

  // Change mocked time
  vi.setSystemTime(9999999999999);
  realTimes.push(vi.getRealSystemTime());

  // Back to real timer mode
  vi.useRealTimers();
  realTimes.push(vi.getRealSystemTime());

  // All real times should be close to each other (within a second)
  const minTime = Math.min(...realTimes);
  const maxTime = Math.max(...realTimes);
  expect(maxTime - minTime).toBeLessThan(1000);

  // All should be recent
  for (const time of realTimes) {
    expect(time).toBeGreaterThan(1700000000000);
  }
});