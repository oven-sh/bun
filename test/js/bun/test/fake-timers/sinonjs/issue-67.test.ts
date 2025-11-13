// https://github.com/sinonjs/fake-timers/blob/main/test/issue-67-test.js

import { afterEach, describe, expect, test, vi } from "bun:test";

afterEach(() => vi.useRealTimers());

describe("issue #67", () => {
  // see https://nodejs.org/api/timers.html
  test("should overflow to 1 on very big timeouts", () => {
    vi.useFakeTimers();
    const stub1 = vi.fn();
    const stub2 = vi.fn();

    setTimeout(stub1, 100);
    setTimeout(stub2, 214748334700); // should be called after 1 tick

    vi.advanceTimersByTime(1);
    expect(stub2).toHaveBeenCalled();
    expect(stub1).not.toHaveBeenCalled();

    vi.advanceTimersByTime(99);
    expect(stub1).toHaveBeenCalled();
    expect(stub2).toHaveBeenCalled();
  });

  test("should overflow to interval 1 on very big timeouts", () => {
    vi.useFakeTimers();
    const stub = vi.fn();

    setInterval(stub, 214748334700);
    vi.advanceTimersByTime(3);
    expect(stub).toHaveBeenCalledTimes(3);
  });

  test("should execute setTimeout smaller than 1", () => {
    vi.useFakeTimers();
    const stub1 = vi.fn();

    setTimeout(stub1, 0.5);
    vi.advanceTimersByTime(1);
    expect(stub1).toHaveBeenCalledTimes(1);
  });

  test("executes setTimeout with negative duration as if it has zero delay", () => {
    vi.useFakeTimers();
    const stub1 = vi.fn();

    setTimeout(stub1, -10);
    vi.advanceTimersByTime(1);
    expect(stub1).toHaveBeenCalledTimes(1);
  });
});
