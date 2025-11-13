// https://github.com/sinonjs/fake-timers/blob/main/test/issue-368-test.js

import { afterEach, describe, expect, test, vi } from "bun:test";

const NOOP = () => {};
const addTimerReturnsObject = typeof setTimeout(NOOP, 0) === "object";

afterEach(() => vi.useRealTimers());

describe("#368 - timeout.refresh setTimeout arguments", () => {
  if (addTimerReturnsObject) {
    test("should forward arguments passed to setTimeout", () => {
      vi.useFakeTimers();
      const stub = vi.fn();

      const t = setTimeout(stub, 1000, "test");
      vi.advanceTimersByTime(1000);
      t.refresh();
      vi.advanceTimersByTime(1000);
      expect(stub).toHaveBeenCalledTimes(2);
      expect(stub).toHaveBeenCalledWith("test");
    });
  }
});
