import perf from "perf_hooks";
import { test, expect } from "bun:test";

test("stubs", () => {
  expect(() => perf.monitorEventLoopDelay()).toThrow();
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
  expect(() => perf.createHistogram()).not.toThrow();
  expect(() => performance.timerify(() => {})).not.toThrow();
  expect(() => performance.timerify(() => {}, { histogram: perf.createHistogram() })).not.toThrow();
});

test("timerify with histogram", () => {
  const histogram = perf.createHistogram({ auto: true });
  const fn = performance.timerify(() => {}, { histogram: histogram });
  expect(histogram.max).toBe(0); // should default to 0

  fn();
  expect(histogram.toJSON()).toBeObject();
  expect(histogram.min).toBeGreaterThan(0);
  expect(histogram.max).toBe(histogram.min); // one entry
  expect(histogram.percentiles.size).toBe(2); // 0th and 100th
  fn();
  expect(histogram.min).toBeGreaterThan(0);
  expect(histogram.max).toBeGreaterThan(histogram.min);
  expect(histogram.percentiles.size).toBeGreaterThan(2);
});

test("nested timerify", () => {
  const zeroth = (a, b = 1) => {};
  const first = performance.timerify(zeroth);
  const second = performance.timerify(first);
  expect(first).not.toBe(second);
  expect(second).not.toBe(first);
  expect(first.name).toBe("timerified zeroth");
  expect(second.name).toBe("timerified timerified zeroth");

  // assert.notStrictEqual(n, o);
  // assert.notStrictEqual(n, p);
  // assert.notStrictEqual(o, p);
  // assert.strictEqual(n.length, m.length);
  // assert.strictEqual(n.name, "timerified m");
  // assert.strictEqual(p.name, "timerified timerified m");
});
