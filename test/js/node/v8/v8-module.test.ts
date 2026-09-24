import { heapStats } from "bun:jsc";
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

  // A full GC does not always return the count to its starting value, so the
  // reference after each collection is the heap walk that the counter replaces.
  test("number_of_native_contexts matches the heap walk after contexts are collected", () => {
    const before = heapStats().globalObjectCount;
    let created = 0;
    for (let round = 0; round < 3; round++) {
      (() => {
        const contexts = Array.from({ length: 5 }, () => vm.createContext({}));
        created += contexts.length;
        Bun.gc(true);
        expect(getHeapStatistics().number_of_native_contexts).toBe(heapStats().globalObjectCount);
        expect(contexts).toHaveLength(5);
      })();
      Bun.gc(true);
      expect(getHeapStatistics().number_of_native_contexts).toBe(heapStats().globalObjectCount);
    }
    // Some global was destroyed, so the equalities above covered the decrement.
    expect(heapStats().globalObjectCount).toBeLessThan(before + created);
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

  // For the child scripts. A collection that finishes between two reads moves the number, and so does a
  // new heap block before the first collection. Read heapUsed on both sides and retry until it held still.
  const readSource = /* js */ `
      function read() {
        const { getHeapStatistics, getHeapSpaceStatistics } = require("node:v8");
        for (let attempt = 0; attempt < 1000; attempt++) {
          const heapUsed = process.memoryUsage().heapUsed;
          const { used_heap_size, total_allocated_bytes } = getHeapStatistics();
          const { space_used_size, space_size } = getHeapSpaceStatistics().find(space => space.space_name === "old_space");
          if (process.memoryUsage().heapUsed === heapUsed)
            return { heapUsed, used_heap_size, total_allocated_bytes, space_used_size, space_size };
        }
        throw new Error("process.memoryUsage().heapUsed changed on every attempt");
      }
  `;

  // As in Node, used_heap_size and process.memoryUsage().heapUsed are one number. A walk of the
  // heap at call time reports 0 before the first collection and counts a new ArrayBuffer at once.
  test("used_heap_size equals process.memoryUsage().heapUsed and does not exceed the heap size", async () => {
    const script = /* js */ `
      const { Worker } = require("node:worker_threads");
      ${readSource}

      const beforeFirstCollection = read();
      Bun.gc(true);
      const afterFullCollection = read();
      const buffers = [];
      for (let i = 0; i < 32; i++) buffers.push(new ArrayBuffer(1024 * 1024));
      const afterArrayBuffers = read();

      const worker = new Worker("require('node:worker_threads').parentPort.postMessage((" + read + ")());", { eval: true });
      const inFreshWorker = await new Promise((resolve, reject) => {
        worker.once("message", resolve);
        worker.once("error", reject);
        worker.once("exit", code => reject(new Error("the worker exited with code " + code + " before it answered")));
      });
      await worker.terminate();

      process.stdout.write(JSON.stringify({
        points: { beforeFirstCollection, afterFullCollection, afterArrayBuffers, inFreshWorker },
        buffers: buffers.length,
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
    const { points, buffers } = JSON.parse(stdout) as {
      points: Record<string, Record<string, number>>;
      buffers: number;
    };
    expect(buffers).toBe(32);
    expect(Object.keys(points)).toEqual([
      "beforeFirstCollection",
      "afterFullCollection",
      "afterArrayBuffers",
      "inFreshWorker",
    ]);
    for (const [point, stats] of Object.entries(points)) {
      expect(stats.heapUsed, point).toBeGreaterThan(0);
      expect({ point, used_heap_size: stats.used_heap_size, space_used_size: stats.space_used_size }).toEqual({
        point,
        used_heap_size: stats.heapUsed,
        space_used_size: stats.heapUsed,
      });
      expect(stats.total_allocated_bytes, point).toBeGreaterThanOrEqual(stats.used_heap_size);
      expect(stats.space_size, point).toBeGreaterThanOrEqual(stats.space_used_size);
    }
    expect(exitCode).toBe(0);
  });

  // The parent reads the same number through worker.getHeapStatistics(). The worker grows an array
  // that a full collection has marked: a walk of the heap counts that growth at once.
  test("worker.getHeapStatistics() reports the worker's process.memoryUsage().heapUsed", async () => {
    const script = /* js */ `
      const { once } = require("node:events");
      const { Worker } = require("node:worker_threads");
      ${readSource}

      const worker = new Worker(
        "const { parentPort } = require('node:worker_threads');" +
          "const numbers = new Array(100_000).fill(0.5);" +
          "parentPort.on('message', message => {" +
          "  if (message === 'grow') {" +
          "    Bun.gc(true);" +
          "    for (let i = 0; i < 500_000; i++) numbers.push(i + 0.5);" +
          "  }" +
          "  parentPort.postMessage({ ...(" + read + ")(), elements: numbers.length });" +
          "});",
        { eval: true },
      );
      const exited = once(worker, "exit").then(([code]) => {
        throw new Error("the worker exited with code " + code);
      });
      exited.catch(() => {});
      async function ask(message) {
        worker.postMessage(message);
        return (await Promise.race([once(worker, "message"), exited]))[0];
      }

      let result;
      for (let attempt = 0; attempt < 1000 && !result; attempt++) {
        const inWorker = await ask(attempt === 0 ? "grow" : "read");
        const fromParent = await worker.getHeapStatistics();
        if ((await ask("read")).heapUsed === inWorker.heapUsed) result = { inWorker, fromParent };
      }
      if (!result) throw new Error("process.memoryUsage().heapUsed of the worker changed on every attempt");
      await worker.terminate();
      process.stdout.write(JSON.stringify(result));
    `;

    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    const { inWorker, fromParent } = JSON.parse(stdout) as Record<"inWorker" | "fromParent", Record<string, number>>;
    expect(inWorker.elements).toBe(600_000);
    expect(inWorker.heapUsed).toBeGreaterThan(0);
    expect({ inWorker: inWorker.used_heap_size, fromParent: fromParent.used_heap_size }).toEqual({
      inWorker: inWorker.heapUsed,
      fromParent: inWorker.heapUsed,
    });
    expect(fromParent.total_physical_size).toBeGreaterThanOrEqual(fromParent.used_heap_size);
    expect(exitCode).toBe(0);
  });

  // https://github.com/oven-sh/bun/issues/42200
  // The cost of a call must not follow the size of the heap. A walk of the heap blocks costs
  // 15 to 50 times more with the arrays than without them.
  test("costs the same with an empty heap and with 8000 retained arrays", async () => {
    const script = /* js */ `
      const { getHeapStatistics, getHeapSpaceStatistics } = require("node:v8");

      // The median ignores a collection that pauses one of the samples.
      function medianMicroseconds(fn) {
        const times = [];
        for (let sample = 0; sample < 100; sample++) {
          const start = performance.now();
          for (let i = 0; i < 5; i++) fn();
          times.push(performance.now() - start);
        }
        return (times.sort((a, b) => a - b)[times.length >> 1] * 1000) / 5;
      }

      // The lowest of three medians ignores a window in which the machine was busy.
      function measure() {
        Bun.gc(true);
        for (let i = 0; i < 50; i++) {
          getHeapStatistics();
          getHeapSpaceStatistics();
        }
        const lowest = { getHeapStatistics: Infinity, getHeapSpaceStatistics: Infinity };
        for (let round = 0; round < 3; round++) {
          lowest.getHeapStatistics = Math.min(lowest.getHeapStatistics, medianMicroseconds(getHeapStatistics));
          lowest.getHeapSpaceStatistics = Math.min(lowest.getHeapSpaceStatistics, medianMicroseconds(getHeapSpaceStatistics));
        }
        return lowest;
      }

      const empty = measure();
      const retained = [];
      for (let i = 0; i < 8000; i++) retained.push(new Array(1000).fill(i));
      const large = measure();
      process.stdout.write(JSON.stringify({ empty, large, retained: retained.length }));
    `;

    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    type Medians = { getHeapStatistics: number; getHeapSpaceStatistics: number };
    const { empty, large, retained } = JSON.parse(stdout) as { empty: Medians; large: Medians; retained: number };
    expect(retained).toBe(8000);
    for (const fn of ["getHeapStatistics", "getHeapSpaceStatistics"] as const) {
      expect(large[fn] / empty[fn], `${fn}(): ${JSON.stringify({ empty, large })}`).toBeLessThan(5);
    }
    expect(exitCode).toBe(0);
  });

  test("does not run a replaced Array.prototype[Symbol.iterator]", async () => {
    const script = /* js */ `
      const { getHeapStatistics, getHeapSpaceStatistics } = require("node:v8");
      const original = Array.prototype[Symbol.iterator];
      let calls = 0;
      Array.prototype[Symbol.iterator] = function () {
        calls++;
        throw new Error("user iterator ran");
      };
      let result;
      try {
        result = { used: typeof getHeapStatistics().used_heap_size, spaces: getHeapSpaceStatistics().length };
      } catch (e) {
        result = { error: String(e) };
      } finally {
        Array.prototype[Symbol.iterator] = original;
      }
      process.stdout.write(JSON.stringify({ ...result, calls }));
    `;

    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({ used: "number", spaces: 13, calls: 0 });
    expect(exitCode).toBe(0);
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
