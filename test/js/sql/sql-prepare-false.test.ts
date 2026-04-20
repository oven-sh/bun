import { SQL } from "bun";
import { afterAll, describe, expect, test } from "bun:test";
import * as dockerCompose from "../../docker/index.ts";

// Tests for `prepare: false` (unnamed prepared statements).
// These verify that parameterized queries work correctly when using unnamed
// prepared statements, which is critical for PgBouncer compatibility.

describe("PostgreSQL prepare: false", async () => {
  let container: { port: number; host: string };

  try {
    const info = await dockerCompose.ensure("postgres_plain");
    container = { port: info.ports[5432], host: info.host };
  } catch (e) {
    test.skip(`Docker not available: ${e}`);
    return;
  }

  const options = {
    db: "bun_sql_test",
    username: "bun_sql_test",
    host: container.host,
    port: container.port,
    max: 1,
    prepare: false,
  };

  afterAll(async () => {
    if (!process.env.BUN_KEEP_DOCKER) {
      await dockerCompose.down();
    }
  });

  test("basic parameterized query", async () => {
    await using db = new SQL(options);
    const [{ x }] = await db`SELECT ${42}::int AS x`;
    expect(x).toBe(42);
  });

  test("multiple parameterized queries sequentially", async () => {
    await using db = new SQL(options);

    const [{ a }] = await db`SELECT ${1}::int AS a`;
    expect(a).toBe(1);

    const [{ b }] = await db`SELECT ${"hello"}::text AS b`;
    expect(b).toBe("hello");

    const [{ c }] = await db`SELECT ${3.14}::float8 AS c`;
    expect(c).toBeCloseTo(3.14);
  });

  test("same query repeated with different params", async () => {
    await using db = new SQL(options);
    for (let i = 0; i < 10; i++) {
      const [{ x }] = await db`SELECT ${i}::int AS x`;
      expect(x).toBe(i);
    }
  });

  test("concurrent queries with different tables return correct results", async () => {
    // This test simulates the scenario where concurrent unnamed prepared
    // statements could interfere with each other via PgBouncer.
    await using db = new SQL({ ...options, max: 4 });

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
    await using db = new SQL(options);
    const [{ sum }] = await db`SELECT (${10}::int + ${20}::int) AS sum`;
    expect(sum).toBe(30);
  });

  test("query without params still works", async () => {
    await using db = new SQL(options);
    const [{ x }] = await db`SELECT 1 AS x`;
    expect(x).toBe(1);
  });

  test("transactions with parameterized queries", async () => {
    await using db = new SQL(options);

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
    await using db = new SQL({ ...options, max: 8 });

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
});
