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

test("timer methods sanitize `this` on bare calls", () => {
  try {
    // normal method calls keep returning the jest object for chaining
    expect(jest.setSystemTime(0)).toBe(jest);
    expect(jest.useFakeTimers()).toBe(jest);
    expect(jest.useRealTimers()).toBe(jest);

    // a bare call through a captured variable makes JSC pass the activation
    // object as the raw `this`; it must not be returned to user code
    const setSystemTime = jest.setSystemTime;
    const useFakeTimers = jest.useFakeTimers;
    const useRealTimers = jest.useRealTimers;
    function capture() {
      return [setSystemTime, useFakeTimers, useRealTimers];
    }
    expect(setSystemTime(0)).toBeUndefined();
    expect(useFakeTimers()).toBeUndefined();
    expect(useRealTimers()).toBeUndefined();
  } finally {
    jest.useRealTimers();
  }
});
