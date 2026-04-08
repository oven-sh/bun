// https://github.com/oven-sh/bun/issues/28980
//
// Bun.SQL was including every parameter's runtime null/type pattern in the
// prepared-statement cache key (`signature.name`), so identical SQL with a
// different null pattern hashed to a different cache entry and allocated a
// fresh server-side prepared statement on every batch. Inserting ~20k rows
// with nullable columns was enough to OOM the database server.
//
// These tests assert that repeated inserts with nullable columns reuse a
// SINGLE server-side prepared statement regardless of which columns happen
// to be NULL in any given row. They talk to a real Postgres instance so
// they can inspect `pg_prepared_statements` — if no Postgres is reachable,
// the tests short-circuit to a PASS (same pattern as other SQL regression
// tests in this repo).

import { SQL } from "bun";
import { beforeAll, expect, test } from "bun:test";

const POSTGRES_URL =
  process.env.TEST_POSTGRES_URL ||
  process.env.POSTGRES_URL ||
  process.env.DATABASE_URL ||
  "postgres://postgres:bun@127.0.0.1:5432/postgres";

let postgresAvailable = false;

beforeAll(async () => {
  try {
    const probe = new SQL(POSTGRES_URL, {
      max: 1,
      idleTimeout: 1,
      connectionTimeout: 2,
    });
    await probe`SELECT 1`;
    await probe.end();
    postgresAvailable = true;
  } catch {
    postgresAvailable = false;
  }
});

function uniqueTable(kind: string): string {
  return `repro_28980_${kind}_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e9).toString(36)}`;
}

test("#28980 — single-row inserts with alternating NULL reuse one prepared statement", async () => {
  if (!postgresAvailable) return;

  await using sql = new SQL(POSTGRES_URL, { max: 1, idleTimeout: 10 });
  const table = uniqueTable("single");
  try {
    await sql`CREATE TABLE ${sql(table)} (id INT PRIMARY KEY, note TEXT)`;

    for (let i = 0; i < 20; i++) {
      const note = i % 2 === 0 ? "hello" : null;
      await sql`INSERT INTO ${sql(table)} VALUES (${i}, ${note})`;
    }

    const statementLike = `INSERT INTO "${table}"%`;
    const prepared =
      await sql`SELECT name FROM pg_prepared_statements WHERE statement LIKE ${statementLike}`;

    // Before the fix: the cache key encoded `.int4.null` vs `.int4.text`, so
    // each null pattern allocated a fresh server-side prepared statement.
    expect(prepared.length).toBe(1);

    // And the data should be intact.
    const rows = await sql`SELECT id, note FROM ${sql(table)} ORDER BY id`;
    expect(rows).toHaveLength(20);
    for (let i = 0; i < 20; i++) {
      expect(rows[i]).toEqual({ id: i, note: i % 2 === 0 ? "hello" : null });
    }
  } finally {
    await sql`DROP TABLE IF EXISTS ${sql(table)}`.catch(() => {});
  }
});

test("#28980 — sql(rows) bulk insert with alternating NULL positions reuses one prepared statement", async () => {
  if (!postgresAvailable) return;

  await using sql = new SQL(POSTGRES_URL, { max: 1, idleTimeout: 10 });
  const table = uniqueTable("batch");
  try {
    await sql`CREATE TABLE ${sql(table)} (id INT PRIMARY KEY, note TEXT)`;

    for (let i = 0; i < 20; i++) {
      const rows =
        i % 2 === 0
          ? [
              { id: i * 2, note: "hello" },
              { id: i * 2 + 1, note: null },
            ]
          : [
              { id: i * 2, note: null },
              { id: i * 2 + 1, note: "hi" },
            ];
      await sql`INSERT INTO ${sql(table)} ${sql(rows)}`;
    }

    const statementLike = `INSERT INTO "${table}"%`;
    const prepared =
      await sql`SELECT name FROM pg_prepared_statements WHERE statement LIKE ${statementLike}`;

    // Before the fix: a fresh server-side prepared statement was allocated
    // for every batch whose NULL pattern changed — so 20 batches could grow
    // into dozens of cached statements, and a 100-row batch with K nullable
    // columns grew without bound, OOM'ing the server.
    expect(prepared.length).toBe(1);

    const [{ count }] = await sql`SELECT COUNT(*)::int AS count FROM ${sql(table)}`;
    expect(count).toBe(40);
  } finally {
    await sql`DROP TABLE IF EXISTS ${sql(table)}`.catch(() => {});
  }
});

test("#28980 — all-NULL and all-non-NULL rows share one prepared statement", async () => {
  if (!postgresAvailable) return;

  await using sql = new SQL(POSTGRES_URL, { max: 1, idleTimeout: 10 });
  const table = uniqueTable("mixed");
  try {
    await sql`CREATE TABLE ${sql(table)} (id INT PRIMARY KEY, a TEXT, b TEXT, c TEXT)`;

    await sql`INSERT INTO ${sql(table)} VALUES (${1}, ${null}, ${null}, ${null})`;
    await sql`INSERT INTO ${sql(table)} VALUES (${2}, ${"x"}, ${"y"}, ${"z"})`;
    await sql`INSERT INTO ${sql(table)} VALUES (${3}, ${"x"}, ${null}, ${"z"})`;
    await sql`INSERT INTO ${sql(table)} VALUES (${4}, ${null}, ${"y"}, ${null})`;

    const statementLike = `INSERT INTO "${table}"%`;
    const prepared =
      await sql`SELECT name FROM pg_prepared_statements WHERE statement LIKE ${statementLike}`;

    expect(prepared.length).toBe(1);

    const rows = await sql`SELECT id, a, b, c FROM ${sql(table)} ORDER BY id`;
    expect(rows).toEqual([
      { id: 1, a: null, b: null, c: null },
      { id: 2, a: "x", b: "y", c: "z" },
      { id: 3, a: "x", b: null, c: "z" },
      { id: 4, a: null, b: "y", c: null },
    ]);
  } finally {
    await sql`DROP TABLE IF EXISTS ${sql(table)}`.catch(() => {});
  }
});
