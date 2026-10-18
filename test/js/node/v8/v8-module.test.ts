import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { truncateSync } from "node:fs";
import { join } from "node:path";
import { GCProfiler, isStringOneByteRepresentation, type HeapInfo } from "node:v8";

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

describe("v8.getHeapStatistics", () => {
  async function runChild(script: string, cwd?: string) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: bunEnv,
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).not.toBe("");
    expect(exitCode).toBe(0);
    return JSON.parse(stdout);
  }

  // An ArrayBuffer that is never written counts in the heap and not in the RSS. This holds such buffers, worth
  // twice the limit reported at start. The 8 GiB cap bounds the reservation: on Linux the child starts with the
  // peak RSS of the process that spawned it.
  const holdUnwrittenBuffers = `
    const v8 = require("node:v8");
    const totalmem = require("node:os").totalmem();
    const { memoryUsage } = require("bun:jsc");
    const limitOfResidentHeap = () => Math.min(memoryUsage().peak * 10, totalmem);
    const lo = limitOfResidentHeap();
    const atStart = v8.getHeapStatistics();
    const hi = limitOfResidentHeap();
    const chunk = 64 * 1024 * 1024;
    const keep = [];
    for (let held = 0; held < Math.min(atStart.heap_size_limit * 2, 8 * 1024 ** 3); held += chunk) {
      keep.push(new ArrayBuffer(chunk));
    }
    Bun.gc(true);
    const held = v8.getHeapStatistics();
    const report = { lo, hi, totalmem, atStart, held, buffers: keep.length };
  `;

  // total_allocated_bytes is the capacity of the heap and total_physical_size is the peak RSS, from the same read.
  const capacityOf = (stats: HeapInfo) => Math.max(stats.total_allocated_bytes, stats.used_heap_size);
  const limitFor = (stats: HeapInfo, totalmem: number) =>
    Math.min(10 * Math.max(stats.total_physical_size, capacityOf(stats)), Math.max(totalmem, capacityOf(stats)));

  function expectLimitToCoverHeap({ held, totalmem }: { held: HeapInfo; totalmem: number }) {
    // The heap declares more than the process ever had resident.
    expect(capacityOf(held)).toBeGreaterThan(held.total_physical_size);
    // Next.js restarts its dev server when used_heap_size is above 80% of heap_size_limit.
    expect(held.used_heap_size).toBeLessThanOrEqual(held.heap_size_limit);
    expect(held.heap_size_limit).toBe(limitFor(held, totalmem));
  }

  test("heap_size_limit covers a heap that holds memory that is not resident", async () => {
    const report = await runChild(`${holdUnwrittenBuffers}\nconsole.log(JSON.stringify(report));`);
    // While the capacity is below the peak RSS, both fields keep the value they had.
    expect(report.atStart.heap_size_limit).toBeGreaterThanOrEqual(report.lo);
    expect(report.atStart.heap_size_limit).toBeLessThanOrEqual(report.hi);
    expect(report.atStart.total_available_size).toBe(report.totalmem - report.atStart.used_heap_size);
    expectLimitToCoverHeap(report);
  });

  test("heap_size_limit covers the heap of a Worker that holds memory that is not resident", async () => {
    const inWorker = `${holdUnwrittenBuffers}\nrequire("node:worker_threads").parentPort.postMessage(report);`;
    const report = await runChild(`
      const { Worker } = require("node:worker_threads");
      const worker = new Worker(${JSON.stringify(inWorker)}, { eval: true });
      worker.on("message", report => console.log(JSON.stringify(report)));
      worker.on("error", error => { console.error(error); process.exit(1); });
    `);
    expectLimitToCoverHeap(report);
  });

  // Bun.mmap is not available on Windows.
  test.skipIf(isWindows)("no field goes negative when the heap counts more than the physical memory", async () => {
    // Each map of the sparse file adds 2 GiB to the heap and no resident page.
    using dir = tempDir("v8-heap-statistics", { sparse: "" });
    truncateSync(join(String(dir), "sparse"), 2 * 1024 ** 3);
    const { totalmem, stats } = await runChild(
      `
        const totalmem = require("node:os").totalmem();
        const maps = [];
        for (let mapped = 0; mapped <= totalmem; mapped += 2 * 1024 ** 3) maps.push(Bun.mmap("sparse"));
        Bun.gc(true);
        const stats = require("node:v8").getHeapStatistics();
        console.log(JSON.stringify({ totalmem, stats, maps: maps.length }));
      `,
      String(dir),
    );
    expect(capacityOf(stats)).toBeGreaterThan(totalmem);
    expect(stats.used_heap_size).toBeLessThanOrEqual(stats.heap_size_limit);
    expect(stats.heap_size_limit).toBe(limitFor(stats, totalmem));
    expect(stats.total_available_size).toBe(capacityOf(stats) - stats.used_heap_size);
    expect(stats.total_heap_size_executable).toBe(Math.floor(stats.total_heap_size / 2));
  });
});
