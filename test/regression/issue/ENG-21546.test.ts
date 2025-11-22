import { expect, setSystemTime, test } from "bun:test";

// Regression test for ENG-21546: setSystemTime(new Date(0)) silently fails
// The bug was caused by using std::isnormal() which returns false for 0,
// causing setSystemTime(new Date(0)) to silently not set the time.

test("setSystemTime(new Date(0)) should set time to Unix epoch", () => {
  try {
    setSystemTime(new Date(0));
    expect(Date.now()).toBe(0);
    expect(new Date().getTime()).toBe(0);
    expect(new Date().toISOString()).toBe("1970-01-01T00:00:00.000Z");
  } finally {
    setSystemTime(); // Reset to real time
  }
});

test("setSystemTime(0) should set time to Unix epoch", () => {
  try {
    setSystemTime(0);
    expect(Date.now()).toBe(0);
    expect(new Date().getTime()).toBe(0);
  } finally {
    setSystemTime();
  }
});

test("setSystemTime with positive Date instance should work", () => {
  try {
    const date2020 = new Date("2020-01-01T00:00:00.000Z");
    setSystemTime(date2020);
    expect(Date.now()).toBe(date2020.getTime());
    expect(new Date().toISOString()).toBe("2020-01-01T00:00:00.000Z");
  } finally {
    setSystemTime();
  }
});

test("setSystemTime with positive number should work", () => {
  try {
    setSystemTime(1577836800000); // 2020-01-01T00:00:00.000Z
    expect(Date.now()).toBe(1577836800000);
  } finally {
    setSystemTime();
  }
});

test("setSystemTime(Infinity) should reset to real time", () => {
  try {
    setSystemTime(1000);
    expect(Date.now()).toBe(1000);

    setSystemTime(Infinity);
    // Should be reset to real time (not Infinity)
    const now = Date.now();
    expect(isFinite(now)).toBe(true);
    expect(now).toBeGreaterThan(1000000000000); // After 2001
  } finally {
    setSystemTime();
  }
});

test("setSystemTime(NaN) should reset to real time", () => {
  try {
    setSystemTime(1000);
    expect(Date.now()).toBe(1000);

    setSystemTime(NaN);
    // Should be reset to real time (not NaN)
    const now = Date.now();
    expect(isFinite(now)).toBe(true);
    expect(now).toBeGreaterThan(1000000000000);
  } finally {
    setSystemTime();
  }
});

test("setSystemTime() with no args should reset to real time", () => {
  try {
    setSystemTime(1000);
    expect(Date.now()).toBe(1000);

    setSystemTime();
    const now = Date.now();
    expect(now).toBeGreaterThan(1000000000000);
  } finally {
    setSystemTime();
  }
});

test("setSystemTime with undefined should reset to real time", () => {
  try {
    setSystemTime(1000);
    expect(Date.now()).toBe(1000);

    setSystemTime(undefined);
    const now = Date.now();
    expect(now).toBeGreaterThan(1000000000000);
  } finally {
    setSystemTime();
  }
});

test("setSystemTime with small positive values should work", () => {
  try {
    // Test with 1 millisecond
    setSystemTime(1);
    expect(Date.now()).toBe(1);

    // Test with subnormal-ish value (very small but positive)
    setSystemTime(0.001);
    expect(Date.now()).toBe(0.001);
  } finally {
    setSystemTime();
  }
});
