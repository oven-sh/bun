import { describe, expect, test } from "bun:test";
import { createHistogram } from "perf_hooks";

describe("Histogram", () => {
  test("basic histogram creation and initial state", () => {
    const h = createHistogram();

    expect(h.min).toBe(9223372036854776000);
    expect(h.minBigInt).toBe(9223372036854775807n);
    expect(h.max).toBe(0);
    expect(h.maxBigInt).toBe(0n);
    expect(h.exceeds).toBe(0);
    expect(h.exceedsBigInt).toBe(0n);
    expect(Number.isNaN(h.mean)).toBe(true);
    expect(Number.isNaN(h.stddev)).toBe(true);
    expect(h.count).toBe(0);
    expect(h.countBigInt).toBe(0n);
  });

  test("recording values", () => {
    const h = createHistogram();

    h.record(1);

    expect(h.count).toBe(1);
    expect(h.countBigInt).toBe(1n);
    expect(h.min).toBe(1);
    expect(h.minBigInt).toBe(1n);
    expect(h.max).toBe(1);
    expect(h.maxBigInt).toBe(1n);
    expect(h.exceeds).toBe(0);
    expect(h.mean).toBe(1);
    expect(h.stddev).toBe(0);
  });

  test("recording multiple values", () => {
    const h = createHistogram();

    h.record(1);
    h.record(5);
    h.record(10);

    expect(h.count).toBe(3);
    expect(h.min).toBe(1);
    expect(h.max).toBe(10);
    expect(h.mean).toBeCloseTo(5.33, 1);
    expect(h.exceeds).toBe(0);
  });

  test("percentiles", () => {
    const h = createHistogram();

    h.record(1);

    expect(h.percentile(1)).toBe(1);
    expect(h.percentile(100)).toBe(1);
    expect(h.percentileBigInt(1)).toBe(1n);
    expect(h.percentileBigInt(100)).toBe(1n);
  });

  test("invalid record arguments", () => {
    const h = createHistogram();

    [false, "", {}, undefined, null].forEach(i => {
      expect(() => h.record(i)).toThrow();
    });

    expect(() => h.record(0, Number.MAX_SAFE_INTEGER + 1)).toThrow();
  });

  test("histogram with custom options", () => {
    const h = createHistogram({ min: 1, max: 11, figures: 1 });

    h.record(5);
    expect(h.count).toBe(1);
    expect(h.min).toBe(5);
    expect(h.max).toBe(5);
  });

  test("invalid histogram options", () => {
    ["hello", 1, null].forEach(i => {
      expect(() => createHistogram(i)).toThrow();
    });

    ["hello", false, null, {}].forEach(i => {
      expect(() => createHistogram({ min: i })).toThrow();
      expect(() => createHistogram({ max: i })).toThrow();
      expect(() => createHistogram({ figures: i })).toThrow();
    });

    [6, 10].forEach(i => {
      expect(() => createHistogram({ figures: i })).toThrow();
    });
  });

  test("adding histograms", () => {
    const h1 = createHistogram();
    const h2 = createHistogram();

    h1.record(1);
    expect(h2.count).toBe(0);
    expect(h1.count).toBe(1);

    h2.add(h1);
    expect(h2.count).toBe(1);

    ["hello", 1, false, {}].forEach(i => {
      expect(() => h1.add(i)).toThrow();
    });
  });

  test("reset functionality", () => {
    const h = createHistogram();

    h.record(1);
    h.record(5);
    h.record(10);

    expect(h.count).toBe(3);
    expect(h.min).toBe(1);
    expect(h.max).toBe(10);

    h.reset();

    expect(h.count).toBe(0);
    expect(h.min).toBe(9223372036854776000);
    expect(h.max).toBe(0);
    expect(h.exceeds).toBe(0);
    expect(Number.isNaN(h.mean)).toBe(true);
    expect(Number.isNaN(h.stddev)).toBe(true);
  });

  test("recordDelta functionality", () => {
    const h = createHistogram();

    const delta1 = h.recordDelta();
    expect(delta1).toBe(0);
    expect(h.count).toBe(0);

    Bun.sleepSync(1);
    const delta2 = h.recordDelta();
    expect(delta2).toBeGreaterThan(0);
    expect(h.count).toBe(1);

    Bun.sleepSync(1);
    const delta3 = h.recordDelta();
    expect(delta3).toBeGreaterThan(0);
    expect(h.count).toBe(2);
  });

  describe("exceeds functionality", () => {
    test("basic exceeds counting", () => {
      const h = createHistogram({ min: 1, max: 100, figures: 3 });

      expect(h.exceeds).toBe(0);

      h.record(50);
      h.record(75);
      expect(h.exceeds).toBe(0);
      expect(h.count).toBe(2);

      h.record(150);
      h.record(200);
      expect(h.exceeds).toBe(2);
      expect(h.count).toBe(2);
    });

    test("exceeds with BigInt", () => {
      const h = createHistogram({ min: 1, max: 100, figures: 3 });

      h.record(50);
      h.record(150);

      expect(h.exceeds).toBe(1);
      expect(h.exceedsBigInt).toBe(1n);
    });

    test("exceeds count in add operation", () => {
      const h1 = createHistogram({ min: 1, max: 100, figures: 3 });
      const h2 = createHistogram({ min: 1, max: 100, figures: 3 });

      h1.record(25);
      h1.record(150);
      expect(h1.exceeds).toBe(1);
      expect(h1.count).toBe(1);

      h2.record(75);
      h2.record(200);
      expect(h2.exceeds).toBe(1);
      expect(h2.count).toBe(1);

      const dropped = h1.add(h2);
      expect(h1.exceeds).toBe(2);
      expect(h1.count).toBe(2);
    });

    test("exceeds count after reset", () => {
      const h = createHistogram({ min: 1, max: 100, figures: 3 });

      h.record(50);
      h.record(150);
      expect(h.exceeds).toBe(1);
      expect(h.count).toBe(1);

      h.reset();
      expect(h.exceeds).toBe(0);
      expect(h.count).toBe(0);
    });

    test("exceeds with very small range", () => {
      const h = createHistogram({ min: 1, max: 10, figures: 1 });

      h.record(5);
      h.record(15);
      h.record(20);
      h.record(8);

      expect(h.exceeds).toBe(2);
      expect(h.count).toBe(2);
      expect(h.min).toBe(5);
      expect(h.max).toBe(8);
    });
  });

  describe("percentiles functionality", () => {
    test("percentiles with map", () => {
      const h = createHistogram();

      h.record(1);
      h.record(5);
      h.record(10);
      h.record(15);
      h.record(20);

      const percentiles = new Map();
      h.percentiles(percentiles);

      expect(percentiles.size).toBeGreaterThan(0);
      expect(percentiles.has(50)).toBe(true);
      expect(percentiles.has(100)).toBe(true);
    });

    test("percentilesBigInt with map", () => {
      const h = createHistogram();

      h.record(1);
      h.record(5);
      h.record(10);

      const percentiles = new Map();
      h.percentilesBigInt(percentiles);

      expect(percentiles.size).toBeGreaterThan(0);

      for (const [key, value] of percentiles) {
        expect(typeof key).toBe("number");
        expect(typeof value).toBe("bigint");
      }
    });
  });

  describe("edge cases", () => {
    test("recording zero", () => {
      const h = createHistogram();

      expect(() => h.record(0)).toThrow();
    });

    test("recording negative values", () => {
      const h = createHistogram();

      expect(() => h.record(-1)).toThrow();
      expect(() => h.record(-100)).toThrow();
    });

    test("very large values", () => {
      const h = createHistogram();

      const largeValue = Number.MAX_SAFE_INTEGER;
      h.record(largeValue);

      expect(h.count).toBe(1);
      expect(h.max).toBe(largeValue);
    });

    test("histogram with same lowest and highest", () => {
      expect(() => createHistogram({ min: 5, max: 5, figures: 1 })).toThrow("options.max must be >= 2 * options.min");
    });

    test("multiple add operations", () => {
      const h1 = createHistogram();
      const h2 = createHistogram();
      const h3 = createHistogram();

      h1.record(1);
      h2.record(2);
      h3.record(3);

      h1.add(h2);
      expect(h1.count).toBe(2);

      h1.add(h3);
      expect(h1.count).toBe(3);
      expect(h1.min).toBe(1);
      expect(h1.max).toBe(3);
    });
  });

  describe("BigInt support", () => {
    test("recording BigInt values", () => {
      const h = createHistogram();

      h.record(1n);
      h.record(5n);

      expect(h.count).toBe(2);
      expect(h.countBigInt).toBe(2n);
      expect(h.min).toBe(1);
      expect(h.max).toBe(5);
    });

    test("BigInt getters", () => {
      const h = createHistogram();

      h.record(42);

      expect(h.minBigInt).toBe(42n);
      expect(h.maxBigInt).toBe(42n);
      expect(h.countBigInt).toBe(1n);
      expect(h.exceedsBigInt).toBe(0n);
    });
  });

  test("inspect output", () => {
    const h = createHistogram();
    const { inspect } = require("util");

    const output = inspect(h, { depth: null });
    expect(output).toMatch(/Histogram/);

    const shallowOutput = inspect(h, { depth: -1 });
    expect(shallowOutput).toBe("[RecordableHistogram]");
  });
});
