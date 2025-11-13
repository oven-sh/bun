// https://github.com/sinonjs/fake-timers/blob/main/test/issue-315-test.js

import { afterEach, describe, expect, test, vi } from "bun:test";

afterEach(() => vi.useRealTimers());

describe("issue #315 - parseInt if delay is not a number", () => {
  test("should successfully execute the timer", () => {
    vi.useFakeTimers();
    const stub1 = vi.fn();

    setTimeout(stub1, "1" as any);
    vi.advanceTimersByTime(1);
    expect(stub1).toHaveBeenCalledTimes(1);
  });
});
