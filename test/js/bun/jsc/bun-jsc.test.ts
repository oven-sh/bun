import { describe, expect, it } from "bun:test";
import {
  describe as jscDescribe,
  describeArray,
  serialize,
  deserialize,
  gcAndSweep,
  fullGC,
  edenGC,
  heapSize,
  heapStats,
  memoryUsage,
  getRandomSeed,
  setRandomSeed,
  isRope,
  callerSourceOrigin,
  noFTL,
  noOSRExitFuzzing,
  optimizeNextInvocation,
  numberOfDFGCompiles,
  releaseWeakRefs,
  totalCompileTime,
  getProtectedObjects,
  reoptimizationRetryCount,
  drainMicrotasks,
  startRemoteDebugger,
  setTimeZone,
} from "bun:jsc";

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
    expect(isRope("a" + 123 + "b")).toBe(true);
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
  it("numberOfDFGCompiles", () => {
    expect(numberOfDFGCompiles(count)).toBeGreaterThan(0);
  });
  it("releaseWeakRefs", () => {
    expect(releaseWeakRefs()).toBeUndefined();
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

  it("serialize (binaryMode: 'nodebuffer')", () => {
    const serialized = serialize({ a: 1 }, { binaryMode: "nodebuffer" });
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
});
