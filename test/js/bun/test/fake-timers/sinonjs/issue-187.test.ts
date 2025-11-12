import { afterEach, describe, expect, test, vi } from "bun:test";

afterEach(() => vi.useRealTimers());

const NOOP = () => {};

describe("#187 - Support timeout.refresh in node environments", () => {
  test("calls the stub again after refreshing the timeout", () => {
    vi.useFakeTimers();
    const stub = vi.fn();

    // Check if setTimeout returns an object (Node.js style)
    if (typeof setTimeout(NOOP, 0) === "object") {
      const t = setTimeout(stub, 1000);
      vi.advanceTimersByTime(1000);
      t.refresh();
      vi.advanceTimersByTime(1000);
      expect(stub).toHaveBeenCalledTimes(2);
    }
  });

  test("only calls stub once if not fired at time of refresh", () => {
    vi.useFakeTimers();
    const stub = vi.fn();

    // Check if setTimeout returns an object (Node.js style)
    if (typeof setTimeout(NOOP, 0) === "object") {
      const t = setTimeout(stub, 1000);
      vi.advanceTimersByTime(999);
      expect(stub).not.toHaveBeenCalled();
      t.refresh();
      vi.advanceTimersByTime(999);
      expect(stub).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(stub).toHaveBeenCalledTimes(1);
    }
  });
});
