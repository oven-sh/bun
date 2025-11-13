// https://github.com/sinonjs/fake-timers/blob/main/test/issue-2449-test.js

import { afterEach, describe, expect, test, vi } from "bun:test";

afterEach(() => vi.useRealTimers());

describe("issue #2449: permanent loss of native functions", () => {
  test.todo("should not fake faked timers", () => {
    // TODO: vi.useFakeTimers doesn't throw when called twice (different from FakeTimers.install)
    // and doesn't support setting initial time via `now` option yet
    const currentTime = new Date().getTime();
    const date1 = new Date("2015-09-25");
    const date2 = new Date("2015-09-26");

    vi.useFakeTimers({ now: date1 });
    // Cannot test clock.now property as vi doesn't expose it
    // expect(Date.now()).toBe(1443139200000);

    // Double install should throw
    expect(() => {
      vi.useFakeTimers({ now: date2 });
    }).toThrow();

    vi.useRealTimers();
    vi.useFakeTimers({ now: date2 });
    // expect(Date.now()).toBe(date2.getTime());
    vi.useRealTimers();

    // Check that real time is restored
    const afterTime = new Date().getTime();
    expect(Math.abs(afterTime - currentTime)).toBeLessThan(1000);
  });

  test.skip("should not fake faked timers on a custom target", () => {
    // This test uses FakeTimers.withGlobal which is not available in vi API
  });

  test.skip("should not allow a fake on a custom target if the global is faked and the context inherited from the global", () => {
    // This test uses FakeTimers.withGlobal which is not available in vi API
  });

  test.skip("should allow a fake on the global if a fake on a customer target is already defined", () => {
    // This test uses FakeTimers.withGlobal which is not available in vi API
  });
});
