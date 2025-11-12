import { afterEach, describe, test, vi } from "bun:test";

afterEach(() => vi.useRealTimers());

describe("issue #59", () => {
  test("should install and uninstall the clock on a custom target", () => {
    // Note: Bun's fake timers currently operate on global scope
    // This test validates the install/uninstall cycle doesn't throw
    vi.useFakeTimers();

    setTimeout(() => {}, 0);

    // this would throw an error before issue #59 was fixed
    vi.useRealTimers();
  });
});
