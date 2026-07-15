import { describe, expect, test } from "bun:test";
import perf, { PerformanceObserver } from "perf_hooks";

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

describe("PerformanceObserver.supportedEntryTypes", () => {
  test("node:perf_hooks returns the same frozen array on every access", () => {
    const a = PerformanceObserver.supportedEntryTypes;
    const b = PerformanceObserver.supportedEntryTypes;
    expect(Object.isFrozen(a)).toBe(true);
    expect(b).toBe(a);
    expect(() => (a as string[]).push("evil")).toThrow(TypeError);
    expect(PerformanceObserver.supportedEntryTypes.includes("evil")).toBe(false);
    expect(PerformanceObserver.supportedEntryTypes).toBe(a);
  });

  test("globalThis.PerformanceObserver returns the same frozen array on every access", () => {
    const a = globalThis.PerformanceObserver.supportedEntryTypes;
    const b = globalThis.PerformanceObserver.supportedEntryTypes;
    expect(Object.isFrozen(a)).toBe(true);
    expect(b).toBe(a);
    expect(() => (a as string[]).push("evil")).toThrow(TypeError);
    expect(globalThis.PerformanceObserver.supportedEntryTypes.includes("evil")).toBe(false);
    expect(globalThis.PerformanceObserver.supportedEntryTypes).toBe(a);
  });
});
