import { describe, expect, it } from "bun:test";
import {
  describe as jscDescribe,
  describeArray,
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
});
