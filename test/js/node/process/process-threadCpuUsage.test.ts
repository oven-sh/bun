import { expect, test } from "bun:test";

test("process.threadCpuUsage returns valid result", () => {
  const result = process.threadCpuUsage();

  expect(result).toHaveProperty("user");
  expect(result).toHaveProperty("system");
  expect(typeof result.user).toBe("number");
  expect(typeof result.system).toBe("number");
  expect(result.user).toBeGreaterThanOrEqual(0);
  expect(result.system).toBeGreaterThanOrEqual(0);
  expect(Number.isFinite(result.user)).toBe(true);
  expect(Number.isFinite(result.system)).toBe(true);
});

test("process.threadCpuUsage with previous value", () => {
  const start = process.threadCpuUsage();

  // Do some CPU work
  for (let i = 0; i < 100000; i++) {
    Math.sqrt(i);
  }

  const diff = process.threadCpuUsage(start);

  expect(diff).toHaveProperty("user");
  expect(diff).toHaveProperty("system");
  expect(diff.user).toBeGreaterThanOrEqual(0);
  expect(diff.system).toBeGreaterThanOrEqual(0);
});

test("process.threadCpuUsage increases over time", () => {
  const usage1 = process.threadCpuUsage();

  // Do some CPU work
  for (let i = 0; i < 100000; i++) {
    Math.sqrt(i);
  }

  const usage2 = process.threadCpuUsage();

  expect(usage2.user).toBeGreaterThanOrEqual(usage1.user);
  expect(usage2.system).toBeGreaterThanOrEqual(usage1.system);
});

test("process.threadCpuUsage throws on invalid argument type", () => {
  expect(() => process.threadCpuUsage(123 as any)).toThrow();
  expect(() => process.threadCpuUsage("invalid" as any)).toThrow();
});

test("process.threadCpuUsage throws on invalid prevValue.user", () => {
  expect(() => process.threadCpuUsage({} as any)).toThrow();
  expect(() => process.threadCpuUsage({ user: "a" } as any)).toThrow();
  expect(() => process.threadCpuUsage({ user: null } as any)).toThrow();
});

test("process.threadCpuUsage throws on invalid prevValue.system", () => {
  expect(() => process.threadCpuUsage({ user: 3, system: "b" } as any)).toThrow();
  expect(() => process.threadCpuUsage({ user: 3, system: null } as any)).toThrow();
});

test("process.threadCpuUsage throws on out-of-range values", () => {
  expect(() => process.threadCpuUsage({ user: -1, system: 2 })).toThrow();
  expect(() => process.threadCpuUsage({ user: Number.POSITIVE_INFINITY, system: 4 })).toThrow();
  expect(() => process.threadCpuUsage({ user: 3, system: -2 })).toThrow();
  expect(() => process.threadCpuUsage({ user: 5, system: Number.NEGATIVE_INFINITY })).toThrow();
});
