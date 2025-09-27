import { test, expect } from "bun:test";
import { performance } from "node:perf_hooks";

test("perf_hooks: PerformanceNodeTiming properties should be accessible without throwing", () => {
  const nt = performance.nodeTiming;

  // These should not throw
  expect(() => nt.startTime).not.toThrow();
  expect(() => nt.duration).not.toThrow();

  // startTime should be 0 (relative to timeOrigin)
  expect(nt.startTime).toBe(0);

  // duration should be a positive number
  expect(typeof nt.duration).toBe("number");
  expect(nt.duration).toBeGreaterThanOrEqual(0);
});

test("perf_hooks: PerformanceNodeTiming timing values should be relative offsets", () => {
  const nt = performance.nodeTiming;

  // All timing values should be relative offsets from performance.timeOrigin, not absolute timestamps
  expect(typeof nt.nodeStart).toBe("number");
  expect(typeof nt.v8Start).toBe("number");
  expect(typeof nt.environment).toBe("number");
  expect(typeof nt.bootstrapComplete).toBe("number");

  // These should be small offsets, not epoch timestamps
  // If they were epoch timestamps, they'd be > 1000000000000 (year 2001+)
  expect(nt.nodeStart).toBeLessThan(1000000);
  expect(nt.v8Start).toBeLessThan(1000000);
  expect(nt.environment).toBeLessThan(1000000);
  expect(nt.bootstrapComplete).toBeLessThan(1000000);
});

test("perf_hooks: PerformanceNodeTiming should have expected properties", () => {
  const nt = performance.nodeTiming;

  // Check that all expected properties exist
  expect(nt).toHaveProperty("name");
  expect(nt).toHaveProperty("entryType");
  expect(nt).toHaveProperty("startTime");
  expect(nt).toHaveProperty("duration");
  expect(nt).toHaveProperty("nodeStart");
  expect(nt).toHaveProperty("v8Start");
  expect(nt).toHaveProperty("environment");
  expect(nt).toHaveProperty("bootstrapComplete");
  expect(nt).toHaveProperty("loopStart");
  expect(nt).toHaveProperty("loopExit");
  expect(nt).toHaveProperty("idleTime");

  // Check the fixed values
  expect(nt.name).toBe("node");
  expect(nt.entryType).toBe("node");
});

test("perf_hooks: PerformanceNodeTiming toJSON should work", () => {
  const nt = performance.nodeTiming;

  // toJSON should not throw
  expect(() => nt.toJSON()).not.toThrow();

  const json = nt.toJSON();
  expect(json).toHaveProperty("name", "node");
  expect(json).toHaveProperty("entryType", "node");
  expect(json).toHaveProperty("startTime", 0);
  expect(json).toHaveProperty("duration");
  expect(typeof json.duration).toBe("number");
});