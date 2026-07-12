import { expect, test } from "bun:test";
import perf from "perf_hooks";

test("stubs", () => {
  expect(perf.performance.nodeTiming).toBeObject();

  expect(perf.performance.now()).toBeNumber();
  expect(perf.performance.timeOrigin).toBeNumber();
  expect(perf.performance.eventLoopUtilization()).toBeObject();
});

test("eventLoopUtilization reports active time for busy work", () => {
  const elu1 = perf.performance.eventLoopUtilization();
  const start = Date.now();
  while (Date.now() - start < 200);
  const elu2 = perf.performance.eventLoopUtilization(elu1);

  // Busy-waiting 200ms keeps the loop active; the delta should reflect it.
  expect(elu2.active).toBeGreaterThan(50);
  expect(elu2.utilization).toBeGreaterThan(0.5);
});

test("eventLoopUtilization reports idle time while awaiting", async () => {
  const elu1 = perf.performance.eventLoopUtilization();
  await Bun.sleep(200);
  const elu2 = perf.performance.eventLoopUtilization(elu1);

  // Sleeping blocks the loop in the event provider; that counts as idle.
  expect(elu2.idle).toBeGreaterThan(50);
  expect(elu2.utilization).toBeLessThan(0.5);
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
