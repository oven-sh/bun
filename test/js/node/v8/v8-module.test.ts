import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug } from "harness";
import { GCProfiler, getHeapStatistics, isStringOneByteRepresentation } from "node:v8";
import vm from "node:vm";

describe("v8.getHeapStatistics", () => {
  test("returns all expected fields as non-negative numbers", () => {
    const stats = getHeapStatistics();
    expect(Object.keys(stats).sort()).toEqual(
      [
        "total_heap_size",
        "total_heap_size_executable",
        "total_physical_size",
        "total_available_size",
        "used_heap_size",
        "total_allocated_bytes",
        "heap_size_limit",
        "malloced_memory",
        "peak_malloced_memory",
        "does_zap_garbage",
        "number_of_native_contexts",
        "number_of_detached_contexts",
        "total_global_handles_size",
        "used_global_handles_size",
        "external_memory",
      ].sort(),
    );
    for (const [key, value] of Object.entries(stats)) {
      expect(value, key).toBeNumber();
      expect(value, key).toBeGreaterThanOrEqual(0);
    }
    expect(stats.number_of_native_contexts).toBeGreaterThanOrEqual(1);
  });

  test("number_of_native_contexts counts node:vm contexts", () => {
    Bun.gc(true);
    const before = getHeapStatistics().number_of_native_contexts;
    const contexts = [vm.createContext({}), vm.createContext({}), vm.createContext({})];
    expect(getHeapStatistics().number_of_native_contexts).toBe(before + contexts.length);
  });

  // https://github.com/oven-sh/bun/issues/19254
  test("stays cheap and does not grow RSS when called repeatedly", async () => {
    const script = /* js */ `
      const { getHeapStatistics, getHeapSpaceStatistics } = require("node:v8");

      for (let i = 0; i < 50; i++) {
        getHeapStatistics();
        getHeapSpaceStatistics();
      }
      Bun.gc(true);
      const rssBefore = process.memoryUsage.rss();

      for (let i = 0; i < 1000; i++) {
        getHeapStatistics();
        getHeapSpaceStatistics();
      }

      Bun.gc(true);
      const rssAfter = process.memoryUsage.rss();

      process.stdout.write(JSON.stringify({
        rssDeltaMB: (rssAfter - rssBefore) / 1024 / 1024,
      }));
    `;

    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    const { rssDeltaMB } = JSON.parse(stdout) as { rssDeltaMB: number };
    expect(exitCode).toBe(0);

    const rssLimit = isASAN || isDebug ? 20 : 10;
    expect(rssDeltaMB, `RSS grew by ${rssDeltaMB.toFixed(2)} MB over 1000 iterations`).toBeLessThan(rssLimit);
  });
});

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
  test("class name", () => {
    expect(GCProfiler.name).toBe("GCProfiler");
  });

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

  test("full collection does not report external memory growing", () => {
    const profiler = new GCProfiler();
    profiler.start();
    Bun.gc(true);
    const report = profiler.stop()!;
    const full = report.statistics.find(e => e.gcType === "MarkSweepCompact");
    expect(full).not.toBeUndefined();
    // JSC zeroes m_extraMemorySize before notifying observers of a full
    // collection, so a prologue sample would under-report and make external
    // memory appear to grow. The implementation reuses the epilogue value.
    expect(full!.beforeGC.heapStatistics.externalMemory).toBe(full!.afterGC.heapStatistics.externalMemory);
    expect(full!.beforeGC.heapStatistics.totalHeapSize).toBe(full!.afterGC.heapStatistics.totalHeapSize);
  });

  test("worker exiting with an open session does not crash", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const { Worker } = require("node:worker_threads");
          const w = new Worker(
            'const { GCProfiler } = require("v8"); new GCProfiler().start();',
            { eval: true },
          );
          w.on("error", e => { console.error(e); process.exit(1); });
          w.on("exit", code => { console.log("worker exit " + code); });
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({
      stdout: "worker exit 0\n",
      stderr: "",
      exitCode: 0,
    });
  });
});
