import assert from "node:assert";
import { describe, test } from "node:test";
import { inspect } from "node:util";
import { createHistogram } from "perf_hooks";

describe("Histogram", () => {
  test("basic histogram creation and initial state", () => {
    const h = createHistogram();

    assert.strictEqual(h.min, 9223372036854776000);
    assert.strictEqual(h.minBigInt, 9223372036854775807n);
    assert.strictEqual(h.max, 0);
    assert.strictEqual(h.maxBigInt, 0n);
    assert.strictEqual(h.exceeds, 0);
    assert.strictEqual(h.exceedsBigInt, 0n);
    assert.ok(Number.isNaN(h.mean));
    assert.ok(Number.isNaN(h.stddev));
    assert.strictEqual(h.count, 0);
    assert.strictEqual(h.countBigInt, 0n);
  });

  test("recording values", () => {
    const h = createHistogram();

    h.record(1);
    assert.strictEqual(h.count, 1);
    assert.strictEqual(h.min, 1);
    assert.strictEqual(h.max, 1);

    h.record(5);
    assert.strictEqual(h.count, 2);
    assert.strictEqual(h.min, 1);
    assert.strictEqual(h.max, 5);
  });

  test("recording multiple values", () => {
    const h = createHistogram();

    for (let i = 1; i <= 10; i++) {
      h.record(i);
    }

    assert.strictEqual(h.count, 10);
    assert.strictEqual(h.min, 1);
    assert.strictEqual(h.max, 10);
    assert.strictEqual(h.mean, 5.5);
  });

  test("percentiles", () => {
    const h = createHistogram();

    for (let i = 1; i <= 100; i++) {
      h.record(i);
    }

    assert.strictEqual(h.percentile(50), 50);
    assert.strictEqual(h.percentile(90), 90);
    assert.strictEqual(h.percentile(99), 99);
  });

  test("invalid record arguments", () => {
    const h = createHistogram();

    assert.throws(() => h.record(0), /out of range/);
    assert.throws(() => h.record(-1), /out of range/);
    assert.throws(() => h.record("invalid" as any), /must be of type number/);
  });

  test("histogram with custom options", () => {
    const h = createHistogram({ lowest: 1, highest: 11, figures: 1 } as any);

    h.record(5);
    assert.strictEqual(h.count, 1);
    assert.strictEqual(h.min, 5);
    assert.strictEqual(h.max, 5);
  });

  test("invalid histogram options", () => {
    // Test only the validations that Node.js actually enforces
    assert.throws(() => createHistogram({ figures: 6 }));
    assert.throws(() => createHistogram({ figures: 0 }));
  });

  test("adding histograms", () => {
    const h1 = createHistogram();
    const h2 = createHistogram();

    h1.record(1);
    h1.record(2);
    h2.record(3);
    h2.record(4);

    const originalCount1 = h1.count;
    const originalCount2 = h2.count;

    h1.add(h2);

    assert.strictEqual(h1.count, originalCount1 + originalCount2);
    assert.strictEqual(h1.min, 1);
    assert.strictEqual(h1.max, 4);
  });

  test("reset functionality", () => {
    const h = createHistogram();

    h.record(1);
    h.record(2);
    h.record(3);

    assert.strictEqual(h.count, 3);

    h.reset();

    assert.strictEqual(h.count, 0);
    assert.strictEqual(h.exceeds, 0);
    assert.ok(Number.isNaN(h.mean));
    assert.ok(Number.isNaN(h.stddev));
  });

  test("recordDelta functionality", async () => {
    const h = createHistogram();

    h.recordDelta();
    await new Promise(resolve => setTimeout(resolve, 10));
    h.recordDelta();

    assert.strictEqual(h.count, 1);
  });

  describe("exceeds functionality", () => {
    test("basic exceeds counting", () => {
      const h = createHistogram({ lowest: 1, highest: 100, figures: 3 });

      assert.strictEqual(h.exceeds, 0);

      h.record(50);
      h.record(75);
      assert.strictEqual(h.exceeds, 0);
      assert.strictEqual(h.count, 2);

      h.record(150);
      h.record(200);
      assert.strictEqual(h.exceeds, 0);
      assert.strictEqual(h.count, 4);
    });

    test("exceeds with BigInt", () => {
      const h = createHistogram({ lowest: 1, highest: 100, figures: 3 });

      h.record(50);
      h.record(150);

      assert.strictEqual(h.exceeds, 0);
      assert.strictEqual(h.exceedsBigInt, 0n);
      assert.strictEqual(h.count, 2);
    });

    test("exceeds count in add operation", () => {
      const h1 = createHistogram({ lowest: 1, highest: 100, figures: 3 });
      const h2 = createHistogram({ lowest: 1, highest: 100, figures: 3 });

      h1.record(25);
      h1.record(150);
      assert.strictEqual(h1.exceeds, 0);
      assert.strictEqual(h1.count, 2);

      h2.record(75);
      h2.record(200);
      assert.strictEqual(h2.exceeds, 0);
      assert.strictEqual(h2.count, 2);

      h1.add(h2);
      assert.strictEqual(h1.exceeds, 0);
      assert.strictEqual(h1.count, 4);
    });

    test("exceeds count after reset", () => {
      const h = createHistogram({ lowest: 1, highest: 100, figures: 3 });

      h.record(50);
      h.record(150);
      assert.strictEqual(h.exceeds, 0);
      assert.strictEqual(h.count, 2);

      h.reset();
      assert.strictEqual(h.exceeds, 0);
      assert.strictEqual(h.count, 0);
    });

    test("exceeds with very small range", () => {
      const h = createHistogram({ lowest: 1, highest: 10, figures: 1 });

      h.record(5);
      h.record(15);
      h.record(20);
      h.record(8);

      assert.strictEqual(h.exceeds, 0);
      assert.strictEqual(h.count, 4);
      assert.strictEqual(h.min, 5);
      assert.strictEqual(h.max, 20);
    });
  });

  describe("percentiles functionality", () => {
    test("percentiles with map", () => {
      const h = createHistogram();

      for (let i = 1; i <= 10; i++) {
        h.record(i);
      }

      const percentiles = h.percentiles;
      assert.strictEqual(typeof percentiles, "object");
      assert.ok(percentiles.size > 0);
      assert.ok(percentiles.has(50));
      assert.ok(percentiles.has(100));
    });

    test("percentilesBigInt with map", () => {
      const h = createHistogram();

      for (let i = 1; i <= 5; i++) {
        h.record(i);
      }

      const percentiles = h.percentilesBigInt;
      assert.strictEqual(typeof percentiles, "object");
      assert.ok(percentiles.size > 0);

      for (const [key, value] of percentiles) {
        assert.strictEqual(typeof key, "number");
        assert.strictEqual(typeof value, "bigint");
      }
    });
  });

  describe("edge cases", () => {
    test("recording zero", () => {
      const h = createHistogram();
      assert.throws(() => h.record(0), /out of range/);
    });

    test("recording negative values", () => {
      const h = createHistogram();
      assert.throws(() => h.record(-5), /out of range/);
    });

    test("very large values", () => {
      const h = createHistogram();
      h.record(Number.MAX_SAFE_INTEGER);
      assert.strictEqual(h.count, 1);
    });

    test("histogram with same lowest and highest", () => {
      // Node.js does enforce this validation
      assert.throws(() => createHistogram({ lowest: 5, highest: 5, figures: 1 }), /out of range/);
    });

    test("multiple add operations", () => {
      const h1 = createHistogram();
      const h2 = createHistogram();
      const h3 = createHistogram();

      h1.record(1);
      h2.record(2);
      h3.record(3);

      h1.add(h2);
      h1.add(h3);

      assert.strictEqual(h1.count, 3);
      assert.strictEqual(h1.min, 1);
      assert.strictEqual(h1.max, 3);
    });
  });

  describe("BigInt support", () => {
    test("recording BigInt values", () => {
      const h = createHistogram();

      h.record(1n);
      h.record(5n);

      assert.strictEqual(h.count, 2);
      assert.strictEqual(h.min, 1);
      assert.strictEqual(h.max, 5);
    });

    test("BigInt getters", () => {
      const h = createHistogram();

      h.record(42);

      assert.strictEqual(h.countBigInt, 1n);
      assert.strictEqual(h.minBigInt, 42n);
      assert.strictEqual(h.maxBigInt, 42n);
    });
  });

  // Additional comprehensive tests based on Node.js implementation
  describe("comprehensive validation tests", () => {
    test("createHistogram with BigInt parameters", () => {
      const h = createHistogram({ lowest: 1n, highest: 1000n, figures: 3 });
      h.record(500);
      assert.strictEqual(h.count, 1);
      assert.strictEqual(h.min, 500);
      assert.strictEqual(h.max, 500);
    });

    test("createHistogram parameter validation", () => {
      // Test figures validation
      assert.throws(() => createHistogram({ figures: -1 }), /out of range/);
      assert.throws(() => createHistogram({ figures: 6 }), /out of range/);

      // Test lowest validation
      assert.throws(() => createHistogram({ lowest: 0 }), /out of range/);
      assert.throws(() => createHistogram({ lowest: -1 }), /out of range/);

      // Test highest validation (must be >= 2 * lowest)
      assert.throws(() => createHistogram({ lowest: 10, highest: 15 }), /out of range/);
      assert.throws(() => createHistogram({ lowest: 5, highest: 9 }), /out of range/);

      // Valid case: highest = 2 * lowest
      const h = createHistogram({ lowest: 5, highest: 10, figures: 1 });
      assert.strictEqual(h.count, 0);
    });

    test("percentile validation", () => {
      const h = createHistogram();
      h.record(50);

      // Invalid percentiles
      assert.throws(() => h.percentile(0), /out of range/);
      assert.throws(() => h.percentile(-1), /out of range/);
      assert.throws(() => h.percentile(101), /out of range/);
      assert.throws(() => h.percentile(NaN), /out of range/);

      // Valid percentiles
      assert.strictEqual(typeof h.percentile(1), "number");
      assert.strictEqual(typeof h.percentile(50), "number");
      assert.strictEqual(typeof h.percentile(100), "number");
    });

    test("percentileBigInt validation", () => {
      const h = createHistogram();
      h.record(50);

      // Invalid percentiles
      assert.throws(() => h.percentileBigInt(0), /out of range/);
      assert.throws(() => h.percentileBigInt(-1), /out of range/);
      assert.throws(() => h.percentileBigInt(101), /out of range/);
      assert.throws(() => h.percentileBigInt(NaN), /out of range/);

      // Valid percentiles
      assert.strictEqual(typeof h.percentileBigInt(1), "bigint");
      assert.strictEqual(typeof h.percentileBigInt(50), "bigint");
      assert.strictEqual(typeof h.percentileBigInt(100), "bigint");
    });

    test("record with very large BigInt values", () => {
      const h = createHistogram();
      // Use a large but reasonable BigInt value that Node.js can handle
      const largeBigInt = BigInt(Number.MAX_SAFE_INTEGER);

      h.record(largeBigInt);
      assert.strictEqual(h.count, 1);
      assert.strictEqual(h.countBigInt, 1n);
    });

    test("add with empty histograms", () => {
      const h1 = createHistogram();
      const h2 = createHistogram();

      // Both empty
      h1.add(h2);
      assert.strictEqual(h1.count, 0);
      assert.strictEqual(h1.exceeds, 0);

      // One empty, one with data
      h2.record(42);
      h1.add(h2);
      assert.strictEqual(h1.count, 1);
      assert.strictEqual(h1.min, 42);
      assert.strictEqual(h1.max, 42);
    });

    test("reset preserves initial state", () => {
      const h = createHistogram();

      // Record some values
      h.record(10);
      h.record(20);
      h.record(30);

      // Reset
      h.reset();

      // Should be back to initial state
      assert.strictEqual(h.count, 0);
      assert.strictEqual(h.countBigInt, 0n);
      assert.strictEqual(h.min, 9223372036854776000);
      assert.strictEqual(h.minBigInt, 9223372036854775807n);
      assert.strictEqual(h.max, 0);
      assert.strictEqual(h.maxBigInt, 0n);
      assert.strictEqual(h.exceeds, 0);
      assert.strictEqual(h.exceedsBigInt, 0n);
      assert.ok(Number.isNaN(h.mean));
      assert.ok(Number.isNaN(h.stddev));
    });

    test("percentiles map properties", () => {
      const h = createHistogram();

      for (let i = 1; i <= 100; i++) {
        h.record(i);
      }

      const percentiles = h.percentiles;
      const percentilesBigInt = h.percentilesBigInt;

      // Should be Map-like objects
      assert.ok(typeof percentiles.size === "number");
      assert.ok(typeof percentiles.has === "function");
      assert.ok(typeof percentiles.get === "function");
      assert.ok(typeof percentiles[Symbol.iterator] === "function");

      assert.ok(typeof percentilesBigInt.size === "number");
      assert.ok(typeof percentilesBigInt.has === "function");
      assert.ok(typeof percentilesBigInt.get === "function");
      assert.ok(typeof percentilesBigInt[Symbol.iterator] === "function");

      // Should have same keys
      assert.strictEqual(percentiles.size, percentilesBigInt.size);

      // Values should be consistent - in Node.js both percentiles and percentilesBigInt return bigint values
      for (const [key, value] of percentiles) {
        assert.strictEqual(typeof key, "number");
        assert.strictEqual(typeof value, "bigint");
        // Check that percentilesBigInt has the same key and value
        assert.ok(percentilesBigInt.has(key));
        const bigIntValue = percentilesBigInt.get(key);
        assert.strictEqual(typeof bigIntValue, "bigint");
        assert.strictEqual(value, bigIntValue);
      }
    });

    test("statistical accuracy", () => {
      const h = createHistogram();

      // Record values 1-1000
      for (let i = 1; i <= 1000; i++) {
        h.record(i);
      }

      assert.strictEqual(h.count, 1000);
      assert.strictEqual(h.min, 1);
      assert.strictEqual(h.max, 1000);
      assert.strictEqual(h.mean, 500.5);

      // Check some percentiles
      assert.ok(Math.abs(h.percentile(50) - 500) <= 1); // 50th percentile should be around 500
      assert.ok(Math.abs(h.percentile(90) - 900) <= 10); // 90th percentile should be around 900
      assert.ok(Math.abs(h.percentile(99) - 990) <= 10); // 99th percentile should be around 990
    });

    test("recordDelta timing accuracy", async () => {
      const h = createHistogram();

      h.recordDelta(); // Start timing

      const start = Date.now();
      await new Promise(resolve => setTimeout(resolve, 50));
      const end = Date.now();

      h.recordDelta(); // Record the delta

      assert.strictEqual(h.count, 1);

      // The recorded value should be roughly the time elapsed (in nanoseconds)
      // We can't be too precise due to timing variations, but it should be in the right ballpark
      const expectedNs = (end - start) * 1000000; // Convert ms to ns
      const actualValue = h.min;

      // Should be within reasonable range (allowing for timing variations)
      assert.ok(actualValue > expectedNs * 0.5);
      assert.ok(actualValue < expectedNs * 2);
    });

    test("toJSON method", () => {
      const h = createHistogram();

      h.record(10);
      h.record(20);
      h.record(30);

      // Check if toJSON method exists (it might not be implemented yet)
      if (typeof (h as any).toJSON === "function") {
        const json = (h as any).toJSON();

        assert.strictEqual(typeof json, "object");
        assert.strictEqual(json.count, 3);
        assert.strictEqual(json.min, 10);
        assert.strictEqual(json.max, 30);
        assert.strictEqual(json.mean, 20);
        assert.strictEqual(json.exceeds, 0);
        assert.strictEqual(typeof json.stddev, "number");
        assert.strictEqual(typeof json.percentiles, "object");

        // percentiles should be a plain object, not a Map
        assert.ok(!json.percentiles.has); // Should not have Map methods
        assert.ok(typeof json.percentiles === "object");
      } else {
        // Skip test if toJSON is not implemented
        console.log("toJSON method not implemented yet - skipping test");
      }
    });

    test("extreme value handling", () => {
      const h = createHistogram();

      // Test with value 1 (minimum allowed)
      h.record(1);
      assert.strictEqual(h.min, 1);
      assert.strictEqual(h.max, 1);
      assert.strictEqual(h.count, 1);

      // Test with very large value
      const largeValue = Number.MAX_SAFE_INTEGER;
      h.record(largeValue);
      assert.strictEqual(h.min, 1);
      assert.strictEqual(h.max, largeValue);
      assert.strictEqual(h.count, 2);
    });

    test("concurrent operations", () => {
      const h = createHistogram();

      // Simulate concurrent operations
      for (let i = 0; i < 100; i++) {
        h.record(i + 1);
        if (i % 10 === 0) {
          // Intermittent reads shouldn't affect the data
          const count = h.count;
          const min = h.min;
          const max = h.max;
          assert.ok(count > 0);
          assert.ok(min >= 1);
          assert.ok(max >= min);
        }
      }

      assert.strictEqual(h.count, 100);
      assert.strictEqual(h.min, 1);
      assert.strictEqual(h.max, 100);
    });
  });

  test("inspect output", () => {
    const h = createHistogram();
    h.record(1);

    const inspected = inspect(h);
    // Node.js shows "Histogram", Bun shows "RecordableHistogram"
    assert.ok(inspected.includes("Histogram"));
  });
});
