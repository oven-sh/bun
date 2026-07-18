import { describe, expect, test } from "bun:test";
import { GCProfiler, isStringOneByteRepresentation } from "node:v8";

describe("v8.isStringOneByteRepresentation", () => {
  test("rejects non-string arguments", () => {
    for (const value of [undefined, null, false, 5n, 5, Symbol(), () => {}, {}]) {
      expect(() => isStringOneByteRepresentation(value as any)).toThrow(
        /The "content" argument must be of type string/,
      );
    }
  });

  test("reports storage width", () => {
    expect(isStringOneByteRepresentation("hello world!")).toBe(true);
    expect(isStringOneByteRepresentation("")).toBe(true);
    expect(isStringOneByteRepresentation("你好😀😃")).toBe(false);
  });
});

describe("v8.GCProfiler", () => {
  test("start/stop records a forced collection", () => {
    const profiler = new GCProfiler();
    profiler.start();
    // Second start() on an active session is a no-op, not an error.
    profiler.start();
    Bun.gc(true);
    const report = profiler.stop();

    expect(report).not.toBeUndefined();
    expect(report!.version).toBeGreaterThan(0);
    expect(report!.startTime).toBeGreaterThanOrEqual(0);
    expect(report!.endTime).toBeGreaterThanOrEqual(report!.startTime);
    expect(Array.isArray(report!.statistics)).toBe(true);
    expect(report!.statistics.length).toBeGreaterThan(0);

    const entry = report!.statistics[0];
    expect(["Scavenge", "MarkSweepCompact"]).toContain(entry.gcType);
    expect(entry.cost).toBeGreaterThanOrEqual(0);

    const heapStatisticsKeys = [
      "externalMemory",
      "heapSizeLimit",
      "mallocedMemory",
      "peakMallocedMemory",
      "totalAvailableSize",
      "totalGlobalHandlesSize",
      "totalHeapSize",
      "totalHeapSizeExecutable",
      "totalPhysicalSize",
      "usedGlobalHandlesSize",
      "usedHeapSize",
    ];
    for (const key of heapStatisticsKeys) {
      expect(entry.beforeGC.heapStatistics[key]).toBeGreaterThanOrEqual(0);
      expect(entry.afterGC.heapStatistics[key]).toBeGreaterThanOrEqual(0);
    }

    const space = entry.afterGC.heapSpaceStatistics[0];
    expect(typeof space.spaceName).toBe("string");
    for (const key of ["spaceSize", "spaceUsedSize", "spaceAvailableSize", "physicalSpaceSize"]) {
      expect(space[key]).toBeGreaterThanOrEqual(0);
    }

    // stop() on an inactive profiler returns undefined rather than throwing.
    expect(profiler.stop()).toBeUndefined();
  });

  test("Symbol.dispose stops without returning a report", () => {
    const profiler = new GCProfiler();
    profiler.start();
    expect(profiler[Symbol.dispose]()).toBeUndefined();
    // Idempotent: a second dispose and a stop() after dispose both no-op.
    expect(profiler[Symbol.dispose]()).toBeUndefined();
    expect(profiler.stop()).toBeUndefined();
  });

  test("restart after stop", () => {
    const profiler = new GCProfiler();
    profiler.start();
    profiler.stop();
    profiler.start();
    Bun.gc(true);
    const report = profiler.stop();
    expect(report).not.toBeUndefined();
    expect(Array.isArray(report!.statistics)).toBe(true);
  });
});
