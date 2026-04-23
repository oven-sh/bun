import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";

describe("Database.prototype.function()", () => {
  test("basic scalar function", () => {
    const db = new Database(":memory:");
    db.function("add2", (a: number, b: number) => a + b);

    const result = db.prepare("SELECT add2(12, 4) as val").get() as any;
    expect(result.val).toBe(16);
  });

  test("string concatenation", () => {
    const db = new Database(":memory:");
    db.function("concat", (a: string, b: string) => a + b);

    const result = db.prepare("SELECT concat('foo', 'bar') as val").get() as any;
    expect(result.val).toBe("foobar");
  });

  test("returns null for undefined", () => {
    const db = new Database(":memory:");
    db.function("void_fn", { varargs: true }, () => {});

    const result = db.prepare("SELECT void_fn() as val").get() as any;
    expect(result.val).toBeNull();
  });

  test("varargs function", () => {
    const db = new Database(":memory:");
    db.function("sum_all", { varargs: true }, (...args: number[]) => {
      return args.reduce((a, b) => a + b, 0);
    });

    expect((db.prepare("SELECT sum_all(1, 2, 3) as val").get() as any).val).toBe(6);
    expect((db.prepare("SELECT sum_all(10) as val").get() as any).val).toBe(10);
    expect((db.prepare("SELECT sum_all(1, 2, 3, 4, 5) as val").get() as any).val).toBe(15);
  });

  test("deterministic option", () => {
    const db = new Database(":memory:");
    db.function("double", { deterministic: true }, (x: number) => x * 2);

    const result = db.prepare("SELECT double(21) as val").get() as any;
    expect(result.val).toBe(42);
  });

  test("handles null arguments", () => {
    const db = new Database(":memory:");
    db.function("is_null", (x: any) => (x === null ? 1 : 0));

    expect((db.prepare("SELECT is_null(NULL) as val").get() as any).val).toBe(1);
    expect((db.prepare("SELECT is_null(42) as val").get() as any).val).toBe(0);
  });

  test("handles blob arguments and return", () => {
    const db = new Database(":memory:");
    db.function("reverse_blob", (x: Uint8Array) => {
      return new Uint8Array(x).reverse();
    });

    db.exec("CREATE TABLE blobs (data BLOB)");
    db.exec("INSERT INTO blobs VALUES (X'010203')");

    const result = db.prepare("SELECT reverse_blob(data) as val FROM blobs").get() as any;
    expect(result.val).toEqual(new Uint8Array([3, 2, 1]));
  });

  test("handles float return", () => {
    const db = new Database(":memory:");
    db.function("half", (x: number) => x / 2);

    const result = db.prepare("SELECT half(7) as val").get() as any;
    expect(result.val).toBe(3.5);
  });

  test("function error propagation", () => {
    const db = new Database(":memory:");
    db.function("throw_err", () => {
      throw new Error("custom error");
    });

    expect(() => db.prepare("SELECT throw_err() as val").get()).toThrow("custom error");
  });

  test("returns this for chaining", () => {
    const db = new Database(":memory:");
    const result = db.function("noop", () => null);
    expect(result).toBe(db);
  });

  test("overrides function with same name and arity", () => {
    const db = new Database(":memory:");
    db.function("myfn", (x: number) => x * 2);
    expect((db.prepare("SELECT myfn(5) as val").get() as any).val).toBe(10);

    db.function("myfn", (x: number) => x * 3);
    expect((db.prepare("SELECT myfn(5) as val").get() as any).val).toBe(15);
  });

  test("multiple functions with different arities", () => {
    const db = new Database(":memory:");
    db.function("myfn", (x: number) => x * 10);
    db.function("myfn", (x: number, y: number) => x + y);

    expect((db.prepare("SELECT myfn(5) as val").get() as any).val).toBe(50);
    expect((db.prepare("SELECT myfn(5, 3) as val").get() as any).val).toBe(8);
  });

  test("used in WHERE clause", () => {
    const db = new Database(":memory:");
    db.function("is_even", (x: number) => (x % 2 === 0 ? 1 : 0));

    db.exec("CREATE TABLE nums (val INTEGER)");
    db.exec("INSERT INTO nums VALUES (1), (2), (3), (4), (5), (6)");

    const results = db.prepare("SELECT val FROM nums WHERE is_even(val)").all() as any[];
    expect(results.map(r => r.val)).toEqual([2, 4, 6]);
  });

  test("validation errors", () => {
    const db = new Database(":memory:");

    expect(() => (db as any).function(123, () => {})).toThrow();
    expect(() => (db as any).function("test", "not a function")).toThrow();
    expect(() => (db as any).function("test", {}, "not a function")).toThrow();
  });

  test("safeIntegers option", () => {
    const db = new Database(":memory:");
    db.function("bigint_check", { safeIntegers: true }, (x: any) => {
      return typeof x === "bigint" ? 1 : 0;
    });

    db.exec("CREATE TABLE big (val INTEGER)");
    db.exec("INSERT INTO big VALUES (42)");

    const result = db.prepare("SELECT bigint_check(val) as val FROM big").get() as any;
    expect(result.val).toBe(1);
  });

  test("boolean return value", () => {
    const db = new Database(":memory:");
    db.function("is_positive", (x: number) => x > 0);

    // Booleans become 0/1 in SQLite
    expect((db.prepare("SELECT is_positive(5) as val").get() as any).val).toBe(1);
    expect((db.prepare("SELECT is_positive(-1) as val").get() as any).val).toBe(0);
  });

  test("bigint return value", () => {
    const db = new Database(":memory:");
    db.function("big_number", () => 9007199254740993n);

    const db2 = new Database(":memory:");
    db2.function("big_number", { safeIntegers: true }, () => 9007199254740993n);

    const result = db.prepare("SELECT big_number() as val").get() as any;
    // The bigint gets stored as int64, then retrieved as a number (may lose precision)
    expect(typeof result.val).toBe("number");
  });
});

