import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { GCProfiler, isStringOneByteRepresentation } from "node:v8";

describe("v8.queryObjects", () => {
  test.concurrent("validates arguments and counts inherited prototypes without invoking traps", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "--input-type=module",
        "-e",
        `
          import assert from "node:assert/strict";
          import vm from "node:vm";
          import { queryObjects } from "node:v8";
          assert.equal(queryObjects.length, 1);
          assert.throws(() => queryObjects(null, null), {
            name: "TypeError", code: "ERR_INVALID_ARG_TYPE",
            message: 'The "constructor" argument must be of type function. Received null',
          });
          for (const options of [null, [], 1, "count", () => {}]) {
            assert.throws(() => queryObjects(() => {}, options), { code: "ERR_INVALID_ARG_TYPE" });
          }
          assert.throws(() => queryObjects(() => {}, { format: "bad" }), {
            name: "TypeError", code: "ERR_INVALID_ARG_VALUE",
            message: "The property 'options.format' is invalid. Received 'bad'",
          });
          class Base {}
          class Derived extends Base {}
          globalThis.retained = [new Base(), new Derived(), Object.create(Base.prototype)];
          assert.equal(queryObjects(Base), 4);
          assert.equal(queryObjects(Derived), 1);
          assert.equal(queryObjects(Derived, { format: false }), 1);
          assert.deepEqual(queryObjects(Derived, { format: "summary" }), ["Derived {}"]);
          assert.equal(queryObjects(() => {}), 0);
          function NoPrototype() {}
          NoPrototype.prototype = null;
          assert.deepEqual(queryObjects(NoPrototype, { format: "summary" }), []);
          const context = vm.createContext({ Base });
          vm.runInContext("globalThis.retained = Object.setPrototypeOf({}, Base.prototype)", context);
          assert.equal(queryObjects(Base), 4);
          const Foreign = vm.runInContext("class Foreign {}; globalThis.foreign = new Foreign(); Foreign", context);
          globalThis.foreign = new Foreign();
          assert.equal(queryObjects(Foreign), 0);
          let traps = 0;
          globalThis.proxy = new Proxy(new Base(), { getPrototypeOf() { traps++; throw Error("trap"); } });
          assert.equal(queryObjects(Base), 5);
          assert.equal(traps, 0);
          const sentinel = new Error("prototype getter");
          const constructor = new Proxy(function() {}, {
            get(target, key, receiver) {
              if (key === "prototype") throw sentinel;
              return Reflect.get(target, key, receiver);
            },
          });
          assert.throws(() => queryObjects(constructor), error => error === sentinel);
          console.log("queryObjects arguments, prototypes, summaries and contexts passed");
        `,
      ],
      env: { ...bunEnv, NODE_NO_WARNINGS: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({
      stdout: "queryObjects arguments, prototypes, summaries and contexts passed\n",
      stderr: "",
      exitCode: 0,
    });
  });

  test.concurrent("collects unreachable objects and does not retain previous query results", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "--input-type=module",
        "-e",
        `
          import assert from "node:assert/strict";
          import { queryObjects } from "node:v8";
          import { setImmediate } from "node:timers/promises";
          class Retained { value = { nested: 1 }; }
          for (let round = 0; round < 3; round++) {
            globalThis.retained = Array.from({ length: 128 }, () => new Retained());
            globalThis.weak = new WeakRef(globalThis.retained[0]);
            assert.equal(queryObjects(Retained), 128);
            const summaries = queryObjects(Retained, { format: "summary" });
            assert.equal(summaries.length, 128);
            assert.ok(summaries.every(value => value === "Retained { value: [Object] }"));
            globalThis.retained = undefined;
            await setImmediate();
            assert.equal(queryObjects(Retained), 0);
            assert.equal(globalThis.weak.deref(), undefined);
          }
          console.log("queryObjects collection and result lifetimes passed");
        `,
      ],
      env: { ...bunEnv, NODE_NO_WARNINGS: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({
      stdout: "queryObjects collection and result lifetimes passed\n",
      stderr: "",
      exitCode: 0,
    });
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
