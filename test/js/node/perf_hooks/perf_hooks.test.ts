import perf from "perf_hooks";
import { test, expect } from "bun:test";

test("stubs", () => {
  expect(perf.performance.nodeTiming).toBeObject();
  expect(perf.performance.now()).toBeNumber();
  expect(perf.performance.timeOrigin).toBeNumber();
  expect(perf.performance.eventLoopUtilization()).toBeObject();
  expect(perf.createHistogram).toBeFunction();
  expect(perf.createHistogram()).toBeObject();
  expect(perf.monitorEventLoopDelay).toBeFunction();
  expect(perf.monitorEventLoopDelay()).toBeObject();
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
});
