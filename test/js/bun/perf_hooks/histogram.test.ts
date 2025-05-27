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
    const h = createHistogram({ lowest: 1, highest: 11, figures: 1 });

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

  test("inspect output", () => {
    const h = createHistogram();
    h.record(1);

    const inspected = inspect(h);
    assert.ok(inspected.includes("Histogram"));
  });
});
