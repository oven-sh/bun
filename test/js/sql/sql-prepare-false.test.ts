import { SQL } from "bun";
import { describe, expect, test } from "bun:test";
import { describeWithContainer } from "harness";

// Tests for `prepare: false` (unnamed prepared statements).
// These verify that parameterized queries work correctly when using unnamed
// prepared statements, which is critical for PgBouncer compatibility.

describeWithContainer("PostgreSQL prepare: false", { image: "postgres_plain" }, container => {
  const options = () =>
    ({
      db: "bun_sql_test",
      username: "bun_sql_test",
      host: container.host,
      port: container.port,
      max: 1,
      prepare: false,
    }) as const;

  test("basic parameterized query", async () => {
    await container.ready;
    await using db = new SQL(options());
    const [{ x }] = await db`SELECT ${42}::int AS x`;
    expect(x).toBe(42);
  });

  test("multiple parameterized queries sequentially", async () => {
    await container.ready;
    await using db = new SQL(options());

    const [{ a }] = await db`SELECT ${1}::int AS a`;
    expect(a).toBe(1);

    const [{ b }] = await db`SELECT ${"hello"}::text AS b`;
    expect(b).toBe("hello");

    const [{ c }] = await db`SELECT ${3.14}::float8 AS c`;
    expect(c).toBeCloseTo(3.14);
  });

  test("same query repeated with different params", async () => {
    await container.ready;
    await using db = new SQL(options());
    for (let i = 0; i < 10; i++) {
      const [{ x }] = await db`SELECT ${i}::int AS x`;
      expect(x).toBe(i);
    }
  });

  test("concurrent queries with different tables return correct results", async () => {
    // This test simulates the scenario where concurrent unnamed prepared
    // statements could interfere with each other via PgBouncer.
    await container.ready;
    await using db = new SQL({ ...options(), max: 4 });

    // Create real tables (not temp, so they're visible across connections)
    await db`CREATE TABLE IF NOT EXISTS prepare_false_test_a (id int, val text)`;
    await db`CREATE TABLE IF NOT EXISTS prepare_false_test_b (id int, val text)`;
    await db`DELETE FROM prepare_false_test_a`;
    await db`DELETE FROM prepare_false_test_b`;
    await db`INSERT INTO prepare_false_test_a VALUES (1, 'from_a')`;
    await db`INSERT INTO prepare_false_test_b VALUES (1, 'from_b')`;

    // Run concurrent parameterized queries against different tables
    const results = await Promise.all([
      db`SELECT val FROM prepare_false_test_a WHERE id = ${1}`,
      db`SELECT val FROM prepare_false_test_b WHERE id = ${1}`,
      db`SELECT val FROM prepare_false_test_a WHERE id = ${1}`,
      db`SELECT val FROM prepare_false_test_b WHERE id = ${1}`,
    ]);

    expect(results[0][0].val).toBe("from_a");
    expect(results[1][0].val).toBe("from_b");
    expect(results[2][0].val).toBe("from_a");
    expect(results[3][0].val).toBe("from_b");

    // Cleanup
    await db`DROP TABLE IF EXISTS prepare_false_test_a`;
    await db`DROP TABLE IF EXISTS prepare_false_test_b`;
  });

  test("parameterized query with multiple params", async () => {
    await container.ready;
    await using db = new SQL(options());
    const [{ sum }] = await db`SELECT (${10}::int + ${20}::int) AS sum`;
    expect(sum).toBe(30);
  });

  test("query without params still works", async () => {
    await container.ready;
    await using db = new SQL(options());
    const [{ x }] = await db`SELECT 1 AS x`;
    expect(x).toBe(1);
  });

  test("transactions with parameterized queries", async () => {
    await container.ready;
    await using db = new SQL(options());

    await db`CREATE TEMP TABLE IF NOT EXISTS tx_test (id int, val text)`;

    await db.begin(async tx => {
      await tx`INSERT INTO tx_test VALUES (${1}, ${"hello"})`;
      await tx`INSERT INTO tx_test VALUES (${2}, ${"world"})`;
    });

    const rows = await db`SELECT * FROM tx_test ORDER BY id`;
    expect(rows.length).toBe(2);
    expect(rows[0].val).toBe("hello");
    expect(rows[1].val).toBe("world");
  });

  test("concurrent parameterized queries with high concurrency", async () => {
    await container.ready;
    await using db = new SQL({ ...options(), max: 8 });

    // Fire many concurrent queries to stress-test unnamed statement handling
    const promises = [];
    for (let i = 0; i < 50; i++) {
      promises.push(db`SELECT ${i}::int AS x`.then(r => ({ expected: i, actual: r[0].x })));
    }

    const results = await Promise.all(promises);
    for (const { expected, actual } of results) {
      expect(actual).toBe(expected);
    }
  });

  // https://github.com/oven-sh/bun/issues/39450
  // https://github.com/oven-sh/bun/issues/30221
  // With unnamed statements Bind is written before the server has described the
  // parameter types, so every non-numeric parameter is bound with an unknown
  // type (OID 0) and used to go out as toString() output: a Date.prototype.toString()
  // string the server rejects for timestamps, and "[object Object]". Dates now go
  // out as ISO-8601 and arrays and plain objects as JSON. Objects that define their
  // own toString() keep binding as that string.
  describe("Date and object parameters", () => {
    const date = new Date("2026-08-17T13:06:14.904Z");
    const obj = { a: 1, b: [null, true], c: "hi" };

    test("Date param binds to timestamptz and timestamp", async () => {
      await container.ready;
      await using db = new SQL(options());
      const [row] = await db`SELECT ${date}::timestamptz AS tz, ${date}::timestamp AS naive`;
      expect(row).toEqual({ tz: date, naive: date });
    });

    test("invalid Date is rejected by the server", async () => {
      await container.ready;
      await using db = new SQL(options());
      const err = await db`SELECT ${new Date(NaN)}::timestamptz AS ts`.catch(e => e);
      expect(err.message).toBe('invalid input syntax for type timestamp with time zone: "Invalid Date"');
    });

    test("object param binds to jsonb and json", async () => {
      await container.ready;
      await using db = new SQL(options());
      const [row] = await db`SELECT ${obj}::jsonb AS jb, ${obj}::json AS j`;
      expect(row).toEqual({ jb: obj, j: obj });
    });

    test("array param binds to jsonb", async () => {
      await container.ready;
      await using db = new SQL(options());
      const arr = [1, "two", { three: 3 }];
      const [{ v }] = await db`SELECT ${arr}::jsonb AS v`;
      expect(v).toEqual(arr);
    });

    test("instance of a class without toString() binds as JSON", async () => {
      await container.ready;
      await using db = new SQL(options());
      class Payload {
        constructor(public a = 1) {}
      }
      const [{ v }] = await db`SELECT ${new Payload()}::jsonb AS v`;
      expect(v).toEqual({ a: 1 });
    });

    test("object with its own toString() still binds as that string", async () => {
      await container.ready;
      await using db = new SQL(options());
      class Point {
        toString() {
          return "(1,2)";
        }
      }
      class Decimal {
        toString() {
          return "1.50";
        }
        toJSON() {
          return "1.50";
        }
      }
      const [row] = await db`SELECT ${new Point()}::point AS p, ${new Decimal()}::numeric AS n`;
      expect(row).toEqual({ p: "(1,2)", n: "1.50" });
    });

    test("prepare: true still binds objects by the server-reported type", async () => {
      await container.ready;
      await using db = new SQL({ ...options(), prepare: true });
      class Point {
        toString() {
          return "(1,2)";
        }
      }
      const [row] = await db`SELECT ${obj}::jsonb AS j, ${obj}::text AS t, ${new Point()}::point AS p`;
      expect(row).toEqual({ j: obj, t: "[object Object]", p: "(1,2)" });
    });

    test("Date and object params via sql.unsafe into typed columns", async () => {
      await container.ready;
      await using db = new SQL(options());
      await db.unsafe(`CREATE TEMP TABLE prepare_false_unsafe (ts timestamptz, j jsonb)`);
      await db.unsafe(`INSERT INTO prepare_false_unsafe (ts, j) VALUES ($1, $2)`, [date, obj]);
      expect(await db.unsafe(`SELECT ts, j FROM prepare_false_unsafe`)).toEqual([{ ts: date, j: obj }]);
    });

    test("Date and object params via the INSERT helper into typed columns", async () => {
      await container.ready;
      await using db = new SQL(options());
      await db`CREATE TEMP TABLE prepare_false_helper (ts timestamptz, j jsonb)`;
      await db`INSERT INTO prepare_false_helper ${db({ ts: date, j: obj })}`;
      expect(await db`SELECT ts, j FROM prepare_false_helper`).toEqual([{ ts: date, j: obj }]);
    });

    test("string params are still bound verbatim", async () => {
      await container.ready;
      await using db = new SQL(options());
      const literal = JSON.stringify(obj);
      const [row] =
        await db`SELECT ${literal}::text AS t, ${literal}::jsonb AS j, ${date.toISOString()}::timestamptz AS ts`;
      expect(row).toEqual({ t: literal, j: obj, ts: date });
    });
  });

  // The helpers and sql.unsafe hand the sql.array() wrapper itself to native (only the
  // tagged-template path unwraps it). It defines toString(), so it must keep binding as
  // the array literal instead of being JSON-encoded like a plain object.
  describe("sql.array()", () => {
    test("inside an UPDATE helper still binds as an array literal", async () => {
      await container.ready;
      await using db = new SQL(options());
      await db`CREATE TEMP TABLE prepare_false_arr (id SERIAL PRIMARY KEY, name TEXT NOT NULL, roles TEXT[])`;
      const [{ id }] =
        await db`INSERT INTO prepare_false_arr (name, roles) VALUES (${"a"}, ${db.array(["a", "b"], "TEXT")}) RETURNING id`;
      const [row] =
        await db`UPDATE prepare_false_arr SET ${db({ name: "b", roles: db.array(["c", "d"], "TEXT") })} WHERE id = ${id} RETURNING name, roles`;
      expect(row).toEqual({ name: "b", roles: ["c", "d"] });
    });

    test("passed to sql.unsafe still binds as an array literal", async () => {
      await container.ready;
      await using db = new SQL(options());
      const param = db.array(["a", "b"], "TEXT");
      const args = [param];
      const [{ v }] = await db.unsafe("SELECT $1::TEXT[] AS v", args);
      expect(v).toEqual(["a", "b"]);
      expect(args[0]).toBe(param);
    });
  });
});
