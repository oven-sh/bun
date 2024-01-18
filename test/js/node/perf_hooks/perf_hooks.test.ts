import perf from "perf_hooks";
import { test, expect } from "bun:test";

test("stubs", () => {
  expect(() => perf.monitorEventLoopDelay()).toThrow();
  expect(() => perf.createHistogram()).toThrow();
  expect(perf.performance.nodeTiming).toBeObject();

  expect(perf.performance.now()).toBeNumber();
  expect(perf.performance.timeOrigin).toBeNumber();
  expect(perf.performance.eventLoopUtilization()).toBeObject();
});
