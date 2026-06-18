import { expect, test } from "bun:test";
import perf from "perf_hooks";

test("stubs", () => {
  expect(perf.performance.nodeTiming).toBeObject();

  expect(perf.performance.now()).toBeNumber();
  expect(perf.performance.timeOrigin).toBeNumber();
  expect(perf.performance.eventLoopUtilization()).toBeObject();
});

// $toClass is used to wire PerformanceNodeTiming/PerformanceResourceTiming
// (class declarations) to PerformanceEntry as their base. The instance
// prototype chain must reach PerformanceEntry.prototype, and the class body's
// own getters must remain in place. https://github.com/oven-sh/bun/issues/32160
test("nodeTiming inherits from PerformanceEntry and keeps its class getters", () => {
  const nodeTiming = perf.performance.nodeTiming;
  expect(nodeTiming instanceof perf.PerformanceEntry).toBe(true);
  expect(Object.getPrototypeOf(perf.PerformanceNodeTiming.prototype)).toBe(perf.PerformanceEntry.prototype);
  expect(nodeTiming.name).toBe("node");
  expect(nodeTiming.entryType).toBe("node");
  expect(Object.getPrototypeOf(perf.PerformanceResourceTiming.prototype)).toBe(perf.PerformanceEntry.prototype);
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
