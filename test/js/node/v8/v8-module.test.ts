import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot } from "harness";
import v8, { GCProfiler, isStringOneByteRepresentation } from "node:v8";

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

describe("function names", () => {
  test("every function and class is named by its key, as in Node.js", () => {
    const names: Record<string, string> = {};
    for (const [key, value] of Object.entries(v8)) if (typeof value === "function") names[key] = value.name;
    // What Node.js v26.3.0 gives for each of them.
    expect(names).toEqual({
      cachedDataVersionTag: "cachedDataVersionTag",
      GCProfiler: "GCProfiler",
      isStringOneByteRepresentation: "isStringOneByteRepresentation",
      getHeapSnapshot: "getHeapSnapshot",
      getHeapStatistics: "getHeapStatistics",
      getHeapSpaceStatistics: "getHeapSpaceStatistics",
      getHeapCodeStatistics: "getHeapCodeStatistics",
      getCppHeapStatistics: "getCppHeapStatistics",
      setFlagsFromString: "setFlagsFromString",
      deserialize: "deserialize",
      takeCoverage: "takeCoverage",
      stopCoverage: "stopCoverage",
      serialize: "serialize",
      writeHeapSnapshot: "writeHeapSnapshot",
      setHeapSnapshotNearHeapLimit: "setHeapSnapshotNearHeapLimit",
      Deserializer: "Deserializer",
      Serializer: "Serializer",
      DefaultDeserializer: "DefaultDeserializer",
      DefaultSerializer: "DefaultSerializer",
    });
  });

  test("startupSnapshot has a function for each key, with the name and length Node.js gives it", () => {
    const { addDeserializeCallback, addSerializeCallback, setDeserializeMainFunction } = v8.startupSnapshot;
    const functions = [addDeserializeCallback, addSerializeCallback, setDeserializeMainFunction];
    expect(functions.map(fn => ({ name: fn.name, length: fn.length }))).toEqual([
      { name: "addDeserializeCallback", length: 2 },
      { name: "addSerializeCallback", length: 2 },
      { name: "setDeserializeMainFunction", length: 2 },
    ]);
    for (const fn of functions) {
      expect(() => fn(() => {})).toThrow(
        expect.objectContaining({
          code: "ERR_NOT_BUILDING_SNAPSHOT",
          message: "Operation cannot be invoked when not building startup snapshot",
        }),
      );
    }
  });

  // The frames of builtin modules in a stack, without their positions.
  function builtinFrames(stack: string) {
    return stack
      .split("\n")
      .map(line => line.trim())
      .filter(line => /^at .* \((?:node|internal):/.test(line))
      .map(line => line.replace(/:\d+:\d+\)$/, ")"));
  }

  const throwers: { thrower: string; call: () => unknown; frames: string[] }[] = [
    {
      thrower: "a validator",
      call: () => v8.setFlagsFromString(1 as any),
      frames: ["at setFlagsFromString (node:v8)"],
    },
    {
      thrower: "a function of startupSnapshot",
      call: () => v8.startupSnapshot.addSerializeCallback(() => {}),
      frames: ["at addSerializeCallback (node:v8)"],
    },
    {
      thrower: "a class that is not implemented",
      call: () => new v8.DefaultSerializer(),
      frames: ["at new Serializer (node:v8)", "at new DefaultSerializer (node:v8)"],
    },
    {
      thrower: "a class that is not implemented and takes arguments",
      call: () => new v8.DefaultDeserializer(Buffer.alloc(1)),
      frames: ["at new Deserializer (node:v8)", "at new DefaultDeserializer (node:v8)"],
    },
  ];
  test.each(throwers)(
    "an error from $thrower lists the functions of node:v8 and no throw helper",
    ({ call, frames }) => {
      function thrown(): Error {
        try {
          call();
        } catch (error) {
          return error as Error;
        }
        throw new Error("The call did not throw");
      }
      // A printed error takes its frames from the error, or from the text of `stack` once a program has read it.
      const fromFrames = Bun.inspect(thrown());
      const error = thrown();
      expect(builtinFrames(error.stack!)).toEqual(expect.arrayContaining(frames));
      const fromStackText = Bun.inspect(error);
      expect({ fromFrames: builtinFrames(fromFrames), fromStackText: builtinFrames(fromStackText) }).toEqual({
        fromFrames: frames,
        fromStackText: frames,
      });
    },
  );

  test("an uncaught error previews the line of the caller and lists the function of node:v8 first", async () => {
    const script = `const v8 = require("node:v8");
function caller() {
  v8.setFlagsFromString(1);
}
caller();`;
    await using proc = Bun.spawn({ cmd: [bunExe(), "-e", script], env: bunEnv, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(normalizeBunSnapshot(stderr)).toMatchInlineSnapshot(`
      "1 | const v8 = require("node:v8");
      2 | function caller() {
      3 |   v8.setFlagsFromString(1);
               ^
      TypeError: The "flags" argument must be of type string. Received type number (1)
       code: "ERR_INVALID_ARG_TYPE"
          at setFlagsFromString (file:NN:NN)
          at caller (file:NN:NN)
            at <cwd>/[eval]:5:1

      Bun v<bun-version>"
    `);
    expect(stdout).toBe("");
    expect(exitCode).toBe(1);
  });
});
