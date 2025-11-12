import { afterEach, describe, expect, test, vi } from "bun:test";

afterEach(() => vi.useRealTimers());

describe("issue #73", () => {
  test.todo("should install with date object", () => {
    // TODO: Bun's fake timers don't currently support setting initial time via `now` option
    // or vi.setSystemTime(). This test needs implementation.
    const date = new Date("2015-09-25");
    vi.useFakeTimers({ now: date });
    expect(Date.now()).toBe(1443139200000);
  });
});
