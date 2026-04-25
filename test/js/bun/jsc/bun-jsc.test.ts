import {
  callerSourceOrigin,
  describeArray,
  deserialize,
  drainMicrotasks,
  edenGC,
  fullGC,
  gcAndSweep,
  getProtectedObjects,
  getRandomSeed,
  heapSize,
  heapStats,
  isRope,
  describe as jscDescribe,
  memoryUsage,
  numberOfDFGCompiles,
  optimizeNextInvocation,
  profile,
  releaseWeakRefs,
  reoptimizationRetryCount,
  serialize,
  setRandomSeed,
  setTimeZone,
  totalCompileTime,
} from "bun:jsc";
import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, isBuildKite, isWindows, tempDir } from "harness";

describe("bun:jsc", () => {
  function count() {
    var j = 0;
    for (var i = 0; i < 999999; i++) {
      j += i + 2;
    }

    return j;
  }

  it("describe", () => {
    expect(jscDescribe([])).toBeDefined();
  });
  it("describeArray", () => {
    expect(describeArray([1, 2, 3])).toBeDefined();
  });
  it("gcAndSweep", () => {
    expect(gcAndSweep()).toBeGreaterThan(0);
  });
  it("fullGC", () => {
    expect(fullGC()).toBeGreaterThan(0);
  });
  it("edenGC", () => {
    expect(edenGC()).toBeGreaterThan(0);
  });
  it("heapSize", () => {
    expect(heapSize()).toBeGreaterThan(0);
  });
  it("heapStats", () => {
    const stats = heapStats();
    expect(stats.heapCapacity).toBeGreaterThan(0);
    expect(stats.heapSize).toBeGreaterThan(0);
    expect(stats.objectCount).toBeGreaterThan(0);
  });
  it("memoryUsage", () => {
    const usage = memoryUsage();
    expect(usage.current).toBeGreaterThan(0);
    expect(usage.peak).toBeGreaterThan(0);
  });
  it("getRandomSeed", () => {
    expect(getRandomSeed()).toBeDefined();
  });
  it("setRandomSeed", () => {
    expect(setRandomSeed(2)).toBeUndefined();
  });
  it("isRope", () => {
    // https://twitter.com/bunjavascript/status/1806921203644571685
    let y;
    y = 123;
    expect(isRope("a" + y + "b")).toBe(true);
    expect(isRope("abcdefgh")).toBe(false);
  });
  it("callerSourceOrigin", () => {
    expect(callerSourceOrigin()).toBe(import.meta.url);
  });
  it("noFTL", () => {});
  it("noOSRExitFuzzing", () => {});
  it("optimizeNextInvocation", () => {
    count();
    expect(optimizeNextInvocation(count)).toBeUndefined();
    count();
  });
  it("numberOfDFGCompiles", async () => {
    await Bun.sleep(5); // this failed once and i suspect it is because the query was done too fast
    expect(numberOfDFGCompiles(count)).toBeGreaterThanOrEqual(0);
  });
  it("releaseWeakRefs", () => {
    expect(releaseWeakRefs()).toBeUndefined();
  });
  // ECMA-262 sec-clear-kept-objects: [[KeptAlive]] is emptied at every
  // microtask checkpoint, including async-function continuations on
  // already-fulfilled promises. Run in a subprocess so the test runner's
  // own state (extra retained values, async hook state) cannot keep the
  // target alive incidentally.
  it("WeakRef target collects after `await Promise.resolve()` (per-microtask ClearKeptObjects)", async () => {
    using dir = tempDir("weakref-await", {
      "test.mjs":
        `import { fullGC } from "bun:jsc";\n` +
        `function makeRef() { return new WeakRef({ value: 1 }); }\n` +
        `const ref = makeRef();\n` +
        `await Promise.resolve();\n` +
        `fullGC();\n` +
        `console.log(ref.deref() === undefined ? "PASS" : "FAIL");\n`,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test.mjs"],
      env: bunEnv,
      cwd: String(dir),
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    expect(stdout.trim()).toBe("PASS");
    expect(exitCode).toBe(0);
  });
  it("totalCompileTime", () => {
    expect(totalCompileTime(count)).toBeGreaterThanOrEqual(0);
  });
  it("reoptimizationRetryCount", () => {
    expect(reoptimizationRetryCount(count)).toBeGreaterThanOrEqual(0);
  });
  it("drainMicrotasks", () => {
    expect(drainMicrotasks()).toBeUndefined();
  });
  it("startRemoteDebugger", () => {
    // try {
    //   startRemoteDebugger("");
    // } catch (e) {
    //   if (process.platform !== "darwin") {
    //     throw e;
    //   }
    // }
  });
  it("getProtectedObjects", () => {
    expect(getProtectedObjects().length).toBeGreaterThan(0);
  });

  it("setTimeZone", () => {
    var origTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const realOrigTimezone = origTimezone;
    if (origTimezone === "America/Anchorage") {
      origTimezone = "America/New_York";
    }
    const origDate = new Date();
    origDate.setSeconds(0);
    origDate.setMilliseconds(0);
    origDate.setMinutes(0);
    const origDateString = origDate.toString();
    expect(origTimezone).toBeDefined();
    expect(origTimezone).not.toBe("America/Anchorage");
    expect(setTimeZone("America/Anchorage")).toBe("America/Anchorage");
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe("America/Anchorage");
    if (realOrigTimezone === origTimezone) {
      const newDate = new Date();
      newDate.setSeconds(0);
      newDate.setMilliseconds(0);
      newDate.setMinutes(0);
      const newDateString = newDate.toString();
      expect(newDateString).not.toBe(origDateString);
    }

    setTimeZone(realOrigTimezone);

    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(origTimezone);
  });

  it("serialize", () => {
    const serialized = serialize({ a: 1 });
    expect(serialized).toBeInstanceOf(SharedArrayBuffer);
    expect(deserialize(serialized)).toStrictEqual({ a: 1 });
    const nested = serialize(serialized);
    expect(deserialize(deserialize(nested))).toStrictEqual({ a: 1 });
  });

  it("serialize (binaryType: 'nodebuffer')", () => {
    const serialized = serialize({ a: 1 }, { binaryType: "nodebuffer" });
    expect(serialized).toBeInstanceOf(Buffer);
    expect(serialized.buffer).toBeInstanceOf(SharedArrayBuffer);
    expect(deserialize(serialized)).toStrictEqual({ a: 1 });
    const nested = serialize(serialized);
    expect(deserialize(deserialize(nested))).toStrictEqual({ a: 1 });
  });

  it("serialize GC test", () => {
    for (let i = 0; i < 1000; i++) {
      serialize({ a: 1 });
    }
    Bun.gc(true);
  });

  it.todoIf(isBuildKite && isWindows)("profile async", async () => {
    const { promise, resolve } = Promise.withResolvers();
    const result = await profile(
      async function hey(arg1: number) {
        await Bun.sleep(10).then(() => resolve(arguments));
        return arg1;
      },
      1,
      2,
    );
    const input = await promise;
    expect({ ...input }).toStrictEqual({ "0": 2 });
  });

  it.todoIf(isBuildKite && isWindows)("profile can be called multiple times", () => {
    // Fibonacci generates deep stacks and is CPU-intensive
    function fib(n: number): number {
      if (n <= 1) return n;
      return fib(n - 1) + fib(n - 2);
    }

    // After the JIT warms up fib() can finish within the default 1ms sample
    // interval, yielding zero traces. Use a short interval so every call is
    // sampled regardless of how fast the optimized code runs.
    const sampleInterval = 50;

    // First profile call
    const result1 = profile(() => fib(30), sampleInterval);
    expect(result1).toBeDefined();
    expect(result1.functions).toBeDefined();
    expect(result1.stackTraces).toBeDefined();
    expect(result1.stackTraces.traces.length).toBeGreaterThan(0);

    // Second profile call - should work after first one completed
    // This verifies that shutdown() -> pause() fix works
    const result2 = profile(() => fib(30), sampleInterval);
    expect(result2).toBeDefined();
    expect(result2.functions).toBeDefined();
    expect(result2.stackTraces).toBeDefined();
    expect(result2.stackTraces.traces.length).toBeGreaterThan(0);

    // Third profile call - verify profiler can be reused multiple times
    const result3 = profile(() => fib(30), sampleInterval);
    expect(result3).toBeDefined();
    expect(result3.functions).toBeDefined();
    expect(result3.stackTraces).toBeDefined();
    expect(result3.stackTraces.traces.length).toBeGreaterThan(0);
  });
});
