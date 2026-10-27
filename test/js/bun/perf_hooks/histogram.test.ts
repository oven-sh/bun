import assert from "node:assert";
import { spawnSync } from "node:child_process";
import { once } from "node:events";
import { describe, test } from "node:test";
import { inspect } from "node:util";
import { serialize } from "node:v8";
import { MessageChannel, Worker } from "node:worker_threads";
import {
  createHistogram,
  createSlidingWindowHistogram,
  importHistogram,
  monitorEventLoopDelay,
  type RecordableHistogram,
} from "perf_hooks";

// This file also runs under Node.js (`node --test`), which is where the expected values come from.
// Node.js v26.12.1 fails the tests that are marked with this.
const notInNode = { skip: typeof Bun === "undefined" && "a bug in Node.js" };
// The classes are native in Bun, where a native class differs from one that is written in JavaScript.
const isNative = typeof Bun !== "undefined";

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

  test("recordDelta measures less than a microsecond", () => {
    // With 5 figures, a value below 2 ** 18 is exact.
    const h = createHistogram({ figures: 5 });
    const deltas = [];
    for (let i = 0; i < 100; i++) {
      h.reset();
      h.recordDelta();
      h.recordDelta();
      if (h.max < 2 ** 18) deltas.push(h.max);
    }
    assert.notStrictEqual(deltas.length, 0);
    assert.ok(
      deltas.some(delta => delta % 1000 !== 0),
      `every delta is a whole number of microseconds: ${deltas}`,
    );
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
  });

  describe("edge cases", () => {
    test("recording zero", () => {
      const h = createHistogram();
      for (const zero of [0, -0, 0n]) h.record(zero);
      assert.deepStrictEqual([h.count, h.min, h.max, h.mean, h.percentile(50)], [3, 0, 0, 0, 0]);
      h.record(10);
      assert.deepStrictEqual([h.count, h.min, h.max, h.mean, h.percentile(100)], [4, 0, 10, 2.5, 10]);
    });

    test("recording zero where the lowest value is above 1", () => {
      const h = createHistogram({ lowest: 1000, highest: 1e6 });
      h.record(0);
      h.record(1);
      assert.deepStrictEqual([h.count, h.min, h.max, h.countAt(0), h.countAt(511)], [2, 0, 511, 2, 2]);
    });

    // Node.js: the maximum is 0, which is below the mean and the last percentile.
    test("only zero where the lowest value is above 1", notInNode, () => {
      const h = createHistogram({ lowest: 1000, highest: 1e6 });
      h.record(0);
      assert.deepStrictEqual([h.min, h.mean, h.percentile(100), h.max], [0, 256, 511, 511]);
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
        (err: any) => {
          return err.code === "ERR_OUT_OF_RANGE" && err.message.includes("options.figures");
        },
      );
      assert.throws(
        () => createHistogram({ figures: 6 }),
        (err: any) => {
          return err.code === "ERR_OUT_OF_RANGE" && err.message.includes("options.figures");
        },
      );

      assert.throws(
        () => createHistogram({ lowest: 0 }),
        (err: any) => {
          return err.code === "ERR_OUT_OF_RANGE" && err.message.includes("options.lowest");
        },
      );
      assert.throws(
        () => createHistogram({ lowest: -1 }),
        (err: any) => {
          return err.code === "ERR_OUT_OF_RANGE" && err.message.includes("options.lowest");
        },
      );

      assert.throws(
        () => createHistogram({ lowest: 10, highest: 15 }),
        (err: any) => {
          return err.code === "ERR_OUT_OF_RANGE" && err.message.includes("options.highest");
        },
      );
      assert.throws(
        () => createHistogram({ lowest: 5, highest: 9 }),
        (err: any) => {
          return err.code === "ERR_OUT_OF_RANGE" && err.message.includes("options.highest");
        },
      );

      assert.throws(
        () => createHistogram({ figures: "invalid" as any }),
        (err: any) => {
          return err.code === "ERR_INVALID_ARG_TYPE" && err.message.includes("options.figures");
        },
      );
      assert.throws(
        () => createHistogram({ lowest: "invalid" as any }),
        (err: any) => {
          return err.code === "ERR_INVALID_ARG_TYPE" && err.message.includes("options.lowest");
        },
      );
      assert.throws(
        () => createHistogram({ highest: "invalid" as any }),
        (err: any) => {
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
      const percentilesBigInt: Map<any, bigint> = h.percentilesBigInt;

      assert.ok(typeof percentiles.size === "number");
      assert.ok(typeof percentiles.has === "function");
      assert.ok(typeof percentiles.get === "function");
      assert.ok(typeof percentiles[Symbol.iterator] === "function");

      assert.ok(typeof percentilesBigInt.size === "number");
      assert.ok(typeof percentilesBigInt.has === "function");
      assert.ok(typeof percentilesBigInt.get === "function");
      assert.ok(typeof percentilesBigInt[Symbol.iterator] === "function");

      assert.strictEqual(percentiles.size, percentilesBigInt.size);

      for (const [key, value] of percentiles) {
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

      assert.deepStrictEqual((h as any).toJSON(), {
        count: 3,
        min: 10,
        max: 30,
        mean: 20,
        exceeds: 0,
        stddev: 8.16496580927726,
        skewness: 0,
        kurtosis: 0,
        ewmaMean: 0,
        ewmaStddev: 0,
        ewmaErrorRate: 0,
        percentiles: { 0: 10, 50: 20, 75: 30, 100: 30 },
      });
      assert.strictEqual(
        JSON.stringify(h),
        '{"count":3,"min":10,"max":30,"mean":20,"exceeds":0,"stddev":8.16496580927726,"skewness":0,"kurtosis":0,"ewmaMean":0,"ewmaStddev":0,"ewmaErrorRate":0,"percentiles":{"0":10,"50":20,"75":30,"100":30}}',
      );
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

    assert.strictEqual(
      inspect(h),
      "Histogram {\n  min: 1,\n  max: 1,\n  mean: 1,\n  exceeds: 0,\n  stddev: 0,\n  skewness: 0,\n  kurtosis: 0,\n  count: 1,\n  percentiles: Map(2) { 0 => 1, 100 => 1 }\n}",
    );
    assert.strictEqual(inspect(h, { depth: -1 }), "[RecordableHistogram]");
    assert.strictEqual(inspect({ h }, { depth: 0 }), "{ h: [RecordableHistogram] }");
    assert.strictEqual(inspect(monitorEventLoopDelay(), { depth: -1 }), "[ELDHistogram]");
  });

  test("what inherits from a histogram can be inspected", () => {
    const h = createHistogram();
    // Node.js prints the histogram. Here the counts are in the object itself, which these are not.
    for (const object of [Object.create(h), new Proxy(h, {})]) {
      assert.match(inspect(object), isNative ? /Histogram/ : /^Histogram \{\n  min: /);
    }
  });

  const summary = (h: any) => ({
    count: h.count,
    exceeds: h.exceeds,
    min: h.min,
    max: h.max,
    mean: h.mean,
    stddev: h.stddev,
    p50: h.percentile(50),
    p100: h.percentile(100),
  });

  describe("values are the edges of buckets", () => {
    test("one large value", () => {
      const h = createHistogram();
      h.record(123456789);
      assert.deepStrictEqual(summary(h), {
        count: 1,
        exceeds: 0,
        min: 123404288,
        max: 123469823,
        mean: 123437056,
        stddev: 0,
        p50: 123469823,
        p100: 123469823,
      });
      assert.strictEqual(h.minBigInt, 123404288n);
      assert.strictEqual(h.maxBigInt, 123469823n);
      assert.strictEqual(h.percentileBigInt(50), 123469823n);
    });

    test("several large values", () => {
      const h = createHistogram();
      for (const value of [55281, 433722, 100000, 200000]) h.record(value);
      assert.deepStrictEqual(summary(h), {
        count: 4,
        exceeds: 0,
        min: 55264,
        max: 433919,
        mean: 197268,
        stddev: 146264.07826940969,
        p50: 100031,
        p100: 433919,
      });
    });

    test("min <= mean <= max and percentile(100) === max", () => {
      for (const figures of [1, 2, 3, 4, 5]) {
        // The more figures, the more buckets there are to look at.
        const highest = figures > 3 ? 2 ** 22 : 2 ** 50;
        const h = createHistogram({ figures, highest });
        for (let value = 3; value < highest; value *= 7) {
          h.record(value);
          assert.ok(h.min <= h.mean && h.mean <= h.max, `${figures} figures, up to ${value}`);
          assert.strictEqual(h.percentile(100), h.max);
          assert.strictEqual(h.percentiles.get(0), h.min);
        }
      }
    });

    test("a lowest value above 1 widens the buckets", () => {
      const h = createHistogram({ lowest: 1000, highest: 1e9, figures: 2 });
      h.record(1);
      assert.deepStrictEqual([h.min, h.max, h.mean], [0, 511, 256]);
      h.record(1500);
      h.record(123456);
      assert.deepStrictEqual(summary(h), {
        count: 3,
        exceeds: 0,
        min: 0,
        max: 123903,
        mean: 41728,
        stddev: 57927.69598962716,
        p50: 1535,
        p100: 123903,
      });
    });

    test("the highest value is not rounded up to its bucket", () => {
      const h = createHistogram({ lowest: 1, highest: 1000, figures: 1 });
      for (const value of [1000, 1001, 1023, 1024]) h.record(value);
      assert.deepStrictEqual([h.count, h.exceeds, h.min, h.max], [1, 3, 992, 1023]);
    });

    test("every figure count", () => {
      const results = [1, 2, 3, 4, 5].map(figures => {
        const h = createHistogram({ figures });
        h.record(987654321);
        return [h.min, h.max, h.mean];
      });
      assert.deepStrictEqual(results, [
        [973078528, 1006632959, 989855744],
        [985661440, 989855743, 987758592],
        [987234304, 987758591, 987496448],
        [987627520, 987660287, 987643904],
        [987652096, 987656191, 987654144],
      ]);
    });
  });

  describe("add", () => {
    test("returns undefined", () => {
      assert.strictEqual(createHistogram().add(createHistogram()), undefined);
    });

    test("a value that does not fit is not the new min or max", () => {
      const into = createHistogram({ lowest: 1, highest: 10 });
      const from = createHistogram();
      into.record(3);
      from.record(5);
      from.record(1000);
      into.add(from);
      assert.deepStrictEqual([into.min, into.max, into.mean, into.percentile(100)], [3, 5, 4, 5]);
    });

    test("the next recordDelta measures from the recordDelta of the other", () => {
      const into = createHistogram();
      const from = createHistogram();
      from.recordDelta();
      into.add(from);
      into.recordDelta();
      assert.deepStrictEqual([into.count, from.count], [1, 0]);
    });

    for (const first of ["into", "from"]) {
      test(`the next recordDelta measures from the later of the two, and "${first}" is the earlier`, () => {
        const into = createHistogram();
        const from = createHistogram();
        const [earlier, later] = first === "into" ? [into, from] : [from, into];
        earlier.recordDelta();
        const start = performance.now();
        while (performance.now() - start < 20);
        const before = performance.now();
        later.recordDelta();
        into.add(from);
        into.recordDelta();
        const elapsed = performance.now() - before;
        assert.strictEqual(into.count, 1);
        // From the earlier one it is 20 ms more than `elapsed`.
        assert.ok(into.max < (elapsed + 10) * 1e6, `${into.max} ns in ${elapsed} ms`);
      });
    }

    test("nothing fits", () => {
      const into = createHistogram({ lowest: 1, highest: 10 });
      const from = createHistogram();
      from.record(1000);
      from.record(2000);
      into.add(from);
      assert.deepStrictEqual([into.min, into.max, into.percentile(100)], [9223372036854776000, 0, 0]);
      assert.ok(Number.isNaN(into.mean));
    });

    test("a value that does not fit counts as exceeding", notInNode, () => {
      const into = createHistogram({ lowest: 1, highest: 10 });
      const from = createHistogram();
      from.record(5);
      from.record(1000);
      from.record(2000);
      into.add(from);
      assert.deepStrictEqual([into.count, into.exceeds], [1, 2]);
    });

    test("between precisions", () => {
      const coarse = createHistogram({ figures: 1 });
      const fine = createHistogram({ figures: 5 });
      coarse.record(123456);
      fine.add(coarse);
      assert.deepStrictEqual([fine.min, fine.max, fine.mean], [122880, 122880, 122880]);

      fine.reset();
      coarse.reset();
      fine.record(123456);
      coarse.add(fine);
      assert.deepStrictEqual([coarse.min, coarse.max, coarse.mean], [122880, 126975, 124928]);
    });

    test("to itself", () => {
      const h = createHistogram({ lowest: 1, highest: 100 });
      h.record(5);
      h.record(7);
      h.record(1000);
      h.add(h);
      assert.deepStrictEqual([h.count, h.exceeds, h.min, h.max, h.mean], [4, 2, 5, 7, 6]);
    });

    test("to itself until the count would overflow", notInNode, () => {
      const h = createHistogram();
      h.record(5);
      h.record(7);
      for (let i = 0; i < 70; i++) h.add(h);
      assert.strictEqual(h.countBigInt, 2n ** 63n);
      assert.ok(h.exceedsBigInt > 0n);
      assert.deepStrictEqual([h.min, h.max, h.mean, h.stddev, h.percentile(50), h.percentile(100)], [5, 7, 6, 1, 5, 7]);
      assert.deepStrictEqual(
        [...h.percentiles],
        [
          [0, 5],
          [50, 5],
          [75, 7],
          [100, 7],
        ],
      );
    });
  });

  describe("percentiles", () => {
    test("halve the distance to 100", () => {
      const h = createHistogram();
      for (let i = 1; i <= 1000; i++) h.record(i);
      assert.deepStrictEqual(
        [...h.percentiles],
        [
          [0, 1],
          [50, 500],
          [75, 750],
          [87.5, 875],
          [93.75, 938],
          [96.875, 969],
          [98.4375, 985],
          [99.21875, 993],
          [99.609375, 997],
          [99.8046875, 999],
          [99.90234375, 1000],
          [100, 1000],
        ],
      );
      assert.deepStrictEqual(
        [...h.percentilesBigInt],
        [...h.percentiles].map(([key, value]) => [key, BigInt(value)]),
      );
    });

    test("of an empty histogram", () => {
      assert.deepStrictEqual([...createHistogram().percentiles], [[100, 0]]);
      assert.deepStrictEqual([...createHistogram().percentilesBigInt], [[100, 0n]]);
      assert.strictEqual(createHistogram().percentile(50), 0);
    });

    test("no recorded value is above the 100th", notInNode, () => {
      const h = createHistogram();
      h.record(433722);
      assert.deepStrictEqual(
        [...h.percentiles],
        [
          [0, 433664],
          [100, 433919],
        ],
      );
      for (const value of [55281, 100000, 200000]) h.record(value);
      for (const [percentile, value] of h.percentiles) {
        assert.strictEqual(value, percentile === 0 ? h.min : h.percentile(percentile));
      }
    });

    test("each read is a new Map", () => {
      const h = createHistogram();
      h.record(5);
      const numbers = h.percentiles;
      const bigints = h.percentilesBigInt;
      assert.deepStrictEqual(
        [...numbers],
        [
          [0, 5],
          [100, 5],
        ],
      );
      assert.deepStrictEqual(
        [...bigints],
        [
          [0, 5n],
          [100, 5n],
        ],
      );
    });

    test("of an empty histogram whose lowest value is above 1", notInNode, () => {
      const h = createHistogram({ lowest: 1000, highest: 1e9 });
      assert.strictEqual(h.percentile(50), 0);
      assert.strictEqual(h.percentileBigInt(100), 0n);
    });
  });

  test("the mean of large values does not overflow", () => {
    const h = createHistogram();
    for (let i = 0; i < 2000; i++) h.record(Number.MAX_SAFE_INTEGER);
    assert.deepStrictEqual([h.mean, h.stddev], [9005000231485440, 0]);
  });

  // The counts are kept 512 buckets at a time, and only where there is a value.
  describe("values next to each other and far apart", () => {
    function* spread(n: number) {
      let x = 12345;
      for (let i = 0; i < n; i++) {
        x = (x * 1103515245 + 12345) % 2147483648;
        yield 1 + Math.floor(2 ** ((x % 5000) / 100));
      }
    }
    const summary = (h: ReturnType<typeof createHistogram>) => ({
      count: h.count,
      min: h.min,
      max: h.max,
      mean: h.mean,
      stddev: h.stddev,
      exceeds: h.exceeds,
      percentile: [0.001, 1, 10, 25, 50, 75, 90, 99, 99.9, 100].map(p => h.percentile(p)),
    });

    test("around every 512th bucket", () => {
      // Below 2048 a bucket is one value wide.
      const values: number[] = [];
      for (const edge of [512, 1024, 1536, 2047]) values.push(edge - 1, edge, edge, edge + 1 - (edge % 2));
      for (const order of [values, values.toReversed()]) {
        const h = createHistogram();
        for (const value of order) h.record(value);
        const sorted = values.toSorted((a, b) => a - b);
        assert.deepStrictEqual([h.count, h.min, h.max], [sorted.length, sorted[0], sorted.at(-1)]);
        for (let rank = 1; rank <= sorted.length; rank++) {
          assert.strictEqual(h.percentile((rank / sorted.length) * 100), sorted[rank - 1], `rank ${rank}`);
        }
        assert.strictEqual(h.mean, sorted.reduce((a, b) => a + b) / sorted.length);
      }
    });

    test("a percentile past buckets that were never used", () => {
      const h = createHistogram();
      for (const [value, times] of [
        [511, 3],
        [2 ** 30, 2],
        [2 ** 50, 1],
      ]) {
        for (let i = 0; i < times; i++) h.record(value);
      }
      assert.deepStrictEqual(
        [50, 59, 91, 92, 100].map(p => h.percentile(p)),
        [511, 1074790399, 1074790399, 1126999418470399, 1126999418470399],
      );
    });

    test("3000 values from 2 to 2 ** 50", () => {
      for (const [options, expected] of [
        [
          {},
          {
            "count": 3000,
            "min": 2,
            "max": 1065426767314943,
            "mean": 32569055182520.293,
            "stddev": 129696151529394.95,
            "exceeds": 0,
            "percentile": [
              2, 2, 33, 4839, 36470783, 290715598847, 36180804501503, 807591290601471, 1065426767314943,
              1065426767314943,
            ],
          },
        ],
        [
          { "figures": 1 },
          {
            "count": 3000,
            "min": 2,
            "max": 1090715534753791,
            "mean": 32549688639420.12,
            "stddev": 129759875860503.86,
            "exceeds": 0,
            "percentile": [
              2, 2, 33, 4863, 37748735, 292057776127, 37383395344383, 809240558043135, 1090715534753791,
              1090715534753791,
            ],
          },
        ],
        [
          { "figures": 5 },
          {
            "count": 3000,
            "min": 2,
            "max": 1065169069277183,
            "mean": 32567565270515.574,
            "stddev": 129688797490856.56,
            "exceeds": 0,
            "percentile": [
              2, 2, 33, 4838, 36464895, 290552020991, 36173556744191, 807247693217791, 1065169069277183,
              1065169069277183,
            ],
          },
        ],
        [
          { "lowest": 1000, "highest": 35184372088832, "figures": 2 },
          {
            "count": 2696,
            "min": 0,
            "max": 34222299414527,
            "mean": 1146831134140.8665,
            "stddev": 4255613022877.092,
            "exceeds": 304,
            "percentile": [
              511, 511, 511, 2047, 6193151, 18253611007, 1915555414015, 24601572671487, 34222299414527, 34222299414527,
            ],
          },
        ],
      ] as const) {
        const h = createHistogram(options);
        for (const value of spread(3000)) h.record(value);
        assert.deepStrictEqual(summary(h), expected);
      }
    });

    test("add() from other precisions", () => {
      const a = createHistogram({ figures: 5 });
      for (const value of spread(3000)) a.record(value);
      const b = createHistogram({ figures: 2, highest: 2 ** 40 });
      for (const value of [3, 70000, 2 ** 39]) b.record(value);
      const h = createHistogram();
      h.add(a);
      h.add(b);
      assert.deepStrictEqual(summary(h), {
        "count": 3003,
        "min": 2,
        "max": 1065426767314943,
        "mean": 32536701822137.832,
        "stddev": 129635389617151.6,
        "exceeds": 0,
        "percentile": [
          2, 2, 33, 4839, 36470783, 290715598847, 36180804501503, 807591290601471, 1065426767314943, 1065426767314943,
        ],
      });
    });

    test("add() to itself", () => {
      const h = createHistogram();
      for (const value of spread(3000)) h.record(value);
      const before = summary(h);
      h.add(h);
      assert.deepStrictEqual(summary(h), { ...before, count: 6000 });
    });

    test("after reset() it is as new", () => {
      const h = createHistogram();
      for (const value of spread(3000)) h.record(value);
      h.reset();
      assert.deepStrictEqual(h.toJSON(), createHistogram().toJSON());
      const fresh = createHistogram();
      for (const value of [1, 513, 2 ** 45]) {
        h.record(value);
        fresh.record(value);
      }
      assert.deepStrictEqual(h.toJSON(), fresh.toJSON());
    });

    test("a structured clone sees values in buckets that were not used before", () => {
      const h = createHistogram();
      h.record(1);
      const clone = structuredClone(h);
      clone.record(2 ** 45);
      h.record(513);
      assert.deepStrictEqual(summary(h), summary(clone));
      assert.deepStrictEqual([h.count, h.min, h.percentile(50), h.max], [3, 1, 513, 35218731827199]);
    });
  });

  describe("arguments", () => {
    const thrown = (fn: () => unknown) => {
      try {
        fn();
      } catch (error: any) {
        return `${error.name} ${error.code}: ${error.message}`;
      }
      return "did not throw";
    };

    test("record", () => {
      const h = createHistogram();
      const errors = [
        undefined,
        null,
        "1",
        {},
        false,
        1.5,
        NaN,
        Infinity,
        -1,
        2 ** 53,
        1e21,
        -(2 ** 40),
        -1n,
        2n ** 63n,
        2n ** 64n + 5n,
      ];
      assert.deepStrictEqual(
        errors.map(value => thrown(() => h.record(value as any))),
        [
          'TypeError ERR_INVALID_ARG_TYPE: The "val" argument must be of type number. Received undefined',
          'TypeError ERR_INVALID_ARG_TYPE: The "val" argument must be of type number. Received null',
          `TypeError ERR_INVALID_ARG_TYPE: The "val" argument must be of type number. Received type string ('1')`,
          'TypeError ERR_INVALID_ARG_TYPE: The "val" argument must be of type number. Received an instance of Object',
          'TypeError ERR_INVALID_ARG_TYPE: The "val" argument must be of type number. Received type boolean (false)',
          'RangeError ERR_OUT_OF_RANGE: The value of "val" is out of range. It must be an integer. Received 1.5',
          'RangeError ERR_OUT_OF_RANGE: The value of "val" is out of range. It must be an integer. Received NaN',
          'RangeError ERR_OUT_OF_RANGE: The value of "val" is out of range. It must be an integer. Received Infinity',
          'RangeError ERR_OUT_OF_RANGE: The value of "val" is out of range. It must be >= 0 && <= 9007199254740991. Received -1',
          'RangeError ERR_OUT_OF_RANGE: The value of "val" is out of range. It must be >= 0 && <= 9007199254740991. Received 9_007_199_254_740_992',
          'RangeError ERR_OUT_OF_RANGE: The value of "val" is out of range. It must be >= 0 && <= 9007199254740991. Received 1e_+21',
          'RangeError ERR_OUT_OF_RANGE: The value of "val" is out of range. It must be >= 0 && <= 9007199254740991. Received -1_099_511_627_776',
          "RangeError ERR_OUT_OF_RANGE: value is out of range",
          "RangeError ERR_OUT_OF_RANGE: value is out of range",
          "RangeError ERR_OUT_OF_RANGE: value is out of range",
        ],
      );
      assert.deepStrictEqual([h.count, h.exceeds], [0, 0]);

      assert.strictEqual(h.record(1), undefined);
      h.record(Number.MAX_SAFE_INTEGER);
      h.record(1n);
      assert.deepStrictEqual([h.count, h.exceeds], [3, 0]);
      h.record(2n ** 63n - 1n);
      assert.deepStrictEqual([h.count, h.exceeds], [3, 1]);
    });

    test("percentile and percentileBigInt", () => {
      const h = createHistogram();
      for (const method of ["percentile", "percentileBigInt"] as const) {
        assert.deepStrictEqual(
          [undefined, "50", 50n, 0, -1, 101, NaN, Infinity].map(value => thrown(() => h[method](value as any))),
          [
            'TypeError ERR_INVALID_ARG_TYPE: The "percentile" argument must be of type number. Received undefined',
            `TypeError ERR_INVALID_ARG_TYPE: The "percentile" argument must be of type number. Received type string ('50')`,
            'TypeError ERR_INVALID_ARG_TYPE: The "percentile" argument must be of type number. Received type bigint (50n)',
            'RangeError ERR_OUT_OF_RANGE: The value of "percentile" is out of range. It must be > 0 && <= 100. Received 0',
            'RangeError ERR_OUT_OF_RANGE: The value of "percentile" is out of range. It must be > 0 && <= 100. Received -1',
            'RangeError ERR_OUT_OF_RANGE: The value of "percentile" is out of range. It must be > 0 && <= 100. Received 101',
            'RangeError ERR_OUT_OF_RANGE: The value of "percentile" is out of range. It must be > 0 && <= 100. Received NaN',
            'RangeError ERR_OUT_OF_RANGE: The value of "percentile" is out of range. It must be > 0 && <= 100. Received Infinity',
          ],
        );
      }
    });

    test("add", () => {
      const h = createHistogram();
      assert.deepStrictEqual(
        [{}, "hello", 1, monitorEventLoopDelay()].map(value => thrown(() => h.add(value as any))),
        [
          'TypeError ERR_INVALID_ARG_TYPE: The "other" argument must be an instance of RecordableHistogram. Received an instance of Object',
          `TypeError ERR_INVALID_ARG_TYPE: The "other" argument must be an instance of RecordableHistogram. Received type string ('hello')`,
          'TypeError ERR_INVALID_ARG_TYPE: The "other" argument must be an instance of RecordableHistogram. Received type number (1)',
          'TypeError ERR_INVALID_ARG_TYPE: The "other" argument must be an instance of RecordableHistogram. Received an instance of ELDHistogram',
        ],
      );
    });

    test("add without a histogram", notInNode, () => {
      const h = createHistogram();
      assert.deepStrictEqual(
        [undefined, null].map(value => thrown(() => h.add(value as any))),
        [
          'TypeError ERR_INVALID_ARG_TYPE: The "other" argument must be an instance of RecordableHistogram. Received undefined',
          'TypeError ERR_INVALID_ARG_TYPE: The "other" argument must be an instance of RecordableHistogram. Received null',
        ],
      );
    });

    test("createHistogram", () => {
      const options = [
        null,
        1,
        "hello",
        { lowest: 1.5 },
        { lowest: 0 },
        { lowest: 2 ** 53 },
        { lowest: {} },
        { highest: 1 },
        { highest: 1.5 },
        { highest: Infinity },
        { highest: NaN },
        { highest: 2 ** 53 },
        { lowest: 2 ** 52 },
        { lowest: 10, highest: 19 },
        { figures: 2.5 },
        { figures: 0 },
        { figures: 6 },
        { figures: 3n },
        { figures: "3" },
      ];
      assert.deepStrictEqual(
        options.map(value => thrown(() => createHistogram(value as any))),
        [
          'TypeError ERR_INVALID_ARG_TYPE: The "options" argument must be of type object. Received null',
          'TypeError ERR_INVALID_ARG_TYPE: The "options" argument must be of type object. Received type number (1)',
          `TypeError ERR_INVALID_ARG_TYPE: The "options" argument must be of type object. Received type string ('hello')`,
          'RangeError ERR_OUT_OF_RANGE: The value of "options.lowest" is out of range. It must be an integer. Received 1.5',
          'RangeError ERR_OUT_OF_RANGE: The value of "options.lowest" is out of range. It must be >= 1 && <= 9007199254740991. Received 0',
          'RangeError ERR_OUT_OF_RANGE: The value of "options.lowest" is out of range. It must be >= 1 && <= 9007199254740991. Received 9_007_199_254_740_992',
          'TypeError ERR_INVALID_ARG_TYPE: The "options.lowest" property must be of type number. Received an instance of Object',
          'RangeError ERR_OUT_OF_RANGE: The value of "options.highest" is out of range. It must be >= 2 * options.lowest (2n). Received 1',
          'RangeError ERR_OUT_OF_RANGE: The value of "options.highest" is out of range. It must be an integer. Received 1.5',
          'RangeError ERR_OUT_OF_RANGE: The value of "options.highest" is out of range. It must be an integer. Received Infinity',
          'RangeError ERR_OUT_OF_RANGE: The value of "options.highest" is out of range. It must be an integer. Received NaN',
          'RangeError ERR_OUT_OF_RANGE: The value of "options.highest" is out of range. It must be >= 1 && <= 9007199254740991. Received 9_007_199_254_740_992',
          'RangeError ERR_OUT_OF_RANGE: The value of "options.highest" is out of range. It must be >= 2 * options.lowest (9007199254740992n). Received 9_007_199_254_740_991',
          'RangeError ERR_OUT_OF_RANGE: The value of "options.highest" is out of range. It must be >= 2 * options.lowest (20n). Received 19',
          'RangeError ERR_OUT_OF_RANGE: The value of "options.figures" is out of range. It must be an integer. Received 2.5',
          'RangeError ERR_OUT_OF_RANGE: The value of "options.figures" is out of range. It must be >= 1 && <= 5. Received 0',
          'RangeError ERR_OUT_OF_RANGE: The value of "options.figures" is out of range. It must be >= 1 && <= 5. Received 6',
          'TypeError ERR_INVALID_ARG_TYPE: The "options.figures" property must be of type number. Received type bigint (3n)',
          `TypeError ERR_INVALID_ARG_TYPE: The "options.figures" property must be of type number. Received type string ('3')`,
        ],
      );
      assert.strictEqual(
        thrown(() => createHistogram({ lowest: 10n, highest: 19n })),
        'RangeError ERR_OUT_OF_RANGE: The value of "options.highest" is out of range. It must be >= 2 * options.lowest (20n). Received 19n',
      );
      assert.strictEqual(createHistogram(undefined).count, 0);
      assert.strictEqual(createHistogram({ lowest: 1n, highest: 2n ** 63n - 1n }).count, 0);
      assert.strictEqual(createHistogram.length, 0);
      assert.strictEqual(monitorEventLoopDelay.length, 0);
    });

    test("createHistogram with a number and a BigInt", () => {
      for (const options of [
        { lowest: 1, highest: 10n },
        { lowest: 1n, highest: 10 },
      ]) {
        const h = createHistogram(options);
        h.record(10);
        h.record(11);
        assert.deepStrictEqual([h.count, h.exceeds], [1, 1]);
      }
    });

    test("createHistogram with a BigInt that is out of range", () => {
      assert.deepStrictEqual(
        [
          { lowest: 0n },
          { lowest: 2n ** 63n },
          { highest: 2n ** 63n },
          { highest: 2n ** 64n + 10n },
          { lowest: 10n, highest: 19 },
          { lowest: 10, highest: 19n },
          { lowest: 2n ** 61n, highest: 2n ** 62n },
        ].map(value => thrown(() => createHistogram(value))),
        [
          'RangeError ERR_OUT_OF_RANGE: The value of "options.lowest" is out of range. It must be >= 1n && <= 9223372036854775807n. Received 0n',
          'RangeError ERR_OUT_OF_RANGE: The value of "options.lowest" is out of range. It must be >= 1n && <= 9223372036854775807n. Received 9_223_372_036_854_775_808n',
          'RangeError ERR_OUT_OF_RANGE: The value of "options.highest" is out of range. It must be >= 1n && <= 9223372036854775807n. Received 9_223_372_036_854_775_808n',
          'RangeError ERR_OUT_OF_RANGE: The value of "options.highest" is out of range. It must be >= 1n && <= 9223372036854775807n. Received 18_446_744_073_709_551_626n',
          'RangeError ERR_OUT_OF_RANGE: The value of "options.highest" is out of range. It must be >= 2 * options.lowest (20n). Received 19',
          'RangeError ERR_OUT_OF_RANGE: The value of "options.highest" is out of range. It must be >= 2 * options.lowest (20n). Received 19n',
          "TypeError ERR_INVALID_ARG_VALUE: Invalid histogram options",
        ],
      );
    });

    test("monitorEventLoopDelay", () => {
      assert.deepStrictEqual(
        [null, 1, { resolution: 0 }, { resolution: 1.5 }, { resolution: "10" }, { resolution: 10n }].map(value =>
          thrown(() => monitorEventLoopDelay(value as any)),
        ),
        [
          'TypeError ERR_INVALID_ARG_TYPE: The "options" argument must be of type object. Received null',
          'TypeError ERR_INVALID_ARG_TYPE: The "options" argument must be of type object. Received type number (1)',
          'RangeError ERR_OUT_OF_RANGE: The value of "options.resolution" is out of range. It must be >= 1 && <= 9007199254740991. Received 0',
          'RangeError ERR_OUT_OF_RANGE: The value of "options.resolution" is out of range. It must be an integer. Received 1.5',
          `TypeError ERR_INVALID_ARG_TYPE: The "options.resolution" property must be of type number. Received type string ('10')`,
          'TypeError ERR_INVALID_ARG_TYPE: The "options.resolution" property must be of type number. Received type bigint (10n)',
        ],
      );
    });

    test("a receiver of another class", () => {
      const recordable = createHistogram();
      const interval = monitorEventLoopDelay();
      const Recordable = Object.getPrototypeOf(recordable);
      const Interval = Object.getPrototypeOf(interval);
      const Base = Object.getPrototypeOf(Recordable);
      const code = (fn: () => unknown) => thrown(fn).split(":")[0];
      const invalidThis = (fn: () => unknown, type: string) =>
        assert.strictEqual(thrown(fn), `TypeError ERR_INVALID_THIS: Value of "this" must be of type ${type}`);
      // Node.js reads a property of it first, which is a TypeError with no code.
      const noReceiver = notInNode.skip ? [] : [undefined];

      for (const receiver of [{}, undefined, 1, Base, Recordable]) {
        for (const key of Reflect.ownKeys(Base)) {
          const { get, value } = Object.getOwnPropertyDescriptor(Base, key)!;
          if (key === "constructor" || typeof key === "symbol") continue;
          // In Node.js it is a getter that throws.
          if (key === "toJSON" && !isNative) continue;
          invalidThis(() => (get ?? value).call(receiver, "not looked at"), "Histogram");
        }
      }
      for (const receiver of [{}, interval, Recordable, ...noReceiver]) {
        for (const key of ["record", "recordDelta", "recordCorrected", "subtract", "add"]) {
          invalidThis(() => Recordable[key].call(receiver, "not looked at"), "RecordableHistogram");
        }
      }
      for (const receiver of [{}, recordable, Interval, ...noReceiver]) {
        for (const key of ["enable", "disable"]) {
          invalidThis(() => Interval[key].call(receiver), "ELDHistogram");
        }
      }
      // A prototype does not make it another kind of histogram.
      Object.setPrototypeOf(interval, Recordable);
      assert.strictEqual(
        code(() => (interval as any).record(1)),
        "TypeError ERR_INVALID_THIS",
      );
    });
  });

  describe("classes", () => {
    const members = (prototype: object) =>
      Reflect.ownKeys(prototype)
        .filter(key => !String(key).includes("messaging_") && !(isNative && key === Symbol.toStringTag))
        .map(key => {
          const { get, set, value, ...flags } = Object.getOwnPropertyDescriptor(prototype, key)!;
          assert.deepStrictEqual(
            flags,
            get ? { enumerable: false, configurable: true } : { writable: true, enumerable: false, configurable: true },
            String(key),
          );
          assert.strictEqual(set, undefined);
          return get ? get.name : `${value.name}/${value.length}`;
        })
        .sort();

    test("RecordableHistogram extends Histogram", () => {
      const h = createHistogram();
      const Recordable = Object.getPrototypeOf(h);
      const Base = Object.getPrototypeOf(Recordable);
      assert.strictEqual(Object.getPrototypeOf(Base), Object.prototype);
      assert.strictEqual(Object.getPrototypeOf(Recordable.constructor), Base.constructor);
      assert.strictEqual(h.constructor, Recordable.constructor);
      assert.deepStrictEqual(members(Recordable), [
        "RecordableHistogram/0",
        "add/1",
        "record/1",
        "recordCorrected/2",
        "recordDelta/0",
        "subtract/1",
      ]);
      assert.deepStrictEqual(members(Base), [
        "Histogram/0",
        "[nodejs.util.inspect.custom]/2",
        "burnRate/1",
        "ccdf/1",
        "cdf/1",
        "cliffsD/1",
        "cohensD/1",
        "countAt/1",
        "diff/1",
        "export/0",
        "get count",
        "get countBigInt",
        "get ewmaErrorRate",
        "get ewmaMean",
        "get ewmaStddev",
        "get exceeds",
        "get exceedsBigInt",
        "get kurtosis",
        "get max",
        "get maxBigInt",
        "get mean",
        "get min",
        "get minBigInt",
        "get percentiles",
        "get percentilesBigInt",
        "get resetCount",
        "get skewness",
        "get stddev",
        "ksTest/1",
        "linearBuckets/1",
        "logBuckets/2",
        "mannWhitneyTest/1",
        "meanCI/0",
        "percentile/1",
        "percentileBigInt/1",
        "percentileCI/1",
        "percentilesAt/1",
        "qrde/0",
        "reset/0",
        "snapshot/0",
        "toJSON/0",
        "welchTest/1",
      ]);
      assert.strictEqual(
        Object.prototype.toString.call(h),
        isNative ? "[object RecordableHistogram]" : "[object Object]",
      );
      assert.strictEqual(h.reset(), undefined);
      assert.strictEqual(h.recordDelta(), undefined);
    });

    test("ELDHistogram extends Histogram", () => {
      const h = monitorEventLoopDelay();
      const Interval = Object.getPrototypeOf(h);
      assert.strictEqual(
        Object.getPrototypeOf(Interval),
        Object.getPrototypeOf(Object.getPrototypeOf(createHistogram())),
      );
      assert.deepStrictEqual(members(Interval), ["ELDHistogram/0", "[Symbol.dispose]/0", "disable/0", "enable/0"]);
      assert.strictEqual((h as any).record, undefined);
    });

    test("have no own properties", notInNode, () => {
      assert.deepStrictEqual(Reflect.ownKeys(createHistogram()), []);
      assert.deepStrictEqual(Reflect.ownKeys(monitorEventLoopDelay()), []);
    });

    test("cannot be constructed", () => {
      const Recordable = createHistogram().constructor as any;
      for (const Class of [Recordable, Object.getPrototypeOf(Recordable), monitorEventLoopDelay().constructor as any]) {
        assert.throws(() => new Class(), {
          name: "TypeError",
          code: "ERR_ILLEGAL_CONSTRUCTOR",
          message: "Illegal constructor",
        });
        assert.throws(() => new Class(1, 100, 3), { code: "ERR_ILLEGAL_CONSTRUCTOR" });
        assert.throws(() => Class(), TypeError);
      }
    });

    test("getters cannot be assigned", () => {
      const h = createHistogram();
      assert.throws(() => {
        (h as any).count = 5;
      }, TypeError);
      assert.strictEqual(h.count, 0);
    });
  });

  describe("monitorEventLoopDelay", () => {
    /** Resolves once `h` has at least `count` samples. */
    const samples = (h: { count: number }, count: number, signal: AbortSignal) =>
      new Promise<void>((resolve, reject) => {
        const timer = setInterval(() => {
          if (h.count >= count) {
            clearInterval(timer);
            resolve();
          }
        }, 1);
        signal.addEventListener("abort", () => {
          clearInterval(timer);
          reject(signal.reason);
        });
      });

    test("each call returns its own histogram", async ({ signal }) => {
      const a = monitorEventLoopDelay({ resolution: 1 });
      const b = monitorEventLoopDelay({ resolution: 1 });
      assert.notStrictEqual(a, b);
      assert.strictEqual(a.enable(), true);
      assert.strictEqual(a.enable(), false);
      await samples(a, 2, signal);
      assert.strictEqual(b.count, 0);
      assert.strictEqual(b.enable(), true);
      await samples(b, 2, signal);
      assert.strictEqual(a.disable(), true);
      assert.strictEqual(a.disable(), false);
      assert.strictEqual(b.disable(), true);
    });

    test("records the time between two samples, not how late the second was", async ({ signal }) => {
      const resolution = 20;
      const h = monitorEventLoopDelay({ resolution });
      h.enable();
      await samples(h, 3, signal);
      h.disable();
      assert.ok(h.min > (resolution / 2) * 1e6, `min is ${h.min}`);
    });

    test("enable() keeps what was recorded", async ({ signal }) => {
      const h = monitorEventLoopDelay({ resolution: 1 });
      h.enable();
      await samples(h, 2, signal);
      h.disable();
      const { count } = h;
      h.enable();
      assert.strictEqual(h.count, count);
      h.disable();
      h.reset();
      assert.strictEqual(h.count, 0);
    });

    test("the time it was disabled for is not recorded", notInNode, async ({ signal }) => {
      const h = monitorEventLoopDelay({ resolution: 1 });
      let enabledAt = performance.now();
      h.enable();
      await samples(h, 1, signal);
      h.disable();
      let enabledFor = performance.now() - enabledAt;
      const { count } = h;

      const disabledAt = performance.now();
      const other = monitorEventLoopDelay({ resolution: 50 });
      other.enable();
      await samples(other, 2, signal);
      other.disable();
      const disabledFor = performance.now() - disabledAt;

      enabledAt = performance.now();
      h.enable();
      await samples(h, count + 1, signal);
      h.disable();
      enabledFor = Math.max(enabledFor, performance.now() - enabledAt);
      assert.ok(disabledFor > 50);
      // No sample is longer than the time it was enabled for.
      assert.ok(h.max <= (enabledFor + 1) * 1e6, `max is ${h.max} after ${enabledFor} ms`);
    });

    test("can be disposed", () => {
      let disposed;
      {
        using h = monitorEventLoopDelay();
        h.enable();
        disposed = h;
      }
      assert.strictEqual(disposed.disable(), false);
    });

    test("Symbol.dispose calls disable()", () => {
      const h = monitorEventLoopDelay();
      let calls = 0;
      h.disable = () => ++calls > 0;
      assert.strictEqual(h[Symbol.dispose](), undefined);
      assert.strictEqual(calls, 1);
    });

    test("does not keep the process alive", () => {
      const script = `require("node:perf_hooks").monitorEventLoopDelay({ resolution: 1 }).enable()`;
      const { status, signal } = spawnSync(process.execPath, ["-e", script], { stdio: "ignore", timeout: 30_000 });
      assert.deepStrictEqual({ status, signal }, { status: 0, signal: null });
    });
  });

  describe("structured clone", () => {
    test("shares what is recorded", () => {
      const h = createHistogram();
      h.record(7);
      const clone = structuredClone(h);
      assert.notStrictEqual(clone, h);
      assert.strictEqual(Object.getPrototypeOf(clone), Object.getPrototypeOf(h));
      clone.record(9);
      assert.deepStrictEqual([h.count, h.min, h.max], [2, 7, 9]);
      h.reset();
      assert.strictEqual(clone.count, 0);
      h.add(clone);
      clone.add(h);
    });

    test("of an ELDHistogram is a Histogram", () => {
      const h = monitorEventLoopDelay();
      const clone = structuredClone(h) as any;
      assert.strictEqual(Object.getPrototypeOf(clone), Object.getPrototypeOf(Object.getPrototypeOf(h)));
      assert.deepStrictEqual([clone.enable, clone.disable, clone.record], [undefined, undefined, undefined]);
      assert.strictEqual(clone.count, 0);
      assert.strictEqual(inspect(clone, { depth: -1 }), "[Histogram]");
    });

    test("more than once in a message", () => {
      const h = createHistogram();
      const { a, b, c } = structuredClone({ a: h, b: h, c: createHistogram() });
      assert.strictEqual(a, b);
      assert.notStrictEqual(a, c);
      a.record(1);
      assert.deepStrictEqual([h.count, c.count], [1, 0]);
    });

    test("not into bytes", () => {
      assert.throws(() => serialize({ nested: [createHistogram()] }), /could not be cloned|can not be cloned/);
    });

    // Node.js gives an empty object.
    test("not into bytes, of an ELDHistogram", notInNode, () => {
      assert.throws(() => serialize(monitorEventLoopDelay()), { name: "DataCloneError" });
    });

    test("through a MessagePort", async () => {
      const h = createHistogram();
      const { port1, port2 } = new MessageChannel();
      try {
        const received = new Promise<any>((resolve, reject) => {
          port1.once("message", resolve);
          port1.once("messageerror", reject);
        });
        port2.postMessage(h);
        (await received).record(2n);
        assert.strictEqual(h.max, 2);
      } finally {
        port1.close();
      }
    });

    // Runs `inWorker` in each of some workers and `here` in this thread, 20,000 times each, all at the same time.
    // Returns the nanoseconds that took.
    async function inThreads(workers, h, inWorker, here) {
      // How many workers are ready, and whether they can start.
      const flags = new Int32Array(new SharedArrayBuffer(8));
      const threads = Array.from(
        { length: workers },
        () =>
          new Worker(
            `const { parentPort, workerData: flags } = require("node:worker_threads");
             parentPort.once("message", h => {
               Atomics.add(flags, 0, 1);
               Atomics.notify(flags, 0);
               Atomics.wait(flags, 1, 0);
               for (let i = 0; i < 20000; i++) ${inWorker};
               parentPort.postMessage(h.constructor.name);
             });`,
            { eval: true, workerData: flags },
          ),
      );
      try {
        const done = Promise.all(
          threads.map(
            worker =>
              new Promise((resolve, reject) => {
                worker.once("message", resolve);
                worker.once("messageerror", reject);
                worker.once("error", reject);
                worker.once("exit", code => reject(new Error(`the worker exited with code ${code}`)));
              }),
          ),
        );
        done.catch(() => {});
        for (const worker of threads) worker.postMessage(h);
        for (let ready; (ready = Atomics.load(flags, 0)) < workers;) {
          await Promise.race([Atomics.waitAsync(flags, 0, ready).value, done]);
        }
        const start = process.hrtime.bigint();
        Atomics.store(flags, 1, 1);
        Atomics.notify(flags, 1);
        for (let i = 0; i < 20000; i++) here();
        assert.deepStrictEqual(await done, Array(workers).fill("RecordableHistogram"));
        return Number(process.hrtime.bigint() - start);
      } finally {
        await Promise.all(threads.map(worker => worker.terminate()));
      }
    }

    test("to a worker that records while this thread does", async () => {
      const h = createHistogram();
      await inThreads(1, h, "h.record(2)", () => h.record(1));
      assert.deepStrictEqual([h.count, h.min, h.max, h.mean], [40000, 1, 2, 1.5]);
    });

    test("to workers that call recordDelta while this thread does", async () => {
      const h = createHistogram();
      const elapsed = await inThreads(3, h, "h.recordDelta()", () => h.recordDelta());
      assert.deepStrictEqual([h.count, h.exceeds], [79999, 0]);
      // Together, the deltas are the time from the first call to the last. They are far more if a thread records the
      // time that it read after a thread that read a later one. A bucket is 0.1% wide.
      assert.ok(h.mean * h.count <= elapsed * 1.002, `${h.mean * h.count} ns in ${elapsed} ns`);
    });
  });
});

const thrown = (fn: () => unknown) => {
  try {
    fn();
  } catch (error: any) {
    return `${error.name} ${error.code}: ${error.message}`;
  }
  return "did not throw";
};
const filled = (values: Iterable<number | bigint>, options?: Parameters<typeof createHistogram>[0]) => {
  const h = createHistogram(options);
  for (const value of values) h.record(value);
  return h;
};
const upTo = (n: number) => Array.from({ length: n }, (_, i) => i + 1);
const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");
const fromHex = (text: string) => importHistogram(Buffer.from(text.replaceAll(" ", ""), "hex"));
/** These go through `exp`, `log`, `lgamma` and `erfc`, whose last bits depend on the platform. */
function assertClose(actual: unknown, expected: unknown, path = "") {
  if (typeof expected === "number" && Number.isFinite(expected)) {
    assert.ok(
      typeof actual === "number" && Math.abs(actual - expected) <= 1e-9 * Math.max(1, Math.abs(expected)),
      `${path}: ${actual} is not close to ${expected}`,
    );
  } else if (typeof expected === "object" && expected !== null) {
    assert.deepStrictEqual(Reflect.ownKeys(actual as object), Reflect.ownKeys(expected), path);
    assert.strictEqual(Object.getPrototypeOf(actual), Object.getPrototypeOf(expected), path);
    for (const key of Object.keys(expected)) assertClose(actual![key], expected[key], `${path}.${key}`);
  } else {
    assert.strictEqual(actual, expected, path);
  }
}
const bare = <T extends object>(object: T): T => Object.assign(Object.create(null), object);

describe("statistics", () => {
  test("cdf, ccdf and countAt", () => {
    const h = filled([1, 2, 2, 3, 10]);
    assert.deepStrictEqual(
      [0, 1, 2, 2.9, 9, 10, 11, 2 ** 53].map(value => [h.cdf(value), h.ccdf(value), h.countAt(value)]),
      [
        [0, 1, 0],
        [0.2, 0.8, 1],
        [0.6, 0.4, 2],
        [0.6, 0.4, 2],
        [0.8, 0.19999999999999996, 0],
        [1, 0, 1],
        [1, 0, 0],
        [1, 0, 0],
      ],
    );
    assert.deepStrictEqual([createHistogram().cdf(1), createHistogram().ccdf(1)], [0, 1]);
  });

  test("cdf and countAt are of the whole bucket of a value", () => {
    const h = filled([5000, 5001, 5002]);
    assert.deepStrictEqual(
      [4999, 5000, 5003, 5004].map(value => [h.cdf(value), h.countAt(value)]),
      [
        [0, 0],
        [1, 3],
        [1, 3],
        [1, 0],
      ],
    );
  });

  // Node.js: the share of the values in the first bucket.
  test("no value is below 0", notInNode, () => {
    const h = filled([0, 0, 5]);
    assert.deepStrictEqual([h.cdf(-1), h.cdf(-Infinity), h.countAt(-1), h.cdf(Infinity)], [0, 0, 0, 1]);
  });

  test("skewness and kurtosis", () => {
    assert.deepStrictEqual(
      [[], [1, 2], [1, 2, 3], [1, 1, 1, 10], [5, 5, 5, 5], [1, 2, 3, 4, 100]].map(values => {
        const h = filled(values);
        return [h.skewness, h.kurtosis];
      }),
      [
        [0, 0],
        [0, 0],
        [0, 0],
        [1.1547005383792515, -0.6666666666666665],
        [0, 0],
        [1.4975367033335198, 0.24671648930016365],
      ],
    );
  });

  test("more equal values than a double counts", () => {
    const h = filled([3777]);
    for (let i = 0; i < 54; i++) h.add(h);
    for (let i = 0; i < 3; i++) h.record(3777);
    assert.strictEqual(h.countBigInt, 2n ** 54n + 3n);
    assert.deepStrictEqual([h.mean, h.stddev, h.skewness, h.kurtosis], [3777, 0, 0, 0]);
  });

  test("the moving averages of halfLife and threshold", () => {
    const h = createHistogram({ halfLife: 2, threshold: 10 });
    assert.deepStrictEqual([h.ewmaMean, h.ewmaStddev, h.ewmaErrorRate, h.burnRate(0.9)], [0, 0, 0, 0]);
    assertClose(
      [5, 20, 5, 5, 30].map(value => {
        h.record(value);
        return [h.ewmaMean, h.ewmaStddev, h.ewmaErrorRate, h.burnRate(0.9)];
      }),
      [
        [5, 0, 0, 0],
        [9.393398282201787, 6.82634790843341, 0.2928932188134524, 2.928932188134525],
        [8.106601717798213, 6.07849089280772, 0.20710678118654752, 2.0710678118654755],
        [7.196699141100894, 5.303300858899107, 0.14644660940672624, 1.4644660940672627],
        [13.875631329235418, 11.295173444856395, 0.39644660940672616, 3.9644660940672622],
      ],
    );
    // A value that is not recorded does not count.
    const before = h.ewmaMean;
    h.record(2n ** 60n);
    assert.deepStrictEqual([h.exceeds, h.ewmaMean], [1, before]);
    h.reset();
    assert.deepStrictEqual([h.ewmaMean, h.ewmaStddev, h.ewmaErrorRate], [0, 0, 0]);
    h.record(50);
    assert.deepStrictEqual([h.ewmaMean, h.ewmaStddev, h.ewmaErrorRate], [50, 0, 1]);

    const without = filled([5, 20]);
    assert.deepStrictEqual(
      [without.ewmaMean, without.ewmaStddev, without.ewmaErrorRate, without.burnRate(0.5)],
      [0, 0, 0, 0],
    );
    const noThreshold = filled([5, 20], { halfLife: 1 });
    assert.deepStrictEqual([noThreshold.ewmaMean, noThreshold.ewmaErrorRate], [12.5, 0]);
  });

  test("meanCI", () => {
    const h = filled(upTo(100));
    assertClose(
      [h.meanCI(), h.meanCI({ confidence: 0.99 }), h.meanCI({}), h.meanCI(undefined)],
      [
        bare({ mean: 50.5, lower: 44.74349058306662, upper: 56.25650941693338 }),
        bare({ mean: 50.5, lower: 42.8804059150696, upper: 58.1195940849304 }),
        bare({ mean: 50.5, lower: 44.74349058306662, upper: 56.25650941693338 }),
        bare({ mean: 50.5, lower: 44.74349058306662, upper: 56.25650941693338 }),
      ],
    );
    assert.deepStrictEqual(
      [filled([7]).meanCI(), filled([7, 7]).meanCI(), createHistogram().meanCI()],
      [
        bare({ mean: 7, lower: NaN, upper: NaN }),
        bare({ mean: 7, lower: 7, upper: 7 }),
        bare({ mean: NaN, lower: NaN, upper: NaN }),
      ],
    );
  });

  test("percentileCI", () => {
    const h = filled(upTo(100));
    assert.deepStrictEqual(
      [
        h.percentileCI(50),
        h.percentileCI(99),
        h.percentileCI(50, { confidence: 0.5 }),
        filled([7]).percentileCI(50),
        createHistogram().percentileCI(50),
      ],
      [
        bare({ value: 50, lower: 40, upper: 61 }),
        bare({ value: 99, lower: 97, upper: 100 }),
        bare({ value: 50, lower: 47, upper: 54 }),
        bare({ value: 7, lower: 7, upper: 7 }),
        bare({ value: 0, lower: 0, upper: 0 }),
      ],
    );
  });

  // Node.js: the count is negative by then, and everything is 0.
  test("percentileCI of more values than an i64 holds", notInNode, () => {
    const h = filled([7]);
    for (let i = 0; i < 63; i++) h.add(h);
    assert.strictEqual(h.countBigInt, 2n ** 63n);
    assert.deepStrictEqual(h.percentileCI(50), bare({ value: 7, lower: 7, upper: 7 }));
  });

  test("percentilesAt", () => {
    const h = filled(upTo(100));
    const percentiles = [99, 50, 50, 100, 0.5];
    assert.deepStrictEqual(
      [...h.percentilesAt(percentiles)],
      [
        [0.5, 1],
        [50, 50],
        [99, 99],
        [100, 100],
      ],
    );
    assert.deepStrictEqual(percentiles, [99, 50, 50, 100, 0.5]);
    assert.deepStrictEqual(h.percentilesAt([]), new Map());

    const shrinks = [10, 20, 30, 40];
    Object.defineProperty(shrinks, 0, { get: () => ((shrinks.length = 2), 10) });
    assert.deepStrictEqual([...h.percentilesAt(shrinks).keys()], [10, 20]);
  });

  // Node.js: 1.
  test("percentilesAt of an empty histogram", notInNode, () => {
    assert.deepStrictEqual(
      [...createHistogram().percentilesAt([50, 100])],
      [
        [50, 0],
        [100, 0],
      ],
    );
  });
});

describe("two histograms", () => {
  const noDifference = {
    mannWhitney: bare({ uStatistic: 0, zScore: 0, pValue: 1 }),
    welch: bare({ tStatistic: 0, degreesOfFreedom: 0, pValue: 1, confidenceInterval: bare({ lower: 0, upper: 0 }) }),
  };

  test("ksTest, cohensD, cliffsD, mannWhitneyTest and welchTest", () => {
    const a = filled(upTo(100));
    const b = filled(upTo(100).map(value => value + 20));
    assertClose(
      [
        a.ksTest(b),
        a.cohensD(b),
        a.cliffsD(b),
        a.mannWhitneyTest(b),
        a.welchTest(b),
        a.welchTest(b, { confidence: 0.5 }),
      ],
      [
        0.20000000000000007,
        -0.6893819875457113,
        -0.36,
        bare({ uStatistic: 3200, zScore: -4.398231949063579, pValue: 0.000010913630849167422 }),
        bare({
          tStatistic: -4.874666782214325,
          degreesOfFreedom: 198,
          pValue: 0.000002230936493985425,
          confidenceInterval: bare({ lower: -28.090881145068074, upper: -11.909118854931927 }),
        }),
        bare({
          tStatistic: -4.874666782214325,
          degreesOfFreedom: 198,
          pValue: 0.000002230936493985425,
          confidenceInterval: bare({ lower: -22.772418598338152, upper: -17.227581401661848 }),
        }),
      ],
    );
    assertClose(
      [b.ksTest(a), b.cohensD(a), b.cliffsD(a), b.mannWhitneyTest(a).zScore, b.welchTest(a).tStatistic],
      [0.20000000000000007, 0.6893819875457113, 0.36, 4.398231949063579, 4.874666782214325],
    );
  });

  test("nothing in common", () => {
    const low = filled([1, 2, 3]);
    const high = filled([10, 20, 30]);
    assert.deepStrictEqual([low.ksTest(high), low.cliffsD(high), high.cliffsD(low)], [1, -1, 1]);
    assert.deepStrictEqual([low.mannWhitneyTest(high).uStatistic, high.mannWhitneyTest(low).uStatistic], [0, 9]);
  });

  test("with itself, with its clone and with an empty one", () => {
    const h = filled(upTo(100));
    for (const other of [h, structuredClone(h), createHistogram()]) {
      assert.deepStrictEqual(
        [h.ksTest(other), h.cohensD(other), h.cliffsD(other), h.mannWhitneyTest(other), h.welchTest(other)],
        [0, 0, 0, noDifference.mannWhitney, noDifference.welch],
      );
    }
  });

  test("any histogram is taken", () => {
    const h = filled([1, 2, 3]);
    const monitor = monitorEventLoopDelay();
    assert.deepStrictEqual([h.ksTest(monitor), h.ksTest(h.snapshot()), monitor.ksTest(h)], [0, 0, 0]);
  });

  // Node.js compares the first bucket of one with the first bucket of the other and so on, whatever values they are of.
  test("of another precision or range", notInNode, () => {
    const values = upTo(200).map(value => value * 1000);
    const fine = filled(values, { figures: 5 });
    for (const options of [{ figures: 1 }, { figures: 3 }, { lowest: 64, highest: 1e9 }]) {
      const coarse = filled(values, options);
      assert.ok(fine.ksTest(coarse) < 0.06, `ksTest ${fine.ksTest(coarse)}`);
      assert.ok(Math.abs(fine.cliffsD(coarse)) < 0.06, `cliffsD ${fine.cliffsD(coarse)}`);
      assert.ok(fine.mannWhitneyTest(coarse).pValue > 0.3, `pValue ${fine.mannWhitneyTest(coarse).pValue}`);
      const above = filled(
        values.map(value => value + 1e6),
        options,
      );
      assert.deepStrictEqual([fine.ksTest(above), fine.cliffsD(above)], [1, -1]);
    }
  });

  test("subtract", () => {
    const h = filled([1, 2, 2, 3, 2n ** 60n]);
    assert.strictEqual(h.subtract(filled([2, 3, 3, 4])), undefined);
    assert.deepStrictEqual(
      [h.count, h.min, h.max, h.exceeds, h.resetCount, h.countAt(2), h.countAt(3)],
      [2, 1, 2, 1, 1, 1, 0],
    );
    h.subtract(filled([2n ** 60n, 2n ** 60n]));
    assert.deepStrictEqual([h.count, h.exceeds, h.resetCount], [2, 0, 2]);
    h.subtract(h);
    assert.deepStrictEqual([h.count, h.min, h.max, h.resetCount], [0, 9223372036854776000, 0, 3]);
    h.record(5);
    assert.deepStrictEqual([h.count, h.min, h.max], [1, 5, 5]);
  });

  test("subtract its clone", () => {
    const h = filled([1, 2, 3]);
    h.subtract(structuredClone(h));
    assert.deepStrictEqual([h.count, h.resetCount], [0, 1]);
  });

  // Node.js subtracts the first bucket of one from the first bucket of the other and so on.
  test("subtract one of another precision", notInNode, () => {
    const h = filled([100_000, 200_000, 300_000]);
    h.subtract(filled([200_000], { figures: 1 }));
    assert.deepStrictEqual([h.count, h.countAt(100_000), h.countAt(300_000)], [3, 1, 1]);
    h.subtract(filled([200_000], { figures: 5 }));
    assert.deepStrictEqual([h.count, h.countAt(100_000), h.countAt(200_000), h.countAt(300_000)], [2, 1, 0, 1]);
  });
});

describe("buckets", () => {
  test("linearBuckets", () => {
    const h = filled([1, 5, 12, 30]);
    assert.deepStrictEqual(
      [h.linearBuckets(10), h.linearBuckets(7), createHistogram().linearBuckets(1), filled([3]).linearBuckets(100)].map(
        map => [...map],
      ),
      [
        [
          [10, 2],
          [20, 1],
          [30, 1],
        ],
        [
          [7, 2],
          [14, 1],
          [21, 0],
          [28, 0],
          [35, 1],
        ],
        [],
        [[100, 1]],
      ],
    );
  });

  test("logBuckets", () => {
    const h = filled([1, 5, 12, 30, 1000]);
    assert.deepStrictEqual(
      [h.logBuckets(1, 2), h.logBuckets(10, 10), createHistogram().logBuckets(1, 2)].map(map => [...map]),
      [
        [
          [1, 1],
          [2, 0],
          [4, 0],
          [8, 1],
          [16, 1],
          [32, 1],
          [64, 0],
          [128, 0],
          [256, 0],
          [512, 0],
          [1024, 1],
        ],
        [
          [10, 2],
          [100, 2],
          [1000, 1],
        ],
        [],
      ],
    );
  });

  const total = (map: Map<number, number>) => [...map.values()].reduce((sum, count) => sum + count, 0);

  // Node.js: the empty steps that end in the same bucket of the histogram replace the one that has its values.
  test("no value is lost where a step is narrower than a bucket of the histogram", notInNode, () => {
    const h = filled([1_000_000, 1_000_001, 5_000_000]);
    for (const map of [h.linearBuckets(100), h.logBuckets(1, 1.0001)]) {
      assert.strictEqual(total(map), 3);
      assert.deepStrictEqual(
        [...map].filter(([, count]) => count > 0),
        [
          [999936, 2],
          [4997120, 1],
        ],
      );
    }
  });

  // Node.js makes an entry for every step, and runs out of memory.
  test("small steps up to a large value", notInNode, () => {
    const h = filled([1, 2 ** 50]);
    for (const map of [h.linearBuckets(1), h.logBuckets(1, 1 + 2 ** -40)]) {
      assert.strictEqual(total(map), 2);
      assert.ok(map.size < 60_000, `${map.size} entries`);
    }
  });

  // Node.js rounds the base down, and with a base of 1 the second step is the last one.
  test("a base that is not an integer", notInNode, () => {
    assert.deepStrictEqual(
      [...filled([1, 2, 3, 5, 8]).logBuckets(1, 1.5)],
      [
        [1, 1],
        [2, 1],
        [3, 1],
        [5, 1],
        [7, 0],
        [11, 1],
      ],
    );
    assert.deepStrictEqual(
      [...filled([1, 10, 100]).logBuckets(2, 2.5)],
      [
        [2, 1],
        [5, 0],
        [12, 1],
        [31, 0],
        [78, 0],
        [195, 1],
      ],
    );
  });
});

describe("recordCorrected", () => {
  const values = (h: RecordableHistogram) =>
    [...h.linearBuckets(1)].filter(([, count]) => count).map(([value]) => value);

  test("fills in what was not measured", () => {
    assert.deepStrictEqual(
      (
        [
          [100, 25],
          [100, 100],
          [100, 30],
          [10n, 4n],
          [5, 100],
        ] as const
      ).map(([value, interval]) => {
        const h = createHistogram();
        assert.strictEqual(h.recordCorrected(value, interval), undefined);
        return values(h);
      }),
      [[25, 50, 75, 100], [100], [40, 70, 100], [6, 10], [5]],
    );
  });

  test("0, a value that does not fit, and the moving average", () => {
    const h = createHistogram({ highest: 50, halfLife: 1 });
    h.recordCorrected(0, 1);
    assert.deepStrictEqual([h.count, h.min, h.max, h.exceeds], [1, 0, 0, 0]);
    h.recordCorrected(100, 10);
    assert.deepStrictEqual([h.count, h.exceeds, h.ewmaMean], [1, 1, 0]);
    h.recordCorrected(40, 10);
    assert.deepStrictEqual([h.count, h.exceeds, h.ewmaMean], [5, 1, 20]);
  });

  // Node.js records them one at a time.
  test("a large value and a small interval", notInNode, () => {
    const h = createHistogram();
    h.recordCorrected(2 ** 50, 1);
    assert.deepStrictEqual([h.count, h.min, h.max], [2 ** 50, 1, 1126999418470399]);
    assert.ok(Math.abs(h.mean / 2 ** 49 - 1) < 1e-3, `${h.mean}`);
    h.recordCorrected(2 ** 50, 3);
    assert.strictEqual(h.count, 2 ** 50 + Math.floor(2 ** 50 / 3));
  });
});

describe("snapshot and diff", () => {
  test("a snapshot is a copy that cannot be recorded into", () => {
    const h = filled([1, 5, 2n ** 60n], { halfLife: 1, threshold: 2 });
    h.reset();
    for (const value of [1, 5, 2n ** 60n]) h.record(value);
    const snapshot = h.snapshot();
    const json = JSON.stringify(h);
    assert.strictEqual(snapshot.constructor.name, "Histogram");
    assert.strictEqual("record" in snapshot, false);
    h.record(100);
    h.reset();
    assert.strictEqual(JSON.stringify(snapshot), json);
    assert.deepStrictEqual([snapshot.exceeds, snapshot.resetCount, h.resetCount], [1, 1, 2]);
    snapshot.reset();
    assert.deepStrictEqual([snapshot.count, snapshot.resetCount, h.resetCount], [0, 2, 2]);
    assert.strictEqual(snapshot.snapshot().resetCount, 2);
  });

  test("of a monitor and of a clone", () => {
    using monitor = monitorEventLoopDelay();
    for (const h of [monitor, structuredClone(filled([3]))]) {
      assert.deepStrictEqual([h.snapshot().constructor.name, h.snapshot().count], ["Histogram", h.count]);
    }
  });

  test("diff is what was recorded since", () => {
    const h = filled([1, 5, 5], { halfLife: 1 });
    const earlier = h.snapshot();
    for (const value of [5, 7000, 2n ** 60n]) h.record(value);
    const diff = h.diff(earlier);
    assert.strictEqual(diff.constructor.name, "Histogram");
    assert.deepStrictEqual(
      [diff.count, diff.min, diff.max, diff.exceeds, diff.resetCount, diff.ewmaMean, diff.countAt(5), diff.countAt(1)],
      [2, 5, 7003, 1, 0, 0, 1, 0],
    );
    assert.deepStrictEqual([h.count, earlier.count], [5, 3]);
    for (const same of [h.diff(h), h.diff(h.snapshot()), h.diff(structuredClone(h))]) {
      assert.deepStrictEqual([same.count, same.min, same.max, same.exceeds], [0, 9223372036854776000, 0, 0]);
    }
  });

  test("diff of what is not an earlier copy", () => {
    const h = filled([1, 5]);
    const earlier = h.snapshot();
    h.record(9);
    const exceeded = h.snapshot();
    h.record(2n ** 60n);
    const later = h.snapshot();
    h.reset();
    assert.deepStrictEqual(
      [
        () => earlier.diff(later),
        () => exceeded.diff(later),
        () => h.diff(earlier),
        () => later.diff(filled([1], { figures: 2 })),
        () => later.diff(filled([1], { lowest: 2 })),
        () => later.diff(filled([1], { highest: 100 })),
      ].map(thrown),
      [
        "TypeError ERR_INVALID_ARG_VALUE: other contains values that are not in the histogram",
        "TypeError ERR_INVALID_ARG_VALUE: other contains values that are not in the histogram",
        "Error ERR_INVALID_STATE: Values were removed from the histogram after other was taken",
        "TypeError ERR_INVALID_ARG_VALUE: other must have the same configuration as the histogram",
        "TypeError ERR_INVALID_ARG_VALUE: other must have the same configuration as the histogram",
        "TypeError ERR_INVALID_ARG_VALUE: other must have the same configuration as the histogram",
      ],
    );
  });
});

describe("export and importHistogram", () => {
  test("the bytes are those of Node.js", () => {
    assert.deepStrictEqual(
      [
        createHistogram(),
        filled([0, 1, 5, 5, 2000]),
        filled([3, 20], { highest: 1000, figures: 2, halfLife: 1, threshold: 10 }),
      ].map(h => hex(h.export())),
      [
        "ab00020101021b001fffffffffffff03030400051b7fffffffffffffff0600070008fb3ff00000000000000919b0000a80",
        "ab00020101021b001fffffffffffff030304050501061907d0070008fb3ff00000000000000919b0000a880001010104021907cb01",
        "ac00020101021903e80302040205030614070008fb3ff0000000000000091902000a84030111010ba500fb3fe000000000000001fb402700000000000002fb405210000000000003fb3fe0000000000000040a",
      ],
    );
    const bytes = createHistogram().export();
    assert.strictEqual(Object.getPrototypeOf(bytes), Uint8Array.prototype);
    assert.strictEqual(bytes.byteLength, bytes.buffer.byteLength);
  });

  // Node.js writes the lowest and the highest value as they were recorded.
  test("the minimum and the maximum are the edges of their buckets", notInNode, () => {
    assert.strictEqual(
      hex(filled([123456789]).export()),
      "ab00020101021b001fffffffffffff03030401051a075b0000061a075bffff070008fb3ff00000000000000919b0000a8219475b01",
    );
  });

  test("what Node.js exported", () => {
    const h = fromHex(
      "ab00020101021b001fffffffffffff03030401051a075bcd15061a075bcd15070008fb3ff00000000000000919b0000a8219475b01",
    );
    assert.deepStrictEqual([h.count, h.min, h.max, h.mean], [1, 123404288, 123469823, 123437056]);
  });

  test("everything but exceeds and resetCount comes back, and it can be recorded into", () => {
    const values = upTo(500).map(value => value * value * 37);
    for (const options of [
      {},
      { figures: 1 },
      { figures: 5 },
      { lowest: 1000, highest: 1e9 },
      { halfLife: 3, threshold: 5000 },
    ]) {
      const h = filled(values, options);
      h.reset();
      for (const value of values) h.record(value);
      h.record(2n ** 62n);
      const imported = importHistogram(h.export());
      assert.strictEqual(imported.constructor.name, "RecordableHistogram");
      assert.deepStrictEqual({ ...imported.toJSON(), exceeds: h.exceeds }, h.toJSON());
      assert.deepStrictEqual([imported.exceeds, imported.resetCount], [0, 0]);
      assert.strictEqual(hex(imported.export()), hex(h.export()));
      for (const histogram of [h, imported]) histogram.record(12345);
      assert.deepStrictEqual({ ...imported.toJSON(), exceeds: h.exceeds }, h.toJSON());
    }
  });

  // Node.js exports such a threshold as a number that it does not import.
  test("a threshold above every value", notInNode, () => {
    for (const threshold of [Infinity, 2 ** 63, 1e300]) {
      const h = filled([5, 2 ** 52], { halfLife: 1, threshold });
      assert.deepStrictEqual([h.ewmaErrorRate, importHistogram(h.export()).ewmaErrorRate], [0, 0]);
    }
  });

  test("a view of a larger buffer, and bytes after the end", () => {
    const bytes = filled([7]).export();
    const larger = new Uint8Array(bytes.length + 20).fill(0xff);
    larger.set(bytes, 10);
    assert.strictEqual(importHistogram(larger.subarray(10, 10 + bytes.length)).min, 7);
    assert.strictEqual(importHistogram(larger.subarray(10)).min, 7);
    assert.strictEqual(importHistogram(Buffer.from(bytes)).min, 7);
  });

  test("what nothing reads comes back too", () => {
    const bytes = "ab00020101021b7fffffffffffffff03030400051b7fffffffffffffff0600070308fb40040000000000000919d8000a80";
    const h = fromHex(bytes);
    assert.deepStrictEqual(
      [h, h.snapshot(), h.diff(h.snapshot())].map(h => hex(h.export())),
      [bytes, bytes, bytes],
    );
    h.record(1);
    h.reset();
    assert.strictEqual(hex(h.export()), bytes);
  });

  test("fields that are absent, and keys that are not known", () => {
    // Only the length of the counts has no default that fits the others.
    assert.deepStrictEqual(fromHex("a1 09 19d800").toJSON(), createHistogram({ highest: 2n ** 63n - 1n }).toJSON());
    const counts = fromHex("a2 09 19d800 0a 84 05 02 03 01");
    assert.deepStrictEqual([counts.count, counts.min, counts.max], [3, 5, 8]);
    assert.strictEqual(fromHex("a3 00 02 09 19d800 18 64 82 01 a1 02 63 616263").count, 0);
  });

  test("bytes that are not a histogram", () => {
    const invalid = "TypeError ERR_INVALID_ARG_VALUE: Invalid histogram export data";
    const bytes = hex(filled([5, 15]).export());
    for (let length = 0; length < bytes.length; length += 2) {
      assert.strictEqual(
        thrown(() => fromHex(bytes.slice(0, length))),
        invalid,
        `the first ${length / 2} bytes`,
      );
    }
    for (const text of [
      "",
      "80",
      "a0",
      "bf ff",
      "a1 00 00",
      "a1 00 03",
      "a1 09 00",
      "a2 09 19d800 09 19d800",
      "a2 09 19d800 03 06",
      "a2 09 19d800 01 00",
      "a2 09 19d800 04 01",
      "a2 09 19d800 07 19d800",
      "a2 09 19d800 0c 01",
      "a3 00 01 09 19d800 0c 01",
      "a2 09 19d800 0a 81 00",
      "a2 09 19d800 0a 82 19d800 01",
      "a2 09 19d800 0a 84 05 01 00 01",
      "a2 09 19d800 0a 84 05 1b7fffffffffffffff 01 01",
      "a2 09 19d800 0a 82 05 1b8000000000000000",
      "a2 09 19d800 0a 9b 1000000000000000",
      "a2 09 19d800 0b a2 00 01 00 01",
      "a3 00 02 09 19d800 0c " + "81".repeat(18) + "00",
    ]) {
      assert.strictEqual(
        thrown(() => fromHex(text)),
        invalid,
        text,
      );
    }
  });

  // Node.js reports whatever the bytes say.
  test("the minimum and the maximum are those of the counts", notInNode, () => {
    const h = fromHex("a4 09 19d800 05 01 06 1903e8 0a 82 05 01");
    assert.deepStrictEqual([h.min, h.max], [5, 5]);
  });

  test("what is not a Uint8Array", () => {
    assert.deepStrictEqual(
      [undefined, "a0", [0xa0], new ArrayBuffer(1), new Uint16Array(1), new DataView(new ArrayBuffer(1))].map(data =>
        thrown(() => importHistogram(data as any)),
      ),
      [
        'TypeError ERR_INVALID_ARG_TYPE: The "data" argument must be an instance of Uint8Array. Received undefined',
        `TypeError ERR_INVALID_ARG_TYPE: The "data" argument must be an instance of Uint8Array. Received type string ('a0')`,
        'TypeError ERR_INVALID_ARG_TYPE: The "data" argument must be an instance of Uint8Array. Received an instance of Array',
        'TypeError ERR_INVALID_ARG_TYPE: The "data" argument must be an instance of Uint8Array. Received an instance of ArrayBuffer',
        'TypeError ERR_INVALID_ARG_TYPE: The "data" argument must be an instance of Uint8Array. Received an instance of Uint16Array',
        'TypeError ERR_INVALID_ARG_TYPE: The "data" argument must be an instance of Uint8Array. Received an instance of DataView',
      ],
    );
    assert.strictEqual(importHistogram.length, 1);
  });
});

describe("qrde", () => {
  const h = filled(upTo(50).map(value => value * 100));

  test("the quantiles and the densities between them", async () => {
    assertClose(
      await h.qrde({ bins: 4 }),
      bare({
        probabilities: new Float64Array([0, 0.25, 0.5, 0.75, 1]),
        quantiles: new Float64Array([100, 1300.0108272179175, 2550.9244793010366, 3801.209302004222, 5002]),
        densities: new Float64Array([
          0.00020833145362496045, 0.00019985392243795601, 0.00019995443874899326, 0.00020819614976804143,
        ]),
        count: 50n,
        bucketCount: 50,
        corrections: 0,
        dequantize: "hdr",
      }),
    );
    assertClose(
      await h.qrde({ probabilities: [0, 0.5, 0.99, 1], dequantize: "none", cache: true }),
      bare({
        probabilities: new Float64Array([0, 0.5, 0.99, 1]),
        quantiles: new Float64Array([100, 2550.9244793010366, 4979.915475476286, 5002]),
        densities: new Float64Array([0.0002040046538449817, 0.00020172985440109346, 0.0004528057640209586]),
        count: 50n,
        bucketCount: 50,
        corrections: 0,
        dequantize: "none",
      }),
    );
    for (const options of [undefined, {}]) {
      const { probabilities, quantiles, densities } = await h.qrde(options);
      assert.deepStrictEqual([probabilities.length, quantiles.length, densities.length], [101, 101, 100]);
      assert.deepStrictEqual([probabilities[1], probabilities[100]], [0.01, 1]);
    }
  });

  test("of no value, of one value and of one bucket", async () => {
    const results = await Promise.all([
      createHistogram().qrde({ bins: 2 }),
      filled([5]).qrde({ bins: 2 }),
      filled([5000, 5000, 5000]).qrde({ bins: 2 }),
      filled([5000, 5000, 5000]).qrde({ bins: 2, dequantize: "none" }),
      filled([5, 5, 5]).qrde({ bins: 2 }),
      filled([5, 5, 5]).qrde({ bins: 2, dequantize: "all" }),
    ]);
    assert.deepStrictEqual(
      results.map(({ quantiles, densities, count, bucketCount }) => [
        [...quantiles],
        [...densities],
        count,
        bucketCount,
      ]),
      [
        [[], [], 0n, 0],
        [[5, 5, 5], [Infinity, Infinity], 1n, 1],
        [[5000, 5002, 5004], [0.25, 0.25], 3n, 1],
        [[5002, 5002, 5002], [Infinity, Infinity], 3n, 1],
        [[5, 5, 5], [Infinity, Infinity], 3n, 1],
        [[4.5, 5, 5.5], [1, 1], 3n, 1],
      ],
    );
  });

  test("of the values at the time of the call", async () => {
    const h = filled([10, 20, 30]);
    const promise = h.qrde({ bins: 1 });
    assert.ok(promise instanceof Promise);
    h.record(1000);
    h.reset();
    const { quantiles, count } = await promise;
    assert.deepStrictEqual([[...quantiles], count], [[10, 30], 3n]);
  });

  test("many values, and many at once", async () => {
    const h = createHistogram();
    for (let i = 0, x = 1; i < 200_000; i++) h.record(1 + ((x = (x * 1103515245 + 12345) % 2147483648) % 1_000_000));
    const results = await Promise.all(upTo(8).map(bins => h.qrde({ bins: bins * 10 })));
    for (const { quantiles, densities, count } of results) {
      assert.strictEqual(count, 200_000n);
      for (let i = 1; i < quantiles.length; i++) assert.ok(quantiles[i] >= quantiles[i - 1]);
      // The values are spread evenly.
      for (const density of densities) assert.ok(Math.abs(density * 1e6 - 1) < 0.5, `${density}`);
    }
  });

  test("in a worker that exits before it is done", async () => {
    const worker = new Worker(
      `const h = require("node:perf_hooks").createHistogram();
      for (let i = 1; i < 50000; i++) h.record(i * 977);
      for (let i = 0; i < 20; i++) h.qrde({ bins: 1000 });
      process.exit(0);`,
      { eval: true },
    );
    const [code] = await once(worker, "exit");
    assert.strictEqual(code, 0);
  });

  test("options", () => {
    const h = createHistogram();
    assert.deepStrictEqual(
      [
        null,
        1,
        [],
        { bins: 0 },
        { bins: 1001 },
        { bins: 1.5 },
        { bins: "4" },
        { bins: 4, probabilities: [0, 1] },
        { probabilities: 1 },
        { probabilities: [0] },
        { probabilities: Array(1002).fill(0) },
        { probabilities: [0, "1"] },
        { probabilities: [0, 2] },
        { probabilities: [0, NaN, 1] },
        { probabilities: [0, 0.5, 0.5, 1] },
        { probabilities: [0.1, 1] },
        { probabilities: [0, 0.9] },
        { dequantize: "some" },
        { dequantize: 1 },
        { cache: 1 },
      ].map(options => thrown(() => h.qrde(options as any))),
      [
        'TypeError ERR_INVALID_ARG_TYPE: The "options" argument must be of type object. Received null',
        'TypeError ERR_INVALID_ARG_TYPE: The "options" argument must be of type object. Received type number (1)',
        'TypeError ERR_INVALID_ARG_TYPE: The "options" argument must be of type object. Received an instance of Array',
        'RangeError ERR_OUT_OF_RANGE: The value of "options.bins" is out of range. It must be >= 1 && <= 1000. Received 0',
        'RangeError ERR_OUT_OF_RANGE: The value of "options.bins" is out of range. It must be >= 1 && <= 1000. Received 1001',
        'RangeError ERR_OUT_OF_RANGE: The value of "options.bins" is out of range. It must be an integer. Received 1.5',
        `TypeError ERR_INVALID_ARG_TYPE: The "options.bins" property must be of type number. Received type string ('4')`,
        `TypeError ERR_INVALID_ARG_VALUE: The argument 'options' "bins" and "probabilities" are mutually exclusive. Received { bins: 4, probabilities: [ 0, 1 ] }`,
        'TypeError ERR_INVALID_ARG_TYPE: The "options.probabilities" property must be an instance of Array. Received type number (1)',
        "TypeError ERR_INVALID_ARG_VALUE: The property 'options.probabilities' must have a length of at least 2. Received [ 0 ]",
        'RangeError ERR_OUT_OF_RANGE: The value of "options.probabilities.length" is out of range. It must be >= 2 && <= 1001. Received 1002',
        `TypeError ERR_INVALID_ARG_TYPE: The "options.probabilities[1]" property must be of type number. Received type string ('1')`,
        'RangeError ERR_OUT_OF_RANGE: The value of "options.probabilities[1]" is out of range. It must be >= 0 && <= 1. Received 2',
        'RangeError ERR_OUT_OF_RANGE: The value of "options.probabilities[1]" is out of range. It must be >= 0 && <= 1. Received NaN',
        "TypeError ERR_INVALID_ARG_VALUE: The property 'options.probabilities' must be strictly increasing. Received [ 0, 0.5, 0.5, 1 ]",
        "TypeError ERR_INVALID_ARG_VALUE: The property 'options.probabilities' must start with 0 and end with 1. Received [ 0.1, 1 ]",
        "TypeError ERR_INVALID_ARG_VALUE: The property 'options.probabilities' must start with 0 and end with 1. Received [ 0, 0.9 ]",
        "TypeError ERR_INVALID_ARG_VALUE: The property 'options.dequantize' must be one of: 'none', 'hdr', 'all'. Received 'some'",
        "TypeError ERR_INVALID_ARG_VALUE: The property 'options.dequantize' must be one of: 'none', 'hdr', 'all'. Received 1",
        'TypeError ERR_INVALID_ARG_TYPE: The "options.cache" property must be of type boolean. Received type number (1)',
      ],
    );
  });
});

describe("createSlidingWindowHistogram", () => {
  test("the last chunks of so many records", () => {
    const window = createSlidingWindowHistogram({ chunks: 3, recordsPerChunk: 2 });
    assert.strictEqual(window.snapshot().count, 0);
    assert.deepStrictEqual(
      upTo(9).map(i => {
        assert.strictEqual(window.record(i * 10), undefined);
        const { count, min, max } = window.snapshot();
        return [count, min, max];
      }),
      [
        [1, 10, 10],
        [2, 10, 20],
        [3, 10, 30],
        [4, 10, 40],
        [5, 10, 50],
        [6, 10, 60],
        [5, 30, 70],
        [6, 30, 80],
        [5, 50, 90],
      ],
    );
    assert.strictEqual(window.reset(), undefined);
    assert.strictEqual(window.snapshot().count, 0);
    window.record(5n);
    window.record(0);
    assert.deepStrictEqual([window.snapshot().count, window.snapshot().min, window.snapshot().max], [2, 0, 5]);
  });

  test("a value that does not fit is a record too", () => {
    const window = createSlidingWindowHistogram({ chunks: 2, recordsPerChunk: 2, highest: 10 });
    assert.deepStrictEqual(
      [1, 100, 2, 200, 3, 300, 4].map(value => {
        window.record(value);
        return [window.snapshot().count, window.snapshot().exceeds];
      }),
      [
        [1, 0],
        [1, 1],
        [2, 1],
        [2, 2],
        [2, 1],
        [2, 2],
        [2, 1],
      ],
    );
  });

  test("the last chunks of so much time", () => {
    const window = createSlidingWindowHistogram({ chunks: 2, chunkDuration: 5 });
    const start = performance.now();
    window.record(1);
    assert.ok(window.snapshot().count === 1 || performance.now() - start >= 4.9);
    while (window.snapshot().count > 0) assert.ok(performance.now() - start < 10_000);
    // A value stays for at least one chunk less than there are.
    assert.ok(performance.now() - start >= 4.9, `gone after ${performance.now() - start} ms`);
    window.record(2);
    window.record(3);
    const { count, min } = window.snapshot();
    assert.ok(count === 0 || min >= 2);

    const long = createSlidingWindowHistogram({ chunks: 1024, chunkDuration: 18_446_744_073_709 });
    long.record(7);
    assert.strictEqual(long.snapshot().count, 1);
  });

  test("a snapshot is a histogram of its own, of the range and precision of the window", () => {
    const window = createSlidingWindowHistogram({
      chunks: 1,
      recordsPerChunk: 10,
      lowest: 8,
      highest: 1000n,
      figures: 1,
    });
    window.record(100);
    const snapshot = window.snapshot();
    window.record(500);
    assert.strictEqual(snapshot.constructor.name, "Histogram");
    assert.strictEqual("record" in snapshot, false);
    assert.deepStrictEqual([snapshot.count, snapshot.min, snapshot.max, snapshot.resetCount], [1, 96, 103, 0]);
    assert.strictEqual(snapshot.diff(createHistogram({ lowest: 8, highest: 1000, figures: 1 }).snapshot()).count, 1);
  });

  test("the class", () => {
    const window = createSlidingWindowHistogram({ chunks: 1, recordsPerChunk: 1 });
    const prototype = Object.getPrototypeOf(window);
    assert.strictEqual(Object.getPrototypeOf(prototype), Object.prototype);
    assert.deepStrictEqual(Object.getOwnPropertyNames(prototype).sort(), [
      "constructor",
      "record",
      "reset",
      "snapshot",
    ]);
    assert.deepStrictEqual(
      [prototype.constructor.name, prototype.record.length, prototype.reset.length, prototype.snapshot.length],
      ["SlidingWindowHistogram", 1, 0, 0],
    );
    assert.strictEqual(createSlidingWindowHistogram.length, 1);
    assert.strictEqual(
      thrown(() => new prototype.constructor()),
      "TypeError ERR_ILLEGAL_CONSTRUCTOR: Illegal constructor",
    );
    for (const method of ["record", "reset", "snapshot"]) {
      assert.strictEqual(
        thrown(() => prototype[method].call(createHistogram(), 1)),
        'TypeError ERR_INVALID_THIS: Value of "this" must be of type SlidingWindowHistogram',
      );
    }
    assert.throws(() => structuredClone(window), { name: "DataCloneError" });
  });

  test("arguments", () => {
    const records = { chunks: 1, recordsPerChunk: 1 };
    assert.deepStrictEqual(
      [
        undefined,
        null,
        {},
        { chunks: 0, recordsPerChunk: 1 },
        { chunks: 1025, recordsPerChunk: 1 },
        { chunks: 1.5, recordsPerChunk: 1 },
        { chunks: 1n, recordsPerChunk: 1 },
        { chunks: 1 },
        { chunks: 1, recordsPerChunk: 1, chunkDuration: 1 },
        { chunks: 1, recordsPerChunk: 0 },
        { chunks: 1, recordsPerChunk: 2 ** 53 },
        { chunks: 1, recordsPerChunk: 1n },
        { chunks: 1, chunkDuration: 0 },
        { chunks: 1, chunkDuration: 18_446_744_073_710 },
        { chunks: 1, chunkDuration: null },
        { ...records, lowest: 0 },
        { ...records, highest: 1 },
        { ...records, figures: 6 },
        { ...records, lowest: 2n ** 61n, highest: 2n ** 62n },
      ].map(options => thrown(() => createSlidingWindowHistogram(options as any))),
      [
        'TypeError ERR_INVALID_ARG_TYPE: The "options" argument must be of type object. Received undefined',
        'TypeError ERR_INVALID_ARG_TYPE: The "options" argument must be of type object. Received null',
        'TypeError ERR_INVALID_ARG_TYPE: The "options.chunks" property must be of type number. Received undefined',
        'RangeError ERR_OUT_OF_RANGE: The value of "options.chunks" is out of range. It must be >= 1 && <= 1024. Received 0',
        'RangeError ERR_OUT_OF_RANGE: The value of "options.chunks" is out of range. It must be >= 1 && <= 1024. Received 1025',
        'RangeError ERR_OUT_OF_RANGE: The value of "options.chunks" is out of range. It must be an integer. Received 1.5',
        'TypeError ERR_INVALID_ARG_TYPE: The "options.chunks" property must be of type number. Received type bigint (1n)',
        `TypeError ERR_INVALID_ARG_VALUE: The argument 'options' must specify exactly one of "chunkDuration" or "recordsPerChunk". Received { chunks: 1 }`,
        `TypeError ERR_INVALID_ARG_VALUE: The argument 'options' must specify exactly one of "chunkDuration" or "recordsPerChunk". Received { chunks: 1, recordsPerChunk: 1, chunkDuration: 1 }`,
        'RangeError ERR_OUT_OF_RANGE: The value of "options.recordsPerChunk" is out of range. It must be >= 1 && <= 9007199254740991. Received 0',
        'RangeError ERR_OUT_OF_RANGE: The value of "options.recordsPerChunk" is out of range. It must be >= 1 && <= 9007199254740991. Received 9_007_199_254_740_992',
        'TypeError ERR_INVALID_ARG_TYPE: The "options.recordsPerChunk" property must be of type number. Received type bigint (1n)',
        'RangeError ERR_OUT_OF_RANGE: The value of "options.chunkDuration" is out of range. It must be >= 1 && <= 18446744073709. Received 0',
        'RangeError ERR_OUT_OF_RANGE: The value of "options.chunkDuration" is out of range. It must be >= 1 && <= 18446744073709. Received 18_446_744_073_710',
        'TypeError ERR_INVALID_ARG_TYPE: The "options.chunkDuration" property must be of type number. Received null',
        'RangeError ERR_OUT_OF_RANGE: The value of "options.lowest" is out of range. It must be >= 1 && <= 9007199254740991. Received 0',
        'RangeError ERR_OUT_OF_RANGE: The value of "options.highest" is out of range. It must be >= 2 * options.lowest (2n). Received 1',
        'RangeError ERR_OUT_OF_RANGE: The value of "options.figures" is out of range. It must be >= 1 && <= 5. Received 6',
        "TypeError ERR_INVALID_ARG_VALUE: Invalid histogram options",
      ],
    );
    const window = createSlidingWindowHistogram(records);
    assert.deepStrictEqual(
      [undefined, "1", 1.5, -1, 2 ** 53, -1n, 2n ** 63n].map(value => thrown(() => window.record(value as any))),
      [
        'TypeError ERR_INVALID_ARG_TYPE: The "val" argument must be of type number. Received undefined',
        `TypeError ERR_INVALID_ARG_TYPE: The "val" argument must be of type number. Received type string ('1')`,
        'RangeError ERR_OUT_OF_RANGE: The value of "val" is out of range. It must be an integer. Received 1.5',
        'RangeError ERR_OUT_OF_RANGE: The value of "val" is out of range. It must be >= 0 && <= 9007199254740991. Received -1',
        'RangeError ERR_OUT_OF_RANGE: The value of "val" is out of range. It must be >= 0 && <= 9007199254740991. Received 9_007_199_254_740_992',
        "RangeError ERR_OUT_OF_RANGE: value is out of range",
        "RangeError ERR_OUT_OF_RANGE: value is out of range",
      ],
    );
    assert.strictEqual(window.snapshot().count, 0);
  });
});

describe("the options of monitorEventLoopDelay", () => {
  const turns = async (n: number) => {
    for (let i = 0; i < n; i++) await new Promise(resolve => setImmediate(resolve));
  };
  const layout = (h: { export(): Uint8Array }) => hex(h.export()).slice(0, 34);

  test("lowest, highest and figures", () => {
    assert.strictEqual(
      layout(monitorEventLoopDelay()),
      layout(createHistogram({ lowest: 1000, highest: 2n ** 63n - 1n })),
    );
    assert.strictEqual(
      layout(monitorEventLoopDelay({ samplePerIteration: true })),
      layout(createHistogram({ lowest: 1, highest: 2n ** 63n - 1n })),
    );
    const options = { lowest: 16n, highest: 1e12, figures: 2 };
    for (const samplePerIteration of [false, true]) {
      assert.strictEqual(
        layout(monitorEventLoopDelay({ ...options, samplePerIteration })),
        layout(createHistogram(options)),
      );
    }
  });

  test("a delay above highest exceeds", async ({ signal }) => {
    using h = monitorEventLoopDelay({ resolution: 1, lowest: 1, highest: 2 });
    h.enable();
    while (h.exceeds === 0 && !signal.aborted) await turns(1);
    assert.deepStrictEqual([h.count, h.exceeds > 0], [0, true]);
  });

  test("samplePerIteration takes a sample in every iteration of the event loop", async () => {
    using h = monitorEventLoopDelay({ samplePerIteration: true, resolution: 1e9 });
    await turns(5);
    assert.strictEqual(h.count, 0);
    assert.strictEqual(h.enable(), true);
    assert.strictEqual(h.enable(), false);
    await turns(20);
    const count = h.count;
    assert.ok(count >= 15 && count <= 60, `${count} samples in 20 iterations`);
    assert.ok(h.min >= 1);
    assert.strictEqual(h.disable(), true);
    assert.strictEqual(h.disable(), false);
    await turns(5);
    assert.strictEqual(h.count, count);
  });

  test("samplePerIteration measures how long an iteration is busy, and not how long it waits", async () => {
    using h = monitorEventLoopDelay({ samplePerIteration: true });
    h.enable();
    // The wait is what is tested: nothing tells JavaScript that the event loop is idle.
    await new Promise(resolve => setTimeout(resolve, 300));
    const idle = h.max;
    await turns(1);
    for (const start = performance.now(); performance.now() - start < 100;);
    await turns(2);
    assert.ok(h.max >= 95e6, `${h.max} ns after 100 ms of work`);
    assert.ok(idle < 250e6, `${idle} ns after a wait of 300 ms`);
  });

  test("samplePerIteration does not keep the process running", () => {
    const { status, stdout } = spawnSync(
      process.execPath,
      [
        "-e",
        `const h = require("node:perf_hooks").monitorEventLoopDelay({ samplePerIteration: true });
        h.enable();
        setTimeout(() => console.log(h.count > 0), 10);`,
      ],
      { encoding: "utf8", timeout: 30_000 },
    );
    assert.deepStrictEqual({ stdout, status }, { stdout: "true\n", status: 0 });
  });

  test("arguments", () => {
    assert.deepStrictEqual(
      [
        { samplePerIteration: 1 },
        { samplePerIteration: true, resolution: 0 },
        { lowest: 0 },
        { lowest: 10, highest: 19 },
        { highest: 2n ** 63n },
        { figures: 0 },
        { lowest: 2n ** 61n },
      ].map(options => thrown(() => monitorEventLoopDelay(options as any))),
      [
        'TypeError ERR_INVALID_ARG_TYPE: The "options.samplePerIteration" property must be of type boolean. Received type number (1)',
        'RangeError ERR_OUT_OF_RANGE: The value of "options.resolution" is out of range. It must be >= 1 && <= 9007199254740991. Received 0',
        'RangeError ERR_OUT_OF_RANGE: The value of "options.lowest" is out of range. It must be >= 1 && <= 9007199254740991. Received 0',
        'RangeError ERR_OUT_OF_RANGE: The value of "options.highest" is out of range. It must be >= 2 * options.lowest (20n). Received 19',
        'RangeError ERR_OUT_OF_RANGE: The value of "options.highest" is out of range. It must be >= 1n && <= 9223372036854775807n. Received 9_223_372_036_854_775_808n',
        'RangeError ERR_OUT_OF_RANGE: The value of "options.figures" is out of range. It must be >= 1 && <= 5. Received 0',
        "TypeError ERR_INVALID_ARG_VALUE: Invalid histogram options",
      ],
    );
  });
});

describe("arguments of the statistics", () => {
  const h = filled([1, 2, 3]);
  const type = (name: string, expected: string, received: string) =>
    `TypeError ERR_INVALID_ARG_TYPE: The "${name}" ${name.includes(".") ? "property" : "argument"} must be ${expected}. Received ${received}`;
  const range = (name: string, expected: string, received: string) =>
    `RangeError ERR_OUT_OF_RANGE: The value of "${name}" is out of range. It must be ${expected}. Received ${received}`;

  test("a number", () => {
    for (const [method, name] of [
      ["cdf", "value"],
      ["ccdf", "value"],
      ["countAt", "value"],
      ["burnRate", "sloTarget"],
      ["percentileCI", "percentile"],
      ["linearBuckets", "stepSize"],
      ["logBuckets", "firstBucket"],
    ]) {
      assert.deepStrictEqual(
        [undefined, null, "1", 1n, {}].map(value => thrown(() => h[method](value, 2))),
        [
          type(name, "of type number", "undefined"),
          type(name, "of type number", "null"),
          type(name, "of type number", "type string ('1')"),
          type(name, "of type number", "type bigint (1n)"),
          type(name, "of type number", "an instance of Object"),
        ],
        method,
      );
    }
    assert.strictEqual(
      thrown(() => h.logBuckets(1, "2" as any)),
      type("base", "of type number", "type string ('2')"),
    );
  });

  test("a range", () => {
    assert.deepStrictEqual(
      [
        () => h.burnRate(0),
        () => h.burnRate(1),
        () => h.burnRate(NaN),
        () => h.percentileCI(0),
        () => h.percentileCI(100.5),
        () => h.linearBuckets(0),
        () => h.linearBuckets(1.5),
        () => h.linearBuckets(2 ** 53),
        () => h.logBuckets(0, 2),
        () => h.logBuckets(1, 1),
        () => h.logBuckets(1, -Infinity),
        () => h.percentilesAt([50, 0]),
        () => h.percentilesAt([50, 101]),
        () => h.percentilesAt([NaN]),
      ].map(thrown),
      [
        range("sloTarget", "> 0 && < 1", "0"),
        range("sloTarget", "> 0 && < 1", "1"),
        range("sloTarget", "> 0 && < 1", "NaN"),
        range("percentile", "> 0 && <= 100", "0"),
        range("percentile", "> 0 && <= 100", "100.5"),
        range("stepSize", ">= 1 && <= 9007199254740991", "0"),
        range("stepSize", "an integer", "1.5"),
        range("stepSize", ">= 1 && <= 9007199254740991", "9_007_199_254_740_992"),
        range("firstBucket", ">= 1 && <= 9007199254740991", "0"),
        range("base", "> 1", "1"),
        range("base", "> 1", "-Infinity"),
        range("percentiles[1]", "> 0 && <= 100", "0"),
        range("percentiles[1]", "> 0 && <= 100", "101"),
        range("percentiles[0]", "> 0 && <= 100", "NaN"),
      ],
    );
  });

  // Node.js makes one bucket of everything.
  test("a base that is not a number", notInNode, () => {
    assert.strictEqual(
      thrown(() => h.logBuckets(1, NaN)),
      range("base", "> 1", "NaN"),
    );
  });

  test("percentilesAt", () => {
    assert.deepStrictEqual(
      [undefined, 50, "50", { length: 1, 0: 50 }, new Float64Array([50]), [50, "50"], [50n]].map(value =>
        thrown(() => h.percentilesAt(value as any)),
      ),
      [
        type("percentiles", "an instance of Array", "undefined"),
        type("percentiles", "an instance of Array", "type number (50)"),
        type("percentiles", "an instance of Array", "type string ('50')"),
        type("percentiles", "an instance of Array", "an instance of Object"),
        type("percentiles", "an instance of Array", "an instance of Float64Array"),
        type("percentiles[1]", "of type number", "type string ('50')"),
        type("percentiles[0]", "of type number", "type bigint (50n)"),
      ],
    );
  });

  test("the arguments are looked at in order", () => {
    assert.deepStrictEqual(
      [() => h.percentileCI(0, null as any), () => h.percentileCI(0, { confidence: "x" as any })].map(thrown),
      [range("percentile", "> 0 && <= 100", "0"), range("percentile", "> 0 && <= 100", "0")],
    );
  });

  test("confidence", () => {
    for (const call of [
      (options: any) => h.meanCI(options),
      (options: any) => h.percentileCI(50, options),
      (options: any) => h.welchTest(h, options),
    ]) {
      assert.deepStrictEqual(
        [
          null,
          1,
          "a",
          [],
          () => {},
          { confidence: null },
          { confidence: "0.5" },
          { confidence: 0 },
          { confidence: 1 },
          { confidence: NaN },
          { confidence: -0.5 },
        ].map(options => thrown(() => call(options))),
        [
          type("options", "of type object", "null"),
          type("options", "of type object", "type number (1)"),
          type("options", "of type object", "type string ('a')"),
          type("options", "of type object", "an instance of Array"),
          type("options", "of type object", "function "),
          type("options.confidence", "of type number", "null"),
          type("options.confidence", "of type number", "type string ('0.5')"),
          range("options.confidence", "> 0 && < 1", "0"),
          range("options.confidence", "> 0 && < 1", "1"),
          range("options.confidence", "> 0 && < 1", "NaN"),
          range("options.confidence", "> 0 && < 1", "-0.5"),
        ],
      );
    }
  });

  test("another histogram", () => {
    for (const method of ["ksTest", "welchTest", "mannWhitneyTest", "cohensD", "cliffsD", "diff"]) {
      assert.deepStrictEqual(
        [undefined, null, 1, {}, createSlidingWindowHistogram({ chunks: 1, recordsPerChunk: 1 })].map(other =>
          thrown(() => h[method](other)),
        ),
        [
          type("other", "an instance of Histogram", "undefined"),
          type("other", "an instance of Histogram", "null"),
          type("other", "an instance of Histogram", "type number (1)"),
          type("other", "an instance of Histogram", "an instance of Object"),
          type("other", "an instance of Histogram", "an instance of SlidingWindowHistogram"),
        ],
        method,
      );
    }
    assert.deepStrictEqual(
      [1, {}, h.snapshot(), monitorEventLoopDelay()].map(other => thrown(() => h.subtract(other as any))),
      [
        type("other", "an instance of RecordableHistogram", "type number (1)"),
        type("other", "an instance of RecordableHistogram", "an instance of Object"),
        type("other", "an instance of RecordableHistogram", "an instance of Histogram"),
        type("other", "an instance of RecordableHistogram", "an instance of ELDHistogram"),
      ],
    );
  });

  test("recordCorrected", () => {
    const h = createHistogram();
    assert.deepStrictEqual(
      (
        [
          [undefined, 1],
          ["1", 1],
          [-1, 1],
          [1.5, 1],
          [1, undefined],
          [1, 0],
          [1, 1.5],
          [1, 1n],
          [1n, 1],
          [1n, undefined],
          [-1n, 1n],
          [2n ** 63n, 1n],
          [1n, 0n],
          [1n, 2n ** 63n],
        ] as any[]
      ).map(([value, interval]) => thrown(() => h.recordCorrected(value, interval))),
      [
        type("val", "of type number", "undefined"),
        type("val", "of type number", "type string ('1')"),
        range("val", ">= 0 && <= 9007199254740991", "-1"),
        range("val", "an integer", "1.5"),
        type("expectedInterval", "of type number", "undefined"),
        range("expectedInterval", ">= 1 && <= 9007199254740991", "0"),
        range("expectedInterval", "an integer", "1.5"),
        type("expectedInterval", "of type number", "type bigint (1n)"),
        type("expectedInterval", "of type bigint", "type number (1)"),
        type("expectedInterval", "of type bigint", "undefined"),
        "RangeError ERR_OUT_OF_RANGE: value is out of range",
        "RangeError ERR_OUT_OF_RANGE: value is out of range",
        "RangeError ERR_OUT_OF_RANGE: expected_interval is out of range",
        "RangeError ERR_OUT_OF_RANGE: expected_interval is out of range",
      ],
    );
    assert.strictEqual(h.count, 0);
  });

  test("halfLife and threshold", () => {
    assert.deepStrictEqual(
      [{ halfLife: "1" }, { halfLife: -1 }, { halfLife: 1n }, { threshold: null }, { threshold: -0.5 }].map(options =>
        thrown(() => createHistogram(options as any)),
      ),
      [
        type("options.halfLife", "of type number", "type string ('1')"),
        range("options.halfLife", ">= 0", "-1"),
        type("options.halfLife", "of type number", "type bigint (1n)"),
        type("options.threshold", "of type number", "null"),
        range("options.threshold", ">= 0", "-0.5"),
      ],
    );
    for (const halfLife of [0, NaN, Infinity]) {
      const h = filled([5, 10], { halfLife });
      assert.strictEqual(h.ewmaMean, 0);
    }
  });
});
