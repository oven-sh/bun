test("we can go back in time", () => {
  const DateBeforeMocked = Date;
  const orig = new Date();
  orig.setHours(0, 0, 0, 0);
  jest.useFakeTimers();
  jest.setSystemTime(new Date("1995-12-19T00:00:00.000Z"));

  expect(new Date().toISOString()).toBe("1995-12-19T00:00:00.000Z");
  expect(Date.now()).toBe(819331200000);

  if (typeof Bun !== "undefined") {
    // In bun, the Date object remains the same despite being mocked.
    // This prevents a whole bunch of subtle bugs in tests.
    expect(DateBeforeMocked).toBe(Date);
    expect(DateBeforeMocked.now).toBe(Date.now);

    // Jest doesn't property mock new Intl.DateTimeFormat().format()
    expect(new Intl.DateTimeFormat().format()).toBe("12/19/1995");
  } else {
    expect(DateBeforeMocked).not.toBe(Date);
    expect(DateBeforeMocked.now).not.toBe(Date.now);
  }
  jest.setSystemTime(new Date("2020-01-01T00:00:00.000Z").getTime());
  expect(new Date().toISOString()).toBe("2020-01-01T00:00:00.000Z");
  expect(Date.now()).toBe(1577836800000);
  jest.useRealTimers();
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  expect(now.toISOString()).toBe(orig.toISOString());
});

test("advanceTimersByTime ticks from the setSystemTime value", () => {
  jest.useFakeTimers();
  try {
    const base = new Date("2026-01-01T12:00:00.000Z").getTime();
    jest.setSystemTime(new Date(base));
    expect(Date.now()).toBe(base);

    jest.advanceTimersByTime(1000);
    expect(Date.now()).toBe(base + 1000);
    expect(new Date().toISOString()).toBe("2026-01-01T12:00:01.000Z");

    jest.advanceTimersByTime(500);
    expect(Date.now()).toBe(base + 1500);

    // setSystemTime with a number argument rebases again
    jest.setSystemTime(base);
    jest.advanceTimersByTime(2000);
    expect(Date.now()).toBe(base + 2000);
  } finally {
    jest.useRealTimers();
  }
});

test("setSystemTime accepts pre-epoch and epoch times and resets with no argument", () => {
  const realBefore = Date.now();
  jest.useFakeTimers();
  try {
    jest.setSystemTime(new Date("1960-01-01T00:00:00.000Z"));
    expect(Date.now()).toBe(-315619200000);
    expect(new Date().toISOString()).toBe("1960-01-01T00:00:00.000Z");

    jest.setSystemTime(0);
    expect(Date.now()).toBe(0);

    // -1 is an ordinary timestamp (1969-12-31T23:59:59.999Z), not a sentinel.
    jest.setSystemTime(-1);
    expect(Date.now()).toBe(-1);

    jest.setSystemTime();
    expect(Date.now()).toBeGreaterThanOrEqual(realBefore);
  } finally {
    jest.useRealTimers();
  }
});
