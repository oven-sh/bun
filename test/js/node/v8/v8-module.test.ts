import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { once } from "node:events";
import { totalmem } from "node:os";
import { GCProfiler, getHeapStatistics, isStringOneByteRepresentation } from "node:v8";
import { Worker } from "node:worker_threads";

describe("v8.getHeapStatistics", () => {
  async function runChild(script: string) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    const result = JSON.parse(stdout);
    expect(exitCode).toBe(0);
    return result;
  }

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

  test.concurrent("number_of_native_contexts counts the global objects of its own thread", async () => {
    const result = await runChild(/* js */ `
      const { getHeapStatistics } = require("node:v8");
      const vm = require("node:vm");
      const { Worker } = require("node:worker_threads");
      const count = () => getHeapStatistics().number_of_native_contexts;

      const atStart = count();
      const contexts = [vm.createContext({}), vm.createContext({}), vm.createContext({})];
      const withContexts = count();
      contexts.push(new ShadowRealm());
      const withShadowRealm = count();

      const worker = new Worker(
        \`
          const { parentPort } = require("node:worker_threads");
          const { getHeapStatistics } = require("node:v8");
          const vm = require("node:vm");
          const count = () => getHeapStatistics().number_of_native_contexts;
          const atStart = count();
          const contexts = [];
          for (let i = 0; i < 5; i++) contexts.push(vm.createContext({}));
          parentPort.postMessage({ atStart, withContexts: count(), kept: contexts.length });
        \`,
        { eval: true },
      );
      worker.once("message", async inWorker => {
        const whileTheWorkerHoldsContexts = count();
        await worker.terminate();
        console.log(JSON.stringify({
          atStart, withContexts, withShadowRealm, inWorker, whileTheWorkerHoldsContexts, kept: contexts.length,
        }));
      });
    `);

    expect(result).toEqual({
      atStart: 1,
      withContexts: 4,
      withShadowRealm: 5,
      inWorker: { atStart: 1, withContexts: 6, kept: 5 },
      whileTheWorkerHoldsContexts: 5,
      kept: 4,
    });
  });

  // The count falls when a collection finds a context dead, as the count of bun:jsc heapStats() does, which
  // visits every cell of the heap. Nothing here sweeps the heap as Bun.gc(true) does: a count that waits for
  // the destructor of the context reads 33 after the first collection, where the heap has 1 live global.
  test.concurrent("number_of_native_contexts falls when a collection drops contexts", async () => {
    const { held, dropped } = (await runChild(/* js */ `
      const { getHeapStatistics } = require("node:v8");
      const { heapStats } = require("bun:jsc");
      const vm = require("node:vm");

      // A collection that ends between the two reads moves both numbers. Read the count on both sides of the walk.
      function read() {
        for (let attempt = 0; attempt < 1000; attempt++) {
          const contexts = getHeapStatistics().number_of_native_contexts;
          const walk = heapStats().globalObjectCount;
          if (getHeapStatistics().number_of_native_contexts === contexts) return { contexts, walk };
        }
        throw new Error("number_of_native_contexts changed on every attempt");
      }

      let held;
      (function () {
        const contexts = [];
        for (let i = 0; i < 40; i++) contexts.push(vm.createContext({}));
        held = read();
      })();

      // The garbage makes the collector run by itself.
      const dropped = [];
      let garbage;
      (function turn() {
        for (let i = 0; i < 2000; i++) garbage = new Array(100).fill(i);
        dropped.push(read());
        if (dropped.at(-1).walk < held.walk || dropped.length === 500) console.log(JSON.stringify({ held, dropped }));
        else setImmediate(turn);
      })();
    `)) as Record<"held", { contexts: number; walk: number }> & { dropped: { contexts: number; walk: number }[] };

    expect(held).toEqual({ contexts: 41, walk: 41 });
    expect(dropped.at(-1)!.walk).toBeLessThan(41);
    expect(dropped.map(reading => reading.contexts)).toEqual(dropped.map(reading => reading.walk));
  });

  // bun:jsc heapStats() runs a full collection when no collection has run yet. A call of node:v8 must not.
  test.concurrent("a call runs no collection", async () => {
    const result = await runChild(/* js */ `
      const { getHeapStatistics, getHeapSpaceStatistics, GCProfiler } = require("node:v8");
      const profiler = new GCProfiler();
      function collectionsDuring(run) {
        profiler.start();
        run();
        return profiler.stop().statistics.map(collection => collection.gcType);
      }

      const calls = collectionsDuring(() => {
        for (let i = 0; i < 20; i++) {
          getHeapStatistics();
          getHeapSpaceStatistics();
        }
      });
      // The control: the profiler reports a collection that does run.
      const fullCollection = collectionsDuring(() => Bun.gc(true));
      console.log(JSON.stringify({ calls, fullCollection }));
    `);

    expect(result).toEqual({ calls: [], fullCollection: ["MarkSweepCompact"] });
  });

  // For the child and worker scripts. A collection that finishes between two reads moves the number, and so
  // does an allocation before the first collection. Read heapUsed on both sides and retry until it held still.
  const readSource = /* js */ `
      function read() {
        const { getHeapStatistics, getHeapSpaceStatistics } = require("node:v8");
        for (let attempt = 0; attempt < 1000; attempt++) {
          const heapUsed = process.memoryUsage().heapUsed;
          const { used_heap_size, total_allocated_bytes, external_memory } = getHeapStatistics();
          const { space_used_size, space_size } = getHeapSpaceStatistics().find(space => space.space_name === "old_space");
          if (process.memoryUsage().heapUsed === heapUsed)
            return { heapUsed, used_heap_size, total_allocated_bytes, external_memory, space_used_size, space_size };
        }
        throw new Error("process.memoryUsage().heapUsed changed on every attempt");
      }
  `;

  type Reading = Record<
    "heapUsed" | "used_heap_size" | "total_allocated_bytes" | "external_memory" | "space_used_size" | "space_size",
    number
  >;

  function expectUsedToEqualHeapUsed(point: string, stats: Reading) {
    expect(stats.heapUsed, point).toBeGreaterThan(0);
    expect({ point, used_heap_size: stats.used_heap_size, space_used_size: stats.space_used_size }).toEqual({
      point,
      used_heap_size: stats.heapUsed,
      space_used_size: stats.heapUsed,
    });
    expect(stats.total_allocated_bytes, point).toBeGreaterThanOrEqual(stats.used_heap_size);
    expect(stats.space_size, point).toBeGreaterThanOrEqual(stats.space_used_size);
  }

  // As in Node, used_heap_size and process.memoryUsage().heapUsed come from one source. The number is the size
  // that the last collection measured. Before the first collection it is all of the heap.
  test.concurrent(
    "used_heap_size equals process.memoryUsage().heapUsed and does not exceed the heap size",
    async () => {
      const megabyte = 1024 * 1024;
      const { points, collectionsBeforeTheFullCollection, kept } = (await runChild(/* js */ `
      ${readSource}
      const profiler = new (require("node:v8").GCProfiler)();
      profiler.start();

      const beforeFirstCollection = read();
      // 1.6 MB of large arrays and an array buffer of 2 MB. The first collection starts after 8 MB.
      const arrays = [new Array(99_999).fill(0.5), new Array(99_999).fill(1.5)];
      const buffers = [new ArrayBuffer(2 * ${megabyte})];
      const afterLargeAllocations = read();
      const collectionsBeforeTheFullCollection = profiler.stop().statistics.length;
      Bun.gc(true);
      const afterFullCollection = read();
      for (let i = 0; i < 32; i++) buffers.push(new ArrayBuffer(${megabyte}));
      const afterArrayBuffers = read();

      console.log(JSON.stringify({
        points: { beforeFirstCollection, afterLargeAllocations, afterFullCollection, afterArrayBuffers },
        collectionsBeforeTheFullCollection,
        kept: arrays.length + buffers.length,
      }));
    `)) as { points: Record<string, Reading>; collectionsBeforeTheFullCollection: number; kept: number };

      expect(kept).toBe(35);
      expect(Object.keys(points)).toEqual([
        "beforeFirstCollection",
        "afterLargeAllocations",
        "afterFullCollection",
        "afterArrayBuffers",
      ]);
      for (const [point, stats] of Object.entries(points)) expectUsedToEqualHeapUsed(point, stats);
      // No collection has measured the heap yet, and its blocks alone are less than 2 MB.
      expect(collectionsBeforeTheFullCollection).toBe(0);
      expect(points.afterLargeAllocations.used_heap_size).toBeGreaterThanOrEqual(3_600_000);
      // An array buffer counts from its allocation.
      expect(points.afterLargeAllocations.external_memory).toBeGreaterThanOrEqual(2 * megabyte);
      expect(points.afterFullCollection.external_memory).toBeGreaterThanOrEqual(2 * megabyte);
      expect(points.afterArrayBuffers.external_memory).toBeGreaterThanOrEqual(34 * megabyte);
    },
  );

  // A worker has the same relation when it starts, and the parent reads the same number through
  // worker.getHeapStatistics(). The worker grows an array that a full collection has marked: a walk
  // of the heap counts that growth at once.
  test("worker.getHeapStatistics() reports the worker's process.memoryUsage().heapUsed", async () => {
    await using worker = new Worker(
      /* js */ `
        const { parentPort } = require("node:worker_threads");
        ${readSource}

        parentPort.postMessage(read());
        const numbers = new Array(100_000).fill(0.5);
        parentPort.on("message", message => {
          if (message === "grow") {
            Bun.gc(true);
            for (let i = 0; i < 100_000; i++) numbers.push(i + 0.5);
          }
          parentPort.postMessage({ ...read(), elements: numbers.length });
        });
      `,
      { eval: true },
    );
    const exited = once(worker, "exit").then(([code]) => {
      throw new Error(`the worker exited with code ${code}`);
    });
    exited.catch(() => {});
    const answer = async (): Promise<Reading & { elements: number }> =>
      (await Promise.race([once(worker, "message"), exited]))[0];
    const ask = (message: "grow" | "read") => {
      worker.postMessage(message);
      return answer();
    };

    expectUsedToEqualHeapUsed("at the start of the worker", await answer());

    let result: { inWorker: Reading & { elements: number }; fromParent: Record<string, number> } | undefined;
    for (let attempt = 0; attempt < 1000 && !result; attempt++) {
      const inWorker = await ask(attempt === 0 ? "grow" : "read");
      const fromParent = await worker.getHeapStatistics();
      if ((await ask("read")).heapUsed === inWorker.heapUsed) result = { inWorker, fromParent };
    }
    if (!result) throw new Error("process.memoryUsage().heapUsed of the worker changed on every attempt");

    const { inWorker, fromParent } = result;
    expect(inWorker.elements).toBe(200_000);
    expectUsedToEqualHeapUsed("after the array grew", inWorker);
    expect(fromParent.used_heap_size).toBe(inWorker.heapUsed);
    expect(fromParent.total_physical_size).toBeGreaterThanOrEqual(fromParent.used_heap_size);
  });

  // https://github.com/oven-sh/bun/issues/42200
  // A call costs less than process.memoryUsage() does: 0.1 to 0.9 times as much, with an empty heap and with a
  // large one. The two walks of the heap that bun:jsc has cost more: heapSize() visits every block and costs 20
  // times as much with this heap, and heapStats() visits every cell and costs 300 times as much with any heap.
  // The clock is the wall clock, because the time of the processor includes the threads of the collector.
  // A busy machine slows process.memoryUsage() in the same windows, so it does not change the ratio.
  test("costs what process.memoryUsage() costs, with an empty heap and with a large heap", async () => {
    type Costs = Record<"getHeapStatistics" | "getHeapSpaceStatistics" | "memoryUsage", number>;
    const { empty, large, retained } = (await runChild(/* js */ `
      const { getHeapStatistics, getHeapSpaceStatistics } = require("node:v8");
      const subjects = { getHeapStatistics, getHeapSpaceStatistics, memoryUsage: () => process.memoryUsage() };

      // Microseconds for one call: the median of up to 100 samples of 5 calls. The median ignores a collection
      // that pauses one of the samples. The limit of 50 ms keeps a build that walks the heap inside the timeout.
      function median(fn) {
        const times = [];
        const start = performance.now();
        do {
          const sample = performance.now();
          let calls = 0;
          do {
            fn();
          } while (++calls < 5 && performance.now() - start < 50);
          times.push((performance.now() - sample) / calls);
        } while (times.length < 100 && performance.now() - start < 50);
        return times.sort((a, b) => a - b)[times.length >> 1] * 1000;
      }

      // The lowest of three medians ignores a window in which the machine was busy.
      function measure() {
        Bun.gc(true);
        const lowest = {};
        for (const name in subjects) {
          median(subjects[name]);
          lowest[name] = Infinity;
        }
        for (let round = 0; round < 3; round++) {
          for (const name in subjects) lowest[name] = Math.min(lowest[name], median(subjects[name]));
        }
        return lowest;
      }

      const empty = measure();
      const retained = [];
      for (let i = 0; i < 8000; i++) retained.push(new Array(1000).fill(i));
      const large = measure();
      console.log(JSON.stringify({ empty, large, retained: retained.length }));
    `)) as { empty: Costs; large: Costs; retained: number };

    expect(retained).toBe(8000);
    const costs = JSON.stringify({ empty, large });
    for (const fn of ["getHeapStatistics", "getHeapSpaceStatistics"] as const) {
      expect(empty[fn] / empty.memoryUsage, `${fn}() with an empty heap: ${costs}`).toBeLessThan(5);
      expect(large[fn] / large.memoryUsage, `${fn}() with a large heap: ${costs}`).toBeLessThan(5);
    }
  });

  // total_heap_size_executable is half of the used size. A 32-bit shift wraps it from 2 GiB, and again from 4 GiB.
  // The pages of the two buffers are not written, so the test is cheap. A small host can still refuse to reserve them.
  test.concurrent.skipIf(totalmem() < 8 * 1024 ** 3)("reports sizes above 2 GiB", async () => {
    const size = 2 ** 31 + 4096;
    const readings = (await runChild(/* js */ `
      const { getHeapStatistics } = require("node:v8");
      const buffers = [];
      const readings = [];
      for (let count = 1; count <= 2; count++) {
        buffers.push(new ArrayBuffer(${size}));
        Bun.gc(true);
        const { used_heap_size, total_heap_size_executable } = getHeapStatistics();
        readings.push({ buffers: buffers.length, used_heap_size, total_heap_size_executable });
      }
      console.log(JSON.stringify(readings));
    `)) as { buffers: number; used_heap_size: number; total_heap_size_executable: number }[];

    expect(readings.map(reading => reading.buffers)).toEqual([1, 2]);
    for (const { buffers, used_heap_size, total_heap_size_executable } of readings) {
      expect(used_heap_size).toBeGreaterThanOrEqual(buffers * size);
      expect(total_heap_size_executable).toBe(Math.floor(used_heap_size / 2));
    }
  });

  test.concurrent("does not call what a program can replace", async () => {
    const result = await runChild(/* js */ `
      const { getHeapStatistics, getHeapSpaceStatistics } = require("node:v8");
      const originals = [Array.prototype[Symbol.iterator], Math.floor, Math.min];
      let calls = 0;
      function replacement() {
        calls++;
        throw new Error("a replaced built-in ran");
      }
      Array.prototype[Symbol.iterator] = replacement;
      Math.floor = replacement;
      Math.min = replacement;
      let result;
      try {
        result = { used: typeof getHeapStatistics().used_heap_size, spaces: getHeapSpaceStatistics().length };
      } catch (e) {
        result = { error: String(e) };
      } finally {
        Array.prototype[Symbol.iterator] = originals[0];
        Math.floor = originals[1];
        Math.min = originals[2];
      }
      console.log(JSON.stringify({ ...result, calls }));
    `);

    expect(result).toEqual({ used: "number", spaces: 13, calls: 0 });
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

test("loading node:v8 does not call a replaced Function.prototype.bind", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const original = Function.prototype.bind;
       let calls = 0;
       Function.prototype.bind = function (...args) {
         calls++;
         return original.apply(this, args);
       };
       require("node:v8");
       Function.prototype.bind = original;
       console.log(calls);`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, stderr, exitCode }).toEqual({ stdout: "0\n", stderr: "", exitCode: 0 });
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

describe("--expose-gc", () => {
  async function run(...args: string[]) {
    await using process = Bun.spawn({ cmd: [bunExe(), ...args], env: bunEnv, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([
      process.stdout.text(),
      process.stderr.text(),
      process.exited,
    ]);
    return { stdout: stdout.trim(), stderr, exitCode };
  }

  test.concurrent("v8.setFlagsFromString() gives gc() to the contexts that node:vm makes afterwards", async () => {
    const script = `
      const v8 = require("node:v8"), vm = require("node:vm");
      const has = () => vm.runInNewContext("typeof gc");
      const before = vm.createContext({});
      const log = [has()];
      v8.setFlagsFromString("--expose-gc");
      log.push(has(), typeof globalThis.gc, vm.runInContext("typeof gc", before), vm.runInNewContext("gc")());
      v8.setFlagsFromString("--no-expose-gc");
      log.push(has());
      v8.setFlagsFromString("--expose_gc");
      log.push(has());
      v8.setFlagsFromString("--noexpose_gc");
      log.push(has());
      v8.setFlagsFromString("--stack-size=900 --expose-gc");
      log.push(has());
      console.log(JSON.stringify(log));
    `;
    const { stdout, stderr, exitCode } = await run("-e", script);
    expect(stderr).toBe("");
    // What Node prints.
    expect(JSON.parse(stdout)).toEqual([
      "undefined",
      "function",
      "undefined",
      "undefined",
      null,
      "undefined",
      "function",
      "undefined",
      "function",
    ]);
    expect(exitCode).toBe(0);
  });

  test.concurrent("on the command line gives gc() to the contexts of node:vm too", async () => {
    const { stdout, stderr, exitCode } = await run(
      "--expose-gc",
      "-p",
      `require("node:vm").runInNewContext("typeof gc")`,
    );
    expect(stderr).toBe("");
    expect(stdout).toBe("function");
    expect(exitCode).toBe(0);
  });
});
