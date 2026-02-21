import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";

describe("SQLite User Defined Functions (UDF)", () => {
  describe("Basic Scalar Functions", () => {
    test("function - simple addition function", () => {
      const db = new Database(":memory:");
      db.function("my_add", (a, b) => a + b);

      const result = db.query("SELECT my_add(2, 3) as sum").get();
      expect(result).toEqual({ sum: 5 });
    });

    test("function - string manipulation", () => {
      const db = new Database(":memory:");
      db.function("reverse", str => {
        return String(str).split("").reverse().join("");
      });

      const result = db.query("SELECT reverse('hello') as reversed").get();
      expect(result).toEqual({ reversed: "olleh" });
    });

    test("function - multiple arguments", () => {
      const db = new Database(":memory:");
      db.function("concat3", (a, b, c) => {
        return String(a) + String(b) + String(c);
      });

      const result = db.query("SELECT concat3('foo', 'bar', 'baz') as result").get();
      expect(result).toEqual({ result: "foobarbaz" });
    });

    test("function - no arguments", () => {
      const db = new Database(":memory:");
      let callCount = 0;
      db.function("counter", () => ++callCount);

      db.query("SELECT counter() as c1").get();
      db.query("SELECT counter() as c2").get();

      expect(callCount).toBe(2);
    });

    test("function - variable arguments", () => {
      const db = new Database(":memory:");
      db.function("concat_all", { varargs: true }, (...args) => {
        return args.join(",");
      });

      expect(db.query("SELECT concat_all(1, 2, 3) as result").get()).toEqual({
        result: "1,2,3",
      });

      expect(db.query("SELECT concat_all('a', 'b') as result").get()).toEqual({
        result: "a,b",
      });

      expect(db.query("SELECT concat_all(1) as result").get()).toEqual({
        result: "1",
      });
    });
  });

  describe("Type Conversions", () => {
    test("NULL handling - input", () => {
      const db = new Database(":memory:");
      db.function("identity", val => val);

      const result = db.query("SELECT identity(NULL) as result").get();
      expect(result).toEqual({ result: null });
    });

    test("NULL handling - output", () => {
      const db = new Database(":memory:");
      db.function("return_null", () => null);

      const result = db.query("SELECT return_null() as result").get();
      expect(result).toEqual({ result: null });
    });

    test("undefined handling - output", () => {
      const db = new Database(":memory:");
      db.function("return_undefined", () => undefined);

      const result = db.query("SELECT return_undefined() as result").get();
      expect(result).toEqual({ result: null });
    });

    test("number types - integers", () => {
      const db = new Database(":memory:");
      db.function("double", x => x * 2);

      expect(db.query("SELECT double(21) as result").get()).toEqual({ result: 42 });
      expect(db.query("SELECT double(-5) as result").get()).toEqual({ result: -10 });
      expect(db.query("SELECT double(0) as result").get()).toEqual({ result: 0 });
    });

    test("number types - floats", () => {
      const db = new Database(":memory:");
      db.function("identity", x => x);

      const result = db.query("SELECT identity(3.14) as result").get();
      expect(result.result).toBeCloseTo(3.14);
    });

    test("number types - return float", () => {
      const db = new Database(":memory:");
      db.function("divide", (a, b) => a / b);

      const result = db.query("SELECT divide(10, 3) as result").get();
      expect(result.result).toBeCloseTo(3.333333333);
    });

    test("string types", () => {
      const db = new Database(":memory:");
      db.function("identity", x => x);

      expect(db.query("SELECT identity('test') as result").get()).toEqual({
        result: "test",
      });

      expect(db.query("SELECT identity('') as result").get()).toEqual({
        result: "",
      });

      // Unicode strings
      expect(db.query("SELECT identity('你好世界') as result").get()).toEqual({
        result: "你好世界",
      });
    });

    test("boolean types", () => {
      const db = new Database(":memory:");
      db.function("return_true", () => true);
      db.function("return_false", () => false);

      expect(db.query("SELECT return_true() as result").get()).toEqual({
        result: 1,
      });

      expect(db.query("SELECT return_false() as result").get()).toEqual({
        result: 0,
      });
    });

    test("blob/Uint8Array types", () => {
      const db = new Database(":memory:");
      db.run("CREATE TABLE test (data BLOB)");

      const blob = new Uint8Array([1, 2, 3, 4, 5]);
      db.run("INSERT INTO test VALUES (?)", [blob]);

      db.function("blob_length", b => {
        expect(b).toBeInstanceOf(Uint8Array);
        return b.length;
      });

      const result = db.query("SELECT blob_length(data) as len FROM test").get();
      expect(result).toEqual({ len: 5 });
    });

    test("blob/Uint8Array return value", () => {
      const db = new Database(":memory:");
      db.function("create_blob", () => {
        return new Uint8Array([10, 20, 30]);
      });

      db.run("CREATE TABLE test (data BLOB)");
      db.run("INSERT INTO test SELECT create_blob()");

      const result = db.query("SELECT data FROM test").get() as { data: Uint8Array };
      expect(result.data).toBeInstanceOf(Uint8Array);
      expect(Array.from(result.data)).toEqual([10, 20, 30]);
    });
  });

  describe("Options - argument count (auto-detected from fn.length)", () => {
    test("fixed argument count", () => {
      const db = new Database(":memory:");
      db.function("add2", (a, b) => a + b);

      expect(db.query("SELECT add2(1, 2) as result").get()).toEqual({
        result: 3,
      });
    });

    test("wrong number of arguments should error", () => {
      const db = new Database(":memory:");
      db.function("fixed2", (a, b) => a + b);

      // Too few arguments
      expect(() => db.query("SELECT fixed2(1) as result").get()).toThrow();

      // Too many arguments
      expect(() => db.query("SELECT fixed2(1, 2, 3) as result").get()).toThrow();
    });

    test("zero arguments", () => {
      const db = new Database(":memory:");
      db.function("get_constant", () => 42);

      expect(db.query("SELECT get_constant() as result").get()).toEqual({
        result: 42,
      });
    });
  });

  describe("Options - deterministic", () => {
    test("deterministic flag", () => {
      const db = new Database(":memory:");
      let callCount = 0;

      db.function("counter_det", { deterministic: true }, () => ++callCount);

      // Should work, but SQLite may optimize based on deterministic flag
      db.query("SELECT counter_det() as result").get();
      expect(callCount).toBeGreaterThan(0);
    });

    test("non-deterministic function", () => {
      const db = new Database(":memory:");
      db.function("random_value", { deterministic: false }, () => {
        return Math.random();
      });

      const r1 = db.query("SELECT random_value() as result").get();
      const r2 = db.query("SELECT random_value() as result").get();

      // Results should be different (usually, though not guaranteed)
      expect(typeof r1.result).toBe("number");
      expect(typeof r2.result).toBe("number");
    });
  });

  describe("Options - useBigIntArguments", () => {
    test("useBigIntArguments with BigInt", () => {
      const db = new Database(":memory:", { safeIntegers: true });

      db.function("big_add", { useBigIntArguments: true }, (a, b) => {
        expect(typeof a).toBe("bigint");
        expect(typeof b).toBe("bigint");
        return a + b;
      });

      const result = db.query("SELECT big_add(10, 20) as result").get();
      expect(result).toEqual({ result: 30n });
    });

    test("useBigIntArguments handles large numbers", () => {
      const db = new Database(":memory:", { safeIntegers: true });

      db.function("identity_big", { useBigIntArguments: true }, x => {
        return x;
      });

      const big = BigInt(Number.MAX_SAFE_INTEGER) + 10n;
      const result = db.query("SELECT identity_big(?) as result").get(big);

      expect(result.result).toBe(big);
    });

    test("useBigIntArguments return BigInt", () => {
      const db = new Database(":memory:", { safeIntegers: true });

      db.function("return_big", { useBigIntArguments: true }, () => {
        return 9007199254740993n; // MAX_SAFE_INTEGER + 2
      });

      const result = db.query("SELECT return_big() as result").get();
      expect(result.result).toBe(9007199254740993n);
    });
  });

  describe("Error Handling", () => {
    test("JavaScript errors propagate to SQL", () => {
      const db = new Database(":memory:");

      db.function("thrower", () => {
        throw new Error("Test error from UDF");
      });

      expect(() => db.query("SELECT thrower()").get()).toThrow("Test error from UDF");
    });

    test("validation errors - missing arguments", () => {
      const db = new Database(":memory:");

      expect(() => {
        // @ts-expect-error - testing error case
        db.function();
      }).toThrow();

      expect(() => {
        // @ts-expect-error - testing error case
        db.function("test");
      }).toThrow();
    });

    test("validation errors - invalid name type", () => {
      const db = new Database(":memory:");

      expect(() => {
        // @ts-expect-error - testing error case
        db.function(123, () => {});
      }).toThrow();
    });

    test("validation errors - invalid callback type", () => {
      const db = new Database(":memory:");

      expect(() => {
        // @ts-expect-error - testing error case
        db.function("test", "not a function");
      }).toThrow();

      expect(() => {
        // @ts-expect-error - testing error case
        db.function("test", {}, "not a function");
      }).toThrow();
    });

    test("closed database", () => {
      const db = new Database(":memory:");
      db.close();

      expect(() => db.function("test", () => {})).toThrow();
    });

    test("error during type conversion", () => {
      const db = new Database(":memory:");

      // Functions that return objects should be converted to strings
      db.function("return_object", () => {
        return { foo: "bar" };
      });

      const result = db.query("SELECT return_object() as result").get();
      expect(result.result).toBe("[object Object]");
    });
  });

  describe("Real-World Use Cases", () => {
    test("JSON manipulation", () => {
      const db = new Database(":memory:");

      db.function("json_upper_keys", jsonStr => {
        const obj = JSON.parse(jsonStr);
        const result: Record<string, any> = {};
        for (const [key, value] of Object.entries(obj)) {
          result[key.toUpperCase()] = value;
        }
        return JSON.stringify(result);
      });

      const input = JSON.stringify({ name: "test", age: 30 });
      const result = db.query("SELECT json_upper_keys(?) as result").get(input);

      expect(JSON.parse(result.result as string)).toEqual({
        NAME: "test",
        AGE: 30,
      });
    });

    test("string utilities", () => {
      const db = new Database(":memory:");

      db.function("str_count", (haystack, needle) => {
        return String(haystack).split(String(needle)).length - 1;
      });

      expect(db.query("SELECT str_count('hello world', 'l') as result").get()).toEqual({
        result: 3,
      });
    });

    test("math functions", () => {
      const db = new Database(":memory:");

      db.function("power", (base, exp) => {
        return Math.pow(base, exp);
      });

      expect(db.query("SELECT power(2, 10) as result").get()).toEqual({
        result: 1024,
      });
    });

    test("custom aggregation workaround", () => {
      const db = new Database(":memory:");
      db.run("CREATE TABLE nums (value INTEGER)");
      db.run("INSERT INTO nums VALUES (1), (2), (3), (4), (5)");

      // While this doesn't support aggregate functions yet,
      // we can use scalar functions with subqueries
      db.function("double", x => x * 2);

      const results = db.query("SELECT double(value) as doubled FROM nums").all();
      expect(results).toEqual([{ doubled: 2 }, { doubled: 4 }, { doubled: 6 }, { doubled: 8 }, { doubled: 10 }]);
    });

    test("UUID validation", () => {
      const db = new Database(":memory:");

      db.function("is_valid_uuid", str => {
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        return uuidRegex.test(String(str)) ? 1 : 0;
      });

      expect(db.query("SELECT is_valid_uuid('550e8400-e29b-41d4-a716-446655440000') as result").get()).toEqual({
        result: 1,
      });

      expect(db.query("SELECT is_valid_uuid('not-a-uuid') as result").get()).toEqual({
        result: 0,
      });
    });
  });

  describe("Multiple Functions", () => {
    test("register multiple functions", () => {
      const db = new Database(":memory:");

      db.function("my_add", (a, b) => a + b);
      db.function("my_multiply", (a, b) => a * b);
      db.function("my_subtract", (a, b) => a - b);

      expect(db.query("SELECT my_add(2, 3) as result").get()).toEqual({ result: 5 });
      expect(db.query("SELECT my_multiply(4, 5) as result").get()).toEqual({ result: 20 });
      expect(db.query("SELECT my_subtract(10, 3) as result").get()).toEqual({ result: 7 });
    });

    test("functions can call each other in SQL", () => {
      const db = new Database(":memory:");

      db.function("my_add", (a, b) => a + b);
      db.function("my_multiply", (a, b) => a * b);

      const result = db.query("SELECT my_multiply(my_add(2, 3), 4) as result").get();
      expect(result).toEqual({ result: 20 }); // (2 + 3) * 4 = 20
    });

    test("override function", () => {
      const db = new Database(":memory:");

      db.function("test", () => "first");
      expect(db.query("SELECT test() as result").get()).toEqual({ result: "first" });

      // Register again with same name
      db.function("test", () => "second");
      expect(db.query("SELECT test() as result").get()).toEqual({ result: "second" });
    });
  });

  describe("Memory and Performance", () => {
    test("function with many calls", () => {
      const db = new Database(":memory:");

      db.function("double", x => x * 2);
      db.run("CREATE TABLE nums (n INTEGER)");

      const stmt = db.prepare("INSERT INTO nums VALUES (?)");
      for (let i = 0; i < 100; i++) {
        stmt.run(i);
      }

      const results = db.query("SELECT double(n) as doubled FROM nums").all();
      expect(results.length).toBe(100);
      expect(results[0]).toEqual({ doubled: 0 });
      expect(results[99]).toEqual({ doubled: 198 });
    });

    test("function cleanup on database close", () => {
      const db = new Database(":memory:");

      db.function("test", () => "result");
      db.query("SELECT test()").get();

      // Should not crash or leak when database is closed
      db.close();
      expect(() => db.query("SELECT test()").get()).toThrow();
    });

    test("closure captures variables", () => {
      const db = new Database(":memory:");
      let externalValue = 10;

      db.function("get_external", () => externalValue);

      expect(db.query("SELECT get_external() as result").get()).toEqual({
        result: 10,
      });

      externalValue = 20;

      expect(db.query("SELECT get_external() as result").get()).toEqual({
        result: 20,
      });
    });
  });

  describe("Edge Cases", () => {
    test("very long strings", () => {
      const db = new Database(":memory:");

      db.function("identity", x => x);

      const longString = Buffer.alloc(10000, "A").toString();
      const result = db.query("SELECT identity(?) as result").get(longString);

      expect(result.result).toBe(longString);
    });

    test("empty string", () => {
      const db = new Database(":memory:");

      db.function("identity", x => x);

      expect(db.query("SELECT identity('') as result").get()).toEqual({
        result: "",
      });
    });

    test("special characters in function name", () => {
      const db = new Database(":memory:");

      // Underscores should work
      db.function("my_func_123", () => 42);
      expect(db.query("SELECT my_func_123() as result").get()).toEqual({
        result: 42,
      });
    });

    test("BigInt too large for int64", () => {
      const db = new Database(":memory:");

      db.function("return_huge", () => {
        return BigInt("9223372036854775808"); // MAX_INT64 + 1
      });

      // Should return as text since it doesn't fit in INT64
      const result = db.query("SELECT return_huge() as result").get();
      expect(typeof result.result).toBe("string");
    });

    test("mixed argument types", () => {
      const db = new Database(":memory:");

      db.function("describe_types", (a, b, c) => {
        return `${typeof a},${typeof b},${typeof c}`;
      });

      const result = db.query("SELECT describe_types(42, 'hello', 3.14) as result").get();

      expect(result.result).toBe("number,string,number");
    });
  });
});
