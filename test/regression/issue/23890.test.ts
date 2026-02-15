// https://github.com/oven-sh/bun/issues/23890
// Test process.threadCpuUsage implementation

import { describe, expect, test } from "bun:test";

describe("process.threadCpuUsage", () => {
  test("is a function", () => {
    expect(typeof process.threadCpuUsage).toBe("function");
  });

  test("returns an object with user and system properties", () => {
    const result = process.threadCpuUsage();
    expect(result).toBeDefined();
    expect(result.user).toBeGreaterThanOrEqual(0);
    expect(result.system).toBeGreaterThanOrEqual(0);
  });

  test("returns delta when passed a previous value", () => {
    const start = process.threadCpuUsage();

    // Simulate some CPU work
    let sum = 0;
    for (let i = 0; i < 100000; i++) {
      sum += Math.sqrt(i);
    }

    const delta = process.threadCpuUsage(start);
    expect(delta).toBeDefined();
    expect(delta.user).toBeGreaterThanOrEqual(0);
    expect(delta.system).toBeGreaterThanOrEqual(0);
  });

  test("throws error when previousValue is a string", () => {
    expect(() => process.threadCpuUsage("invalid" as unknown as NodeJS.CpuUsage)).toThrow();
  });

  test("throws error when previousValue user property is not a number", () => {
    expect(() => process.threadCpuUsage({ user: "invalid", system: 0 } as any)).toThrow();
  });

  test("throws error when previousValue system property is not a number", () => {
    expect(() => process.threadCpuUsage({ user: 0, system: "invalid" } as any)).toThrow();
  });

  test("throws RangeError for out-of-range user property", () => {
    expect(() => process.threadCpuUsage({ user: -1, system: 0 })).toThrow();
  });

  test("throws RangeError for out-of-range system property", () => {
    expect(() => process.threadCpuUsage({ user: 0, system: -1 })).toThrow();
  });

  test("accepts undefined as previousValue", () => {
    const result = process.threadCpuUsage(undefined);
    expect(result).toBeDefined();
    expect(typeof result.user).toBe("number");
    expect(typeof result.system).toBe("number");
  });
});
