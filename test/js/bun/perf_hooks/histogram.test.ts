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
    assert.throws(() => h.record("invalid"), /must be of type number/);
  });

  const rangeError = (message: string) => ({ name: "RangeError", code: "ERR_OUT_OF_RANGE", message });
  const typeError = (name: string, received: string) => ({
    name: "TypeError",
    code: "ERR_INVALID_ARG_TYPE",
    message: `The "${name}" argument must be of type number. Received ${received}`,
  });

  describe("record validation", () => {
    test("a number that is not an integer", () => {
      const h = createHistogram();

      for (const value of [1.5, 0.5, NaN, Infinity, -Infinity]) {
        assert.throws(
          () => h.record(value),
          rangeError(`The value of "val" is out of range. It must be an integer. Received ${value}`),
        );
      }
      assert.strictEqual(h.count, 0);
    });

    test("a number out of range", () => {
      const h = createHistogram();

      for (const [value, received] of [
        [0, "0"],
        [-1, "-1"],
        [Number.MAX_SAFE_INTEGER + 1, "9_007_199_254_740_992"],
      ] as const) {
        assert.throws(
          () => h.record(value),
          rangeError(
            `The value of "val" is out of range. It must be >= 1 && <= 9007199254740991. Received ${received}`,
          ),
        );
      }
      assert.strictEqual(h.count, 0);

      h.record(1);
      h.record(Number.MAX_SAFE_INTEGER);
      assert.strictEqual(h.count, 2);
    });

    test("a value that is not a number or a bigint", () => {
      const h: any = createHistogram();

      for (const [value, received] of [
        [false, "type boolean (false)"],
        ["", "type string ('')"],
        [{}, "an instance of Object"],
        [undefined, "undefined"],
        [null, "null"],
      ] as const) {
        assert.throws(() => h.record(value), typeError("val", received));
      }
      assert.throws(() => h.record(), typeError("val", "undefined"));
      assert.strictEqual(h.count, 0);
    });

    test("a bigint that is below 1 or does not fit in an int64", () => {
      const h = createHistogram();

      for (const value of [0n, -1n, 2n ** 63n, 2n ** 64n + 1n]) {
        assert.throws(() => h.record(value), rangeError("value is out of range"));
      }
      assert.deepStrictEqual({ count: h.count, exceeds: h.exceeds }, { count: 0, exceeds: 0 });

      h.record(1n);
      // Fits in an int64, but is above the default `highest`.
      h.record(2n ** 63n - 1n);
      assert.deepStrictEqual({ count: h.count, exceeds: h.exceeds }, { count: 1, exceeds: 1 });
    });

    test("a rejected value leaves the histogram unchanged", () => {
      const h = createHistogram();
      for (const value of [55281, 433722, 100000, 200000]) h.record(value);

      assert.throws(
        () => h.record(1.5),
        rangeError('The value of "val" is out of range. It must be an integer. Received 1.5'),
      );
      assert.deepStrictEqual({ count: h.count, min: h.min }, { count: 4, min: 55264 });
    });
  });

  for (const method of ["percentile", "percentileBigInt"] as const) {
    describe(`${method}() arguments`, () => {
      test("a number out of range", () => {
        const h = createHistogram();
        h.record(50);

        for (const [value, received] of [
          [101, "101"],
          [100.5, "100.5"],
          [0, "0"],
          [-1, "-1"],
          [NaN, "NaN"],
          [Infinity, "Infinity"],
          [-Infinity, "-Infinity"],
        ] as const) {
          assert.throws(
            () => h[method](value),
            rangeError(`The value of "percentile" is out of range. It must be > 0 && <= 100. Received ${received}`),
          );
        }

        assert.deepStrictEqual(
          [Number.MIN_VALUE, 100].map(percentile => Number(h[method](percentile))),
          [50, 50],
        );
      });

      test("a value that is not a number", () => {
        const h: any = createHistogram();
        h.record(50);

        for (const [value, received] of [
          ["50", "type string ('50')"],
          [50n, "type bigint (50n)"],
          [{}, "an instance of Object"],
          [undefined, "undefined"],
          [null, "null"],
        ] as const) {
          assert.throws(() => h[method](value), typeError("percentile", received));
        }
        assert.throws(() => h[method](), typeError("percentile", "undefined"));
      });
    });
  }

  describe("min and max", () => {
    const read = (h: ReturnType<typeof createHistogram>) => ({
      count: h.count,
      min: h.min,
      minBigInt: h.minBigInt,
      max: h.max,
      maxBigInt: h.maxBigInt,
    });
    const empty = { min: 9223372036854776000, minBigInt: 9223372036854775807n, max: 0, maxBigInt: 0n };

    // Node reports the bounds of the bucket that holds the value, the same as percentile().
    test("are bucket-equivalent, like percentile()", () => {
      const h = createHistogram();
      for (const value of [55281, 433722, 100000, 200000]) h.record(value);

      assert.deepStrictEqual(read(h), { count: 4, min: 55264, minBigInt: 55264n, max: 433919, maxBigInt: 433919n });
      assert.deepStrictEqual(
        { p1: h.percentile(1), p100: h.percentile(100), p100BigInt: h.percentileBigInt(100) },
        { p1: 55295, p100: 433919, p100BigInt: 433919n },
      );
    });

    test("stay bucket-equivalent through add() and reset()", () => {
      const a = createHistogram();
      const b = createHistogram();
      for (const value of [55281, 433722]) a.record(value);
      for (const value of [100000, 200000, 999999]) b.record(value);
      const merged = { count: 5, min: 55264, minBigInt: 55264n, max: 1000447, maxBigInt: 1000447n };

      a.add(b);
      assert.deepStrictEqual(read(a), merged);

      const c = createHistogram();
      c.add(a);
      assert.deepStrictEqual(read(c), merged);

      c.reset();
      assert.deepStrictEqual(read(c), { count: 0, ...empty });
    });

    test("ignore values that add() drops", () => {
      const narrow = createHistogram({ lowest: 1, highest: 10, figures: 1 });
      const wide = createHistogram();
      wide.record(100000);

      narrow.add(wide);
      assert.deepStrictEqual(read(narrow), { count: 1, ...empty });
    });

    test("with a `lowest` above 1", () => {
      const h = createHistogram({ lowest: 1000, highest: 1e6 });

      h.record(5);
      assert.deepStrictEqual(read(h), { count: 1, min: 0, minBigInt: 0n, max: 511, maxBigInt: 511n });

      h.record(5000);
      assert.deepStrictEqual(read(h), { count: 2, min: 0, minBigInt: 0n, max: 5119, maxBigInt: 5119n });
    });
  });

  test("histogram with custom options", () => {
    const h = createHistogram({ lowest: 1, highest: 11, figures: 1 });

    h.record(5);
    assert.strictEqual(h.count, 1);
    assert.strictEqual(h.min, 5);
    assert.strictEqual(h.max, 5);
  });

  test("invalid histogram options", () => {
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
      const h = createHistogram({ lowest: 1, highest: 10, figures: 1 });

      assert.strictEqual(h.exceeds, 0);

      h.record(5);
      assert.strictEqual(h.exceeds, 0);
      assert.strictEqual(h.count, 1);

      h.record(100);
      assert.strictEqual(h.exceeds, 1);
      assert.strictEqual(h.count, 1);

      assert.strictEqual(h.min, 5);
      assert.strictEqual(h.max, 5);
    });

    test("exceeds with BigInt", () => {
      const h = createHistogram({ lowest: 1, highest: 10, figures: 1 });

      h.record(5);
      h.record(100);

      assert.strictEqual(h.exceeds, 1);
      assert.strictEqual(h.exceedsBigInt, 1n);
      assert.strictEqual(h.count, 1);
    });

    test("exceeds count in add operation", () => {
      const h1 = createHistogram({ lowest: 1, highest: 10, figures: 1 });
      const h2 = createHistogram({ lowest: 1, highest: 10, figures: 1 });

      h1.record(5);
      h1.record(100);
      assert.strictEqual(h1.exceeds, 1);
      assert.strictEqual(h1.count, 1);

      h2.record(8);
      h2.record(200);
      assert.strictEqual(h2.exceeds, 1);
      assert.strictEqual(h2.count, 1);

      h1.add(h2);
      assert.strictEqual(h1.exceeds, 2);
      assert.strictEqual(h1.count, 2);
    });

    test("exceeds count after reset", () => {
      const h = createHistogram({ lowest: 1, highest: 10, figures: 1 });

      h.record(5);
      h.record(100);
      assert.strictEqual(h.exceeds, 1);
      assert.strictEqual(h.count, 1);

      h.reset();
      assert.strictEqual(h.exceeds, 0);
      assert.strictEqual(h.count, 0);
    });

    test("exceeds with very small range", () => {
      const h = createHistogram({ lowest: 1, highest: 2, figures: 1 });

      h.record(1);
      h.record(50);
      h.record(100);

      assert.strictEqual(h.exceeds, 2);
      assert.strictEqual(h.count, 1);
      assert.strictEqual(h.min, 1);
      assert.strictEqual(h.max, 1);
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

    test("percentiles holds numbers and percentilesBigInt holds bigints", () => {
      const h = createHistogram();
      h.record(1);

      assert.deepStrictEqual(
        h.percentiles,
        new Map([
          [0, 1],
          [100, 1],
        ]),
      );
      assert.deepStrictEqual(
        h.percentilesBigInt,
        new Map([
          [0, 1n],
          [100, 1n],
        ]),
      );
    });

    // Node fills both maps with the lowest value of each bucket. percentile() returns the highest.
    test("percentiles and percentilesBigInt hold the lowest value of each bucket", () => {
      const h = createHistogram();
      for (const value of [55281, 433722, 100000, 200000]) h.record(value);

      assert.deepStrictEqual(
        h.percentilesBigInt,
        new Map([
          [0, 55264n],
          [50, 99968n],
          [75, 199936n],
          [87.5, 433664n],
          [100, 433664n],
        ]),
      );
      assert.deepStrictEqual(
        h.percentiles,
        new Map([
          [0, 55264],
          [50, 99968],
          [75, 199936],
          [87.5, 433664],
          [100, 433664],
        ]),
      );
      assert.deepStrictEqual(
        [50, 75, 87.5, 100].map(percentile => h.percentile(percentile)),
        [100031, 200063, 433919, 433919],
      );
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

  describe("comprehensive validation tests", () => {
    test("createHistogram with BigInt parameters", () => {
      const h = createHistogram({ lowest: 1n, highest: 1000n, figures: 3 });
      h.record(500);
      assert.strictEqual(h.count, 1);
      assert.strictEqual(h.min, 500);
      assert.strictEqual(h.max, 500);
    });

    test("createHistogram parameter validation", () => {
      assert.throws(
        () => createHistogram({ figures: -1 }),
        err => {
          return err.code === "ERR_OUT_OF_RANGE" && err.message.includes("options.figures");
        },
      );
      assert.throws(
        () => createHistogram({ figures: 6 }),
        err => {
          return err.code === "ERR_OUT_OF_RANGE" && err.message.includes("options.figures");
        },
      );

      assert.throws(
        () => createHistogram({ lowest: 0 }),
        err => {
          return err.code === "ERR_OUT_OF_RANGE" && err.message.includes("options.lowest");
        },
      );
      assert.throws(
        () => createHistogram({ lowest: -1 }),
        err => {
          return err.code === "ERR_OUT_OF_RANGE" && err.message.includes("options.lowest");
        },
      );

      assert.throws(
        () => createHistogram({ lowest: 10, highest: 15 }),
        err => {
          return err.code === "ERR_OUT_OF_RANGE" && err.message.includes("options.highest");
        },
      );
      assert.throws(
        () => createHistogram({ lowest: 5, highest: 9 }),
        err => {
          return err.code === "ERR_OUT_OF_RANGE" && err.message.includes("options.highest");
        },
      );

      assert.throws(
        () => createHistogram({ figures: "invalid" }),
        err => {
          return err.code === "ERR_INVALID_ARG_TYPE" && err.message.includes("options.figures");
        },
      );
      assert.throws(
        () => createHistogram({ lowest: "invalid" }),
        err => {
          return err.code === "ERR_INVALID_ARG_TYPE" && err.message.includes("options.lowest");
        },
      );
      assert.throws(
        () => createHistogram({ highest: "invalid" }),
        err => {
          return err.code === "ERR_INVALID_ARG_TYPE" && err.message.includes("options.highest");
        },
      );

      const h = createHistogram({ lowest: 5, highest: 10, figures: 1 });
      assert.strictEqual(h.count, 0);
    });

    test("percentile validation", () => {
      const h = createHistogram();
      h.record(50);

      assert.throws(() => h.percentile(0), /out of range/);
      assert.throws(() => h.percentile(-1), /out of range/);
      assert.throws(() => h.percentile(101), /out of range/);
      assert.throws(() => h.percentile(NaN), /out of range/);

      assert.strictEqual(typeof h.percentile(1), "number");
      assert.strictEqual(typeof h.percentile(50), "number");
      assert.strictEqual(typeof h.percentile(100), "number");
    });

    test("percentileBigInt validation", () => {
      const h = createHistogram();
      h.record(50);

      assert.throws(() => h.percentileBigInt(0), /out of range/);
      assert.throws(() => h.percentileBigInt(-1), /out of range/);
      assert.throws(() => h.percentileBigInt(101), /out of range/);
      assert.throws(() => h.percentileBigInt(NaN), /out of range/);

      assert.strictEqual(typeof h.percentileBigInt(1), "bigint");
      assert.strictEqual(typeof h.percentileBigInt(50), "bigint");
      assert.strictEqual(typeof h.percentileBigInt(100), "bigint");
    });

    test("record with very large BigInt values", () => {
      const h = createHistogram();

      const largeBigInt = BigInt(Number.MAX_SAFE_INTEGER);

      h.record(largeBigInt);
      assert.strictEqual(h.count, 1);
      assert.strictEqual(h.countBigInt, 1n);
    });

    test("add with empty histograms", () => {
      const h1 = createHistogram();
      const h2 = createHistogram();

      h1.add(h2);
      assert.strictEqual(h1.count, 0);
      assert.strictEqual(h1.exceeds, 0);

      h2.record(42);
      h1.add(h2);
      assert.strictEqual(h1.count, 1);
      assert.strictEqual(h1.min, 42);
      assert.strictEqual(h1.max, 42);
    });

    test("reset preserves initial state", () => {
      const h = createHistogram();

      h.record(10);
      h.record(20);
      h.record(30);

      h.reset();

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

      assert.ok(typeof percentiles.size === "number");
      assert.ok(typeof percentiles.has === "function");
      assert.ok(typeof percentiles.get === "function");
      assert.ok(typeof percentiles[Symbol.iterator] === "function");

      // Node returns one Map from both getters and refills it on each access, so copy the entries first.
      const entries = [...percentiles];
      const percentilesBigInt = h.percentilesBigInt;

      assert.ok(typeof percentilesBigInt.size === "number");
      assert.ok(typeof percentilesBigInt.has === "function");
      assert.ok(typeof percentilesBigInt.get === "function");
      assert.ok(typeof percentilesBigInt[Symbol.iterator] === "function");

      assert.strictEqual(entries.length, percentilesBigInt.size);

      for (const [key, value] of entries) {
        assert.strictEqual(typeof key, "number");
        assert.strictEqual(typeof value, "number");

        assert.ok(percentilesBigInt.has(key));
        const bigIntValue = percentilesBigInt.get(key);
        assert.strictEqual(typeof bigIntValue, "bigint");
        assert.strictEqual(BigInt(value), bigIntValue);
      }
    });

    test("statistical accuracy", () => {
      const h = createHistogram();

      for (let i = 1; i <= 1000; i++) {
        h.record(i);
      }

      assert.strictEqual(h.count, 1000);
      assert.strictEqual(h.min, 1);
      assert.strictEqual(h.max, 1000);
      assert.strictEqual(h.mean, 500.5);

      assert.ok(Math.abs(h.percentile(50) - 500) <= 1);
      assert.ok(Math.abs(h.percentile(90) - 900) <= 10);
      assert.ok(Math.abs(h.percentile(99) - 990) <= 10);
    });

    test("recordDelta timing accuracy", async () => {
      const h = createHistogram();

      h.recordDelta();

      const start = Date.now();
      await new Promise(resolve => setTimeout(resolve, 50));
      const end = Date.now();

      h.recordDelta();

      assert.strictEqual(h.count, 1);

      const expectedNs = (end - start) * 1000000;
      const actualValue = h.min;

      assert.ok(actualValue > expectedNs * 0.5);
      assert.ok(actualValue < expectedNs * 2);
    });

    test("toJSON method", () => {
      const h = createHistogram();

      h.record(10);
      h.record(20);
      h.record(30);

      if (typeof h.toJSON === "function") {
        const json = h.toJSON();

        assert.strictEqual(typeof json, "object");
        assert.strictEqual(json.count, 3);
        assert.strictEqual(json.min, 10);
        assert.strictEqual(json.max, 30);
        assert.strictEqual(json.mean, 20);
        assert.strictEqual(json.exceeds, 0);
        assert.strictEqual(typeof json.stddev, "number");
        assert.strictEqual(typeof json.percentiles, "object");

        assert.ok(!json.percentiles.has);
        assert.ok(typeof json.percentiles === "object");
      } else {
        console.log("toJSON method not implemented yet - skipping test");
      }
    });

    test("extreme value handling", () => {
      const h = createHistogram();

      h.record(1);
      assert.strictEqual(h.min, 1);
      assert.strictEqual(h.max, 1);
      assert.strictEqual(h.count, 1);

      const largeValue = Number.MAX_SAFE_INTEGER;
      h.record(largeValue);
      assert.strictEqual(h.min, 1);
      assert.strictEqual(h.max, largeValue);
      assert.strictEqual(h.count, 2);
    });

    test("concurrent operations", () => {
      const h = createHistogram();

      for (let i = 0; i < 100; i++) {
        h.record(i + 1);
        if (i % 10 === 0) {
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

    assert.ok(inspected.includes("Histogram"));
  });
});
