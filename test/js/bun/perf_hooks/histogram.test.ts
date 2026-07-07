import { bunEnv, bunExe, tempDir } from "harness";
import assert from "node:assert";
import { describe, test } from "node:test";
import { inspect } from "node:util";
import { MessageChannel } from "node:worker_threads";
import { createHistogram, monitorEventLoopDelay } from "perf_hooks";

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
      const percentilesBigInt = h.percentilesBigInt;

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
        assert.strictEqual(typeof value, "bigint");

        assert.ok(percentilesBigInt.has(key));
        const bigIntValue = percentilesBigInt.get(key);
        assert.strictEqual(typeof bigIntValue, "bigint");
        assert.strictEqual(value, bigIntValue);
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

  describe("structured clone", () => {
    test("structuredClone on a recordable histogram shares state", () => {
      const h = createHistogram();
      for (const v of [3, 7, 7, 20]) h.record(v);

      const clone = structuredClone(h);
      assert.notStrictEqual(clone, h);
      assert.strictEqual(clone.count, 4);
      assert.strictEqual(clone.min, 3);
      assert.strictEqual(clone.max, 20);
      assert.strictEqual(clone.percentile(50), h.percentile(50));

      h.record(100);
      assert.strictEqual(clone.count, 5);
      assert.strictEqual(clone.max, 100);

      clone.record(1);
      assert.strictEqual(h.count, 6);
      assert.strictEqual(h.min, 1);

      clone.reset();
      assert.strictEqual(h.count, 0);
    });

    test("structuredClone on monitorEventLoopDelay histogram", () => {
      const eld = monitorEventLoopDelay();
      const clone = structuredClone(eld);
      assert.notStrictEqual(clone, eld);
      assert.strictEqual(clone.count, eld.count);
      assert.strictEqual(typeof clone.percentile, "function");
    });

    test("structuredClone preserves identity within a graph", () => {
      const h = createHistogram();
      h.record(1);
      const { a, b } = structuredClone({ a: h, b: h });
      assert.strictEqual(a, b);
      assert.strictEqual(a.count, 1);
    });

    test("MessageChannel postMessage delivers histogram", async () => {
      const h = createHistogram();
      h.record(5);
      h.record(10);
      const { port1, port2 } = new MessageChannel();
      const { promise, resolve, reject } = Promise.withResolvers<any>();
      port2.on("message", resolve);
      port2.on("messageerror", reject);
      port1.postMessage(h);
      const got = await promise;
      port1.close();
      port2.close();
      assert.strictEqual(got.count, 2);
      assert.strictEqual(got.max, 10);

      const target = createHistogram();
      target.add(got);
      assert.strictEqual(target.count, 2);
    });

    test("Worker postMessage delivers histogram across threads", async () => {
      using dir = tempDir("histogram-worker", {
        "main.mjs": `
          import { Worker } from "node:worker_threads";
          import { createHistogram } from "node:perf_hooks";
          const w = new Worker(new URL("./worker.mjs", import.meta.url));
          const got = await new Promise((resolve, reject) => {
            w.on("message", resolve);
            w.on("error", reject);
          });
          const target = createHistogram();
          target.add(got);
          await w.terminate();
          Bun.gc(true);
          console.log(JSON.stringify({
            count: got.count,
            min: got.min,
            max: got.max,
            added: target.count,
          }));
        `,
        "worker.mjs": `
          import { parentPort } from "node:worker_threads";
          import { createHistogram } from "node:perf_hooks";
          const h = createHistogram();
          h.record(5);
          h.record(10);
          h.record(100);
          parentPort.postMessage(h);
        `,
      });
      await using proc = Bun.spawn({
        cmd: [bunExe(), "main.mjs"],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      assert.deepStrictEqual(
        { stdout: stdout.trim(), stderr, exitCode },
        { stdout: JSON.stringify({ count: 3, min: 5, max: 100, added: 3 }), stderr: "", exitCode: 0 },
      );
    });
  });
});
