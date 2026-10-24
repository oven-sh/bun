import assert from "node:assert";
import { spawnSync } from "node:child_process";
import { describe, test } from "node:test";
import { inspect } from "node:util";
import { serialize } from "node:v8";
import { MessageChannel, Worker } from "node:worker_threads";
import { createHistogram, monitorEventLoopDelay } from "perf_hooks";

// This file also runs under Node.js (`node --test`), which is where the expected values come from.
// Node.js v26.3.0 fails the tests that are marked with this.
const notInNode = { skip: typeof Bun === "undefined" && "a bug in Node.js" };

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

    test("percentiles map properties", notInNode, () => {
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
        percentiles: { 0: 10, 50: 20, 75: 30, 100: 30 },
      });
      assert.strictEqual(
        JSON.stringify(h),
        '{"count":3,"min":10,"max":30,"mean":20,"exceeds":0,"stddev":8.16496580927726,"percentiles":{"0":10,"50":20,"75":30,"100":30}}',
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
      "Histogram {\n  min: 1,\n  max: 1,\n  mean: 1,\n  exceeds: 0,\n  stddev: 0,\n  count: 1,\n  percentiles: Map(2) { 0 => 1, 100 => 1 }\n}",
    );
    assert.strictEqual(inspect(h, { depth: -1 }), "[RecordableHistogram]");
    assert.strictEqual(inspect({ h }, { depth: 0 }), "{ h: [RecordableHistogram] }");
    assert.strictEqual(inspect(monitorEventLoopDelay(), { depth: -1 }), "[ELDHistogram]");
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

    test("each read is a new Map", notInNode, () => {
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

  test("the mean of large values does not overflow", notInNode, () => {
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
        0,
        -1,
        2 ** 53,
        0n,
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
          'RangeError ERR_OUT_OF_RANGE: The value of "val" is out of range. It must be >= 1 && <= 9007199254740991. Received 0',
          'RangeError ERR_OUT_OF_RANGE: The value of "val" is out of range. It must be >= 1 && <= 9007199254740991. Received -1',
          'RangeError ERR_OUT_OF_RANGE: The value of "val" is out of range. It must be >= 1 && <= 9007199254740991. Received 9_007_199_254_740_992',
          "RangeError ERR_OUT_OF_RANGE: value is out of range",
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
          'RangeError ERR_OUT_OF_RANGE: The value of "options.highest" is out of range. It must be >= 2 && <= 9007199254740991. Received 1',
          'RangeError ERR_OUT_OF_RANGE: The value of "options.highest" is out of range. It must be an integer. Received 1.5',
          'RangeError ERR_OUT_OF_RANGE: The value of "options.highest" is out of range. It must be an integer. Received Infinity',
          'RangeError ERR_OUT_OF_RANGE: The value of "options.highest" is out of range. It must be an integer. Received NaN',
          'RangeError ERR_OUT_OF_RANGE: The value of "options.highest" is out of range. It must be >= 2 && <= 9007199254740991. Received 9_007_199_254_740_992',
          'RangeError ERR_OUT_OF_RANGE: The value of "options.highest" is out of range. It must be >= 9007199254740992 && <= 9007199254740991. Received 9_007_199_254_740_991',
          'RangeError ERR_OUT_OF_RANGE: The value of "options.highest" is out of range. It must be >= 20 && <= 9007199254740991. Received 19',
          'RangeError ERR_OUT_OF_RANGE: The value of "options.figures" is out of range. It must be an integer. Received 2.5',
          'RangeError ERR_OUT_OF_RANGE: The value of "options.figures" is out of range. It must be >= 1 && <= 5. Received 0',
          'RangeError ERR_OUT_OF_RANGE: The value of "options.figures" is out of range. It must be >= 1 && <= 5. Received 6',
          'TypeError ERR_INVALID_ARG_TYPE: The "options.figures" property must be of type number. Received type bigint (3n)',
          `TypeError ERR_INVALID_ARG_TYPE: The "options.figures" property must be of type number. Received type string ('3')`,
        ],
      );
      assert.strictEqual(
        thrown(() => createHistogram({ lowest: 10n, highest: 19n })),
        "RangeError ERR_INVALID_ARG_VALUE: The property 'options.highest' is invalid. Received 19n",
      );
      assert.strictEqual(createHistogram(undefined).count, 0);
      assert.strictEqual(createHistogram({ lowest: 1n, highest: 2n ** 63n - 1n }).count, 0);
      assert.strictEqual(createHistogram.length, 0);
      assert.strictEqual(monitorEventLoopDelay.length, 0);
    });

    test("createHistogram with a number and a BigInt", notInNode, () => {
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

    // Node.js truncates a BigInt to 64 bits, aborts if what is left is not a valid range, and cannot compare a BigInt
    // with a number.
    test("createHistogram with a BigInt that is out of range", notInNode, () => {
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
          'RangeError ERR_OUT_OF_RANGE: The value of "options.highest" is out of range. It must be <= 9223372036854775807n. Received 9_223_372_036_854_775_808n',
          'RangeError ERR_OUT_OF_RANGE: The value of "options.highest" is out of range. It must be <= 9223372036854775807n. Received 18_446_744_073_709_551_626n',
          'RangeError ERR_OUT_OF_RANGE: The value of "options.highest" is out of range. It must be >= 20 && <= 9007199254740991. Received 19',
          "RangeError ERR_INVALID_ARG_VALUE: The property 'options.highest' is invalid. Received 19n",
          "TypeError ERR_INVALID_ARG_VALUE: The property 'options.lowest' is too large for 3 significant figures. Received 2305843009213693952n",
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
      // Node.js reads a property of it first, which is a TypeError with no code.
      const noReceiver = notInNode.skip ? [] : [undefined];

      for (const receiver of [{}, undefined, 1, Base, Recordable]) {
        for (const key of Reflect.ownKeys(Base)) {
          const { get, value } = Object.getOwnPropertyDescriptor(Base, key)!;
          if (key === "constructor" || key === "toJSON" || typeof key === "symbol") continue;
          assert.strictEqual(
            thrown(() => (get ?? value).call(receiver, "not looked at")),
            'TypeError ERR_INVALID_THIS: Value of "this" must be of type Histogram',
            String(key),
          );
        }
      }
      for (const receiver of [{}, interval, Recordable, ...noReceiver]) {
        for (const key of ["record", "recordDelta", "add"]) {
          assert.strictEqual(
            thrown(() => Recordable[key].call(receiver, "not looked at")),
            'TypeError ERR_INVALID_THIS: Value of "this" must be of type RecordableHistogram',
          );
        }
      }
      for (const receiver of [{}, recordable, Interval, ...noReceiver]) {
        for (const key of ["enable", "disable"]) {
          assert.strictEqual(
            thrown(() => Interval[key].call(receiver)),
            'TypeError ERR_INVALID_THIS: Value of "this" must be of type ELDHistogram',
          );
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
        .filter(key => !String(key).includes("messaging_"))
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
      assert.deepStrictEqual(members(Recordable), ["RecordableHistogram/0", "add/1", "record/1", "recordDelta/0"]);
      assert.deepStrictEqual(members(Base), [
        "Histogram/0",
        "[nodejs.util.inspect.custom]/2",
        "get count",
        "get countBigInt",
        "get exceeds",
        "get exceedsBigInt",
        "get max",
        "get maxBigInt",
        "get mean",
        "get min",
        "get minBigInt",
        "get percentiles",
        "get percentilesBigInt",
        "get stddev",
        "percentile/1",
        "percentileBigInt/1",
        "reset/0",
        "toJSON/0",
      ]);
      assert.strictEqual(Object.prototype.toString.call(h), "[object Object]");
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
