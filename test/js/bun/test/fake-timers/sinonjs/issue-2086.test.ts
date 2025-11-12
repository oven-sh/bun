import { afterEach, describe, expect, test, vi } from "bun:test";

afterEach(() => vi.useRealTimers());

describe("issue #sinonjs/2086 - don't install setImmediate in unsupported environment", () => {
  if (typeof setImmediate === "undefined") {
    test("should not install setImmediate", () => {
      vi.useFakeTimers();
      expect(global.setImmediate).toBeUndefined();
    });
  }
});
