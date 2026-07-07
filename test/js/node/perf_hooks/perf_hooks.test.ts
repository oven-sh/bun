import { describe, expect, test } from "bun:test";
import perf, { monitorEventLoopDelay } from "perf_hooks";

test("stubs", () => {
  expect(perf.performance.nodeTiming).toBeObject();

  expect(perf.performance.now()).toBeNumber();
  expect(perf.performance.timeOrigin).toBeNumber();
  expect(perf.performance.eventLoopUtilization()).toBeObject();
});

test("doesn't throw", () => {
  expect(() => performance.mark("test")).not.toThrow();
  expect(() => performance.measure("test", "test")).not.toThrow();
  expect(() => performance.clearMarks()).not.toThrow();
  expect(() => performance.clearMeasures()).not.toThrow();
  expect(() => performance.getEntries()).not.toThrow();
  expect(() => performance.getEntriesByName("test")).not.toThrow();
  expect(() => performance.getEntriesByType("measure")).not.toThrow();
  expect(() => performance.now()).not.toThrow();
  expect(() => performance.timeOrigin).not.toThrow();
  expect(() => performance.markResourceTiming()).not.toThrow();
});

describe("monitorEventLoopDelay", () => {
  test("each call returns an independent histogram", () => {
    const a = monitorEventLoopDelay({ resolution: 5 });
    const b = monitorEventLoopDelay({ resolution: 5 });
    try {
      expect(a === b).toBe(false);

      // enable A; B has never been enabled
      expect(a.enable()).toBe(true);
      // disabling B (never enabled) must return false and must not affect A
      expect(b.disable()).toBe(false);
      // A is still enabled, so disabling it returns true
      expect(a.disable()).toBe(true);
      // A is now disabled
      expect(a.disable()).toBe(false);

      // Two monitors can be enabled concurrently
      expect(a.enable()).toBe(true);
      expect(b.enable()).toBe(true);
      expect(a.enable()).toBe(false);
      expect(b.enable()).toBe(false);
    } finally {
      a.disable();
      b.disable();
    }
  });

  async function waitForCount(h: ReturnType<typeof monitorEventLoopDelay>, min: number) {
    while (h.count < min) {
      await new Promise(resolve => setTimeout(resolve, 1));
    }
  }

  test("disable on one monitor does not stop another", async () => {
    const a = monitorEventLoopDelay({ resolution: 1 });
    const b = monitorEventLoopDelay({ resolution: 1 });
    try {
      a.enable();
      await waitForCount(a, 1);
      const before = a.count;
      // B was never enabled; disabling it must not stop A
      expect(b.disable()).toBe(false);
      await waitForCount(a, before + 2);
      expect(a.count).toBeGreaterThan(before);
    } finally {
      a.disable();
      b.disable();
    }
  });

  test("reset on one monitor does not clear another", async () => {
    const a = monitorEventLoopDelay({ resolution: 1 });
    const b = monitorEventLoopDelay({ resolution: 1 });
    try {
      a.enable();
      b.enable();
      await waitForCount(a, 2);
      await waitForCount(b, 2);
      b.reset();
      expect(a.count).toBeGreaterThanOrEqual(2);
    } finally {
      a.disable();
      b.disable();
    }
  });
});
