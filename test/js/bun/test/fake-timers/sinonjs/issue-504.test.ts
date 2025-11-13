// https://github.com/sinonjs/fake-timers/blob/main/test/issue-504-test.js

import { afterEach, describe, expect, test, vi } from "bun:test";

afterEach(() => vi.useRealTimers());

describe("issue #504", () => {
  test("should not mutate Date class", () => {
    const priorDate = new Date();
    expect(priorDate instanceof Date).toBe(true);

    vi.useFakeTimers();

    const afterDate = new Date();
    expect(priorDate instanceof Date).toBe(true);
    expect(afterDate instanceof Date).toBe(true);
  });
});
