// https://github.com/sinonjs/fake-timers/blob/main/test/issue-207-test.js

import { afterEach, describe, expect, test, vi } from "bun:test";

afterEach(() => vi.useRealTimers());

describe("issue #207 - nanosecond round-off errors on high-res timer", () => {
  describe("hrtime", () => {
    test("should not round off nanosecond arithmetic on hrtime - case 1", () => {
      vi.useFakeTimers();
      vi.advanceTimersByTime(1022.7791);

      const nanos = process.hrtime([0, 2 * 1e7])[1];
      expect(nanos).toBe(2779100);
    });

    test("should not round off nanosecond arithmetic on hrtime - case 2", () => {
      vi.useFakeTimers({
        now: new Date("2018-09-12T08:58:33.742000000Z").getTime(),
      });
      const start = process.hrtime();
      vi.advanceTimersByTime(123.493);

      const nanos = process.hrtime(start)[1];
      expect(nanos).toBe(123493000);
    });

    test("should truncate sub-nanosecond ticks", () => {
      vi.useFakeTimers();
      vi.advanceTimersByTime(0.123456789);

      const nanos = process.hrtime()[1];
      expect(nanos).toBe(123456);
    });
  });

  test("should always set 'now' to an integer value when ticking with sub-millisecond precision", () => {
    vi.useFakeTimers();
    const startDateNow = Date.now();
    vi.advanceTimersByTime(2.993);

    expect((Date.now() - startDateNow) % 1).toBe(0);
  });

  test("should adjust the 'now' value when the nano-remainder overflows", () => {
    vi.useFakeTimers();
    const startDateNow = Date.now();
    vi.advanceTimersByTime(0.993);
    vi.advanceTimersByTime(0.5);

    expect(Date.now() - startDateNow).toBe(1);
  });

  test.todo("should floor negative now values", () => {
    // TODO: Need support for negative initial time in Bun's fake timers
    vi.useFakeTimers({ now: -1.2 });
  });

  test.todo("should floor start times", () => {
    // TODO: Need support for setting initial time in Bun's fake timers
    vi.useFakeTimers({ now: 1.2 });
  });

  test.todo("should floor negative start times", () => {
    // TODO: Need support for negative initial time in Bun's fake timers
    vi.useFakeTimers({ now: -1.2 });
  });

  test.todo("should handle ticks on the negative side of the Epoch", () => {
    // TODO: Need support for negative initial time in Bun's fake timers
    vi.useFakeTimers({ now: -2 });
    vi.advanceTimersByTime(0.8);
    vi.advanceTimersByTime(0.5);
  });

  test.todo("should handle multiple non-integer ticks", () => {
    // TODO: Need support for negative initial time in Bun's fake timers
    vi.useFakeTimers({ now: -2 });
    vi.advanceTimersByTime(1.1);
    vi.advanceTimersByTime(0.5);
    vi.advanceTimersByTime(0.5);
  });
});
