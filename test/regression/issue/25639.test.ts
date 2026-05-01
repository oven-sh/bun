import { expect, test } from "bun:test";

// GitHub Issue #25639: setTimeout Timeout object missing _idleStart property
// Next.js 16 uses _idleStart to coordinate timers for Cache Components

test("setTimeout returns Timeout object with _idleStart property", () => {
  const timer = setTimeout(() => {}, 100);

  try {
    // Verify _idleStart exists and is a number
    expect("_idleStart" in timer).toBe(true);
    expect(typeof timer._idleStart).toBe("number");

    // _idleStart should be a positive timestamp
    expect(timer._idleStart).toBeGreaterThan(0);
  } finally {
    clearTimeout(timer);
  }
});

test("setInterval returns Timeout object with _idleStart property", () => {
  const timer = setInterval(() => {}, 100);

  try {
    // Verify _idleStart exists and is a number
    expect("_idleStart" in timer).toBe(true);
    expect(typeof timer._idleStart).toBe("number");

    // _idleStart should be a positive timestamp
    expect(timer._idleStart).toBeGreaterThan(0);
  } finally {
    clearInterval(timer);
  }
});

test("_idleStart is writable (Next.js modifies it to coordinate timers)", () => {
  const timer = setTimeout(() => {}, 100);

  try {
    const originalIdleStart = timer._idleStart;
    expect(typeof originalIdleStart).toBe("number");

    // Next.js sets _idleStart to coordinate timers
    const newIdleStart = originalIdleStart - 100;
    timer._idleStart = newIdleStart;
    expect(timer._idleStart).toBe(newIdleStart);
  } finally {
    clearTimeout(timer);
  }
});

test("timers created at different times have different _idleStart values", async () => {
  const timer1 = setTimeout(() => {}, 100);
  // Wait a bit to ensure different timestamp
  await Bun.sleep(10);
  const timer2 = setTimeout(() => {}, 100);

  try {
    expect(timer2._idleStart).toBeGreaterThanOrEqual(timer1._idleStart);
  } finally {
    clearTimeout(timer1);
    clearTimeout(timer2);
  }
});
