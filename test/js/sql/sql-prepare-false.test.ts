import { SQL } from "bun";
import { expect, test } from "bun:test";
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

  // https://github.com/oven-sh/bun/issues/30221
  // On the unnamed one-shot path Bind is written before ParameterDescription
  // arrives, so the parameter OID is unknown and object values used to be
  // serialized as the literal string "[object Object]".
  const obj = { a: 1, b: [null, true], c: "hi" };

  test("object param is JSON for a jsonb column", async () => {
    await using db = new SQL(options);
    const [{ v }] = await db`SELECT ${obj}::jsonb AS v`;
    expect(v).toEqual(obj);
  });

  test("object param is JSON for a json column", async () => {
    await using db = new SQL(options);
    const [{ v }] = await db`SELECT ${obj}::json AS v`;
    expect(v).toEqual(obj);
  });

  test("object param is JSON text for a text column, not [object Object]", async () => {
    await using db = new SQL(options);
    const [{ v }] = await db`SELECT ${obj}::text AS v`;
    expect(v).toBe(JSON.stringify(obj));
  });

  test("array param is JSON for a jsonb column", async () => {
    await using db = new SQL(options);
    const arr = [1, "two", { three: 3 }];
    const [{ v }] = await db`SELECT ${arr}::jsonb AS v`;
    expect(v).toEqual(arr);
  });

  // The prepared path declares OID 25 (text) for a `::text` slot, which is not
  // a binary type, so an object there also used to become "[object Object]".
  test("object param is JSON text for a text column with prepare: true", async () => {
    await using db = new SQL({ ...options, prepare: true });
    const [{ v }] = await db`SELECT ${obj}::text AS v`;
    expect(v).toBe(JSON.stringify(obj));
  });

  // Guard: sql.array nested inside an UPDATE helper reaches native as its
  // pre-serialized string, not the SQLArrayParameter wrapper object, so the
  // JSON path above never applies to it.
  test("sql.array inside an UPDATE helper still binds as an array literal", async () => {
    await using db = new SQL(options);
    const t = "prepare_false_arr_" + Date.now();
    await db`CREATE TEMPORARY TABLE ${db(t)} (id SERIAL PRIMARY KEY, name VARCHAR NOT NULL, roles TEXT[])`;
    const [{ id }] =
      await db`INSERT INTO ${db(t)} (name, roles) VALUES (${"a"}, ${db.array(["a", "b"], "TEXT")}) RETURNING *`;
    const [{ roles }] =
      await db`UPDATE ${db(t)} SET ${db({ name: "b", roles: db.array(["c", "d"], "TEXT") })} WHERE id = ${id} RETURNING *`;
    expect(roles).toEqual(["c", "d"]);
  });
});