describe("Database.prototype.aggregate()", () => {
  function makeDb() {
    const db = new Database(":memory:");
    db.exec("CREATE TABLE expenses (category TEXT, dollars REAL)");
    db.exec("INSERT INTO expenses VALUES ('food', 10), ('food', 20), ('rent', 50), ('food', 12)");
    return db;
  }

  test("basic sum aggregate", () => {
    const db = makeDb();
    db.aggregate("addAll", {
      start: 0,
      step: (total: number, nextValue: number) => total + nextValue,
    });

    const result = db.prepare("SELECT addAll(dollars) as val FROM expenses").get() as any;
    expect(result.val).toBe(92);
  });

  test("aggregate with result transformation", () => {
    const db = makeDb();
    db.aggregate("getAverage", {
      start: () => [] as number[],
      step: (array: number[], nextValue: number) => {
        array.push(nextValue);
      },
      result: (array: number[]) => array.reduce((a, b) => a + b, 0) / array.length,
    });

    const result = db.prepare("SELECT getAverage(dollars) as val FROM expenses").get() as any;
    expect(result.val).toBe(23);
  });

  test("aggregate with GROUP BY", () => {
    const db = makeDb();
    db.aggregate("addAll", {
      start: 0,
      step: (total: number, nextValue: number) => total + nextValue,
    });

    const results = db
      .prepare("SELECT category, addAll(dollars) as total FROM expenses GROUP BY category ORDER BY category")
      .all() as any[];
    expect(results).toEqual([
      { category: "food", total: 42 },
      { category: "rent", total: 50 },
    ]);
  });

  test("aggregate with no rows", () => {
    const db = new Database(":memory:");
    db.exec("CREATE TABLE empty (val REAL)");
    db.aggregate("addAll", {
      start: 0,
      step: (total: number, nextValue: number) => total + nextValue,
    });

    const result = db.prepare("SELECT addAll(val) as val FROM empty").get() as any;
    expect(result.val).toBe(0);
  });

  test("aggregate with no rows and result function", () => {
    const db = new Database(":memory:");
    db.exec("CREATE TABLE empty (val REAL)");
    db.aggregate("custom_agg", {
      start: 0,
      step: (total: number, nextValue: number) => total + nextValue,
      result: (total: number) => total * 100,
    });

    const result = db.prepare("SELECT custom_agg(val) as val FROM empty").get() as any;
    expect(result.val).toBe(0);
  });

  test("aggregate with start as function", () => {
    const db = makeDb();
    let startCallCount = 0;
    db.aggregate("collect", {
      start: () => {
        startCallCount++;
        return [] as number[];
      },
      step: (arr: number[], val: number) => {
        arr.push(val);
      },
      result: (arr: number[]) => arr.join(","),
    });

    db.prepare("SELECT category, collect(dollars) as vals FROM expenses GROUP BY category ORDER BY category").all();
    // start should be called once per group
    expect(startCallCount).toBe(2);
  });

  test("step returning undefined doesn't replace accumulator", () => {
    const db = makeDb();
    db.aggregate("collect", {
      start: () => [] as number[],
      step: (arr: number[], val: number) => {
        arr.push(val);
        // returning undefined means "don't replace" - array was mutated in place
      },
      result: (arr: number[]) => arr.length,
    });

    const result = db.prepare("SELECT collect(dollars) as val FROM expenses").get() as any;
    expect(result.val).toBe(4);
  });

  test("aggregate with deterministic flag", () => {
    const db = makeDb();
    db.aggregate("det_sum", {
      start: 0,
      step: (total: number, next: number) => total + next,
      deterministic: true,
    });

    const result = db.prepare("SELECT det_sum(dollars) as val FROM expenses").get() as any;
    expect(result.val).toBe(92);
  });

  test("aggregate error in step propagation", () => {
    const db = makeDb();
    db.aggregate("bad_agg", {
      start: 0,
      step: (_total: number, _next: number) => {
        throw new Error("step error");
      },
    });

    expect(() => db.prepare("SELECT bad_agg(dollars) as val FROM expenses").get()).toThrow("step error");
  });

  test("aggregate error in result propagation", () => {
    const db = makeDb();
    db.aggregate("bad_result", {
      start: 0,
      step: (total: number, next: number) => total + next,
      result: () => {
        throw new Error("result error");
      },
    });

    expect(() => db.prepare("SELECT bad_result(dollars) as val FROM expenses").get()).toThrow("result error");
  });

  test("aggregate returns this for chaining", () => {
    const db = new Database(":memory:");
    const result = db.aggregate("noop", {
      start: 0,
      step: (total: number) => total,
    });
    expect(result).toBe(db);
  });

  test("aggregate validation errors", () => {
    const db = new Database(":memory:");

    expect(() => (db as any).aggregate(123, {})).toThrow();
    expect(() => db.aggregate("test", {} as any)).toThrow();
    expect(() => db.aggregate("test", { step: "not a function" } as any)).toThrow();
    expect(() => (db as any).aggregate("test", null)).toThrow();
  });

  test("aggregate with safeIntegers", () => {
    const db = new Database(":memory:");
    db.exec("CREATE TABLE nums (val INTEGER)");
    db.exec("INSERT INTO nums VALUES (1), (2), (3)");

    db.aggregate("bigint_sum", {
      start: 0n,
      step: (total: bigint, next: bigint) => total + next,
      safeIntegers: true,
    });

    const result = db.prepare("SELECT bigint_sum(val) as val FROM nums").get() as any;
    expect(result.val).toBe(6);
  });

  test("window function with inverse", () => {
    const db = new Database(":memory:");
    db.exec("CREATE TABLE t (x INTEGER)");
    db.exec("INSERT INTO t VALUES (1), (2), (3), (4), (5)");

    db.aggregate("win_sum", {
      start: 0,
      step: (total: number, next: number) => total + next,
      inverse: (total: number, dropped: number) => total - dropped,
    });

    const results = db
      .prepare("SELECT x, win_sum(x) OVER (ORDER BY x ROWS BETWEEN 1 PRECEDING AND 1 FOLLOWING) as val FROM t")
      .all() as any[];

    expect(results).toEqual([
      { x: 1, val: 3 }, // 1+2
      { x: 2, val: 6 }, // 1+2+3
      { x: 3, val: 9 }, // 2+3+4
      { x: 4, val: 12 }, // 3+4+5
      { x: 5, val: 9 }, // 4+5
    ]);
  });

  test("window function with inverse and result", () => {
    const db = new Database(":memory:");
    db.exec("CREATE TABLE t (x INTEGER)");
    db.exec("INSERT INTO t VALUES (1), (2), (3), (4), (5)");

    db.aggregate("win_avg", {
      start: () => ({ sum: 0, count: 0 }),
      step: (acc: { sum: number; count: number }, next: number) => ({
        sum: acc.sum + next,
        count: acc.count + 1,
      }),
      inverse: (acc: { sum: number; count: number }, dropped: number) => ({
        sum: acc.sum - dropped,
        count: acc.count - 1,
      }),
      result: (acc: { sum: number; count: number }) => (acc.count > 0 ? acc.sum / acc.count : 0),
    });

    const results = db
      .prepare("SELECT x, win_avg(x) OVER (ORDER BY x ROWS BETWEEN 1 PRECEDING AND 1 FOLLOWING) as val FROM t")
      .all() as any[];

    expect(results).toEqual([
      { x: 1, val: 1.5 }, // avg(1,2)
      { x: 2, val: 2 }, // avg(1,2,3)
      { x: 3, val: 3 }, // avg(2,3,4)
      { x: 4, val: 4 }, // avg(3,4,5)
      { x: 5, val: 4.5 }, // avg(4,5)
    ]);
  });

  test("varargs aggregate", () => {
    const db = new Database(":memory:");
    db.exec("CREATE TABLE t (a INTEGER, b INTEGER)");
    db.exec("INSERT INTO t VALUES (1, 10), (2, 20), (3, 30)");

    db.aggregate("sum_product", {
      start: 0,
      step: (total: number, a: number, b: number) => total + a * b,
      varargs: true,
    });

    const result = db.prepare("SELECT sum_product(a, b) as val FROM t").get() as any;
    expect(result.val).toBe(140); // 1*10 + 2*20 + 3*30
  });
});
