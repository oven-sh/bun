import { expect, test } from "bun:test";
import { performance, PerformanceEntry } from "node:perf_hooks";

// https://github.com/oven-sh/bun/issues/23041
// perf_hooks PerformanceNodeTiming: startTime/duration throw TypeError,
// timing values should be relative offsets not absolute timestamps
test("PerformanceNodeTiming startTime and duration do not throw", () => {
  const nt = performance.nodeTiming;

  // These should not throw - they previously threw:
  // "The PerformanceEntry.startTime getter can only be used on instances of PerformanceEntry"
  expect(() => nt.startTime).not.toThrow();
  expect(() => nt.duration).not.toThrow();

  // startTime should be 0 (matching Node.js behavior)
  expect(nt.startTime).toBe(0);

  // duration should be a positive number (elapsed time)
  expect(typeof nt.duration).toBe("number");
  expect(nt.duration).toBeGreaterThan(0);
});

test("PerformanceNodeTiming has correct name and entryType", () => {
  const nt = performance.nodeTiming;

  expect(nt.name).toBe("node");
  expect(nt.entryType).toBe("node");
});

test("PerformanceNodeTiming timing values are relative offsets, not absolute timestamps", () => {
  const nt = performance.nodeTiming;

  // nodeStart should be a small offset relative to timeOrigin, not an epoch timestamp.
  // Epoch timestamps are > 1e12 (year ~2001+), offsets should be much smaller.
  expect(nt.nodeStart).toBeLessThan(10_000); // should be well under 10 seconds
  expect(nt.nodeStart).toBeGreaterThanOrEqual(0);

  // Same for other timing properties
  expect(nt.environment).toBeLessThan(10_000);
  expect(nt.bootstrapComplete).toBeLessThan(10_000);
  expect(nt.v8Start).toBeLessThan(10_000);

  // In Bun, nodeStart and v8Start are 0 (VM start IS the time origin)
  expect(nt.nodeStart).toBe(0);
  expect(nt.v8Start).toBe(0);

  // bootstrapComplete should be > 0 (time taken to bootstrap)
  expect(nt.bootstrapComplete).toBeGreaterThan(0);
});

test("PerformanceNodeTiming is instanceof PerformanceEntry", () => {
  const nt = performance.nodeTiming;

  expect(nt instanceof PerformanceEntry).toBe(true);
});

test("PerformanceNodeTiming toJSON returns correct shape", () => {
  const nt = performance.nodeTiming;
  const json = nt.toJSON();

  expect(json).toHaveProperty("name", "node");
  expect(json).toHaveProperty("entryType", "node");
  expect(json).toHaveProperty("startTime", 0);
  expect(typeof json.duration).toBe("number");
  expect(typeof json.nodeStart).toBe("number");
  expect(typeof json.bootstrapComplete).toBe("number");
  expect(typeof json.environment).toBe("number");
  expect(typeof json.v8Start).toBe("number");
  expect(typeof json.idleTime).toBe("number");
  expect(typeof json.loopStart).toBe("number");
  expect(typeof json.loopExit).toBe("number");
});
