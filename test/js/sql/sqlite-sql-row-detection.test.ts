// Bun.SQL (sqlite adapter): whether a query returns rows is now decided by the
// prepared statement's column count, not by a JavaScript tokenizer. The old
// heuristic silently dropped rows for valid SQL it could not tokenize and
// misreported affected-row counts for INSERT ... SELECT (#30811).
import { SQL } from "bun";
import { describe, expect, test } from "bun:test";

describe("row-returning detection (column count, not tokenizer)", () => {
  test("LIKE predicate containing a double quote returns rows", async () => {
    await using sql = new SQL("sqlite://:memory:");
    await sql`CREATE TABLE t (v TEXT)`;
    await sql`INSERT INTO t VALUES (${"a"}), (${'b"c'}), (${"d"})`;

    const rows = await sql.unsafe(`select v from t where v like '%"%'`);
    expect(rows).toEqual([{ v: 'b"c' }]);
  });

  test("leading block comment before SELECT returns rows", async () => {
    await using sql = new SQL("sqlite://:memory:");
    await sql`CREATE TABLE t (v INTEGER)`;
    await sql`INSERT INTO t VALUES (1), (2), (3)`;

    const rows = await sql.unsafe(`/*hdr*/select v from t`);
    expect(rows).toEqual([{ v: 1 }, { v: 2 }, { v: 3 }]);
  });

  test("leading line comment before SELECT returns rows", async () => {
    await using sql = new SQL("sqlite://:memory:");
    await sql`CREATE TABLE t (v INTEGER)`;
    await sql`INSERT INTO t VALUES (1), (2)`;

    const rows = await sql.unsafe(`-- header\nselect v from t`);
    expect(rows).toEqual([{ v: 1 }, { v: 2 }]);
  });

  test("SELECT with no whitespace before punctuation returns rows", async () => {
    await using sql = new SQL("sqlite://:memory:");
    await sql`CREATE TABLE t (v INTEGER)`;
    await sql`INSERT INTO t VALUES (1), (2), (3)`;

    expect(await sql.unsafe(`select*from t`)).toEqual([{ v: 1 }, { v: 2 }, { v: 3 }]);

    const paren = await sql.unsafe(`select(v)from t`);
    expect(paren.map(r => Object.values(r)[0])).toEqual([1, 2, 3]);
  });

  test("top-level VALUES returns rows", async () => {
    await using sql = new SQL("sqlite://:memory:");
    const rows = await sql.unsafe(`values (1,'a'),(2,'b')`);
    expect(rows.map(r => Object.values(r))).toEqual([
      [1, "a"],
      [2, "b"],
    ]);
  });

  test("INSERT ... RETURNING writes and returns the rows", async () => {
    await using sql = new SQL("sqlite://:memory:");
    await sql`CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)`;

    const returned = await sql.unsafe(`insert into t(v)values('x')returning id,v`);
    expect(returned).toEqual([{ id: 1, v: "x" }]);

    const rows = await sql`SELECT v FROM t`;
    expect(rows).toEqual([{ v: "x" }]);
  });

  test("row-producing PRAGMA returns rows, non-row PRAGMA does not", async () => {
    await using sql = new SQL("sqlite://:memory:");
    await sql`CREATE TABLE t (v INTEGER)`;

    const info = await sql.unsafe(`pragma table_info(t)`);
    expect(info.length).toBe(1);
    expect(info[0].name).toBe("v");

    // A PRAGMA that sets a value yields no rows and must not throw.
    const res = await sql.unsafe(`pragma user_version = 5`);
    expect(res.length).toBe(0);
    expect((await sql.unsafe(`pragma user_version`))[0].user_version).toBe(5);
  });

  test("command label survives comments and punctuation", async () => {
    await using sql = new SQL("sqlite://:memory:");
    await sql`CREATE TABLE t (v INTEGER)`;
    await sql`INSERT INTO t VALUES (1)`;

    expect((await sql.unsafe(`/*hdr*/select v from t`)).command).toBe("SELECT");
    expect((await sql.unsafe(`select*from t`)).command).toBe("SELECT");
  });

  // https://github.com/oven-sh/bun/issues/30811
  test("INSERT ... SELECT without RETURNING reports affected row count", async () => {
    await using sql = new SQL("sqlite://:memory:");
    await sql`CREATE TABLE company (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL)`;
    await sql`INSERT INTO company (name) VALUES (${"ACME"}), (${"FOO"})`;

    const result = await sql`INSERT INTO company (name) SELECT name || ${" 2"} FROM company`;
    expect(result.command).toBe("INSERT");
    expect(result.count).toBe(2);
    expect(result.lastInsertRowid).toBe(4);
  });

  // https://github.com/oven-sh/bun/issues/30811
  test("WITH ... INSERT without RETURNING reports affected row count", async () => {
    await using sql = new SQL("sqlite://:memory:");
    await sql`CREATE TABLE src (id INTEGER PRIMARY KEY, name TEXT)`;
    await sql`CREATE TABLE dst (id INTEGER PRIMARY KEY, name TEXT)`;
    await sql`INSERT INTO src VALUES (1, 'a'), (2, 'b'), (3, 'c')`;

    const ins = await sql`WITH cte AS (SELECT id + 10 AS id, name FROM src) INSERT INTO dst SELECT id, name FROM cte`;
    expect(ins.count).toBe(3);
    expect(ins.lastInsertRowid).toBe(13);

    // WITH ... SELECT must still return rows (not over-corrected).
    const sel = await sql`WITH cte AS (SELECT id, name FROM src WHERE id > 1) SELECT * FROM cte ORDER BY id`;
    expect(Array.from(sel)).toEqual([
      { id: 2, name: "b" },
      { id: 3, name: "c" },
    ]);
  });

  test("multi-statement writes still execute every statement", async () => {
    await using sql = new SQL("sqlite://:memory:");
    await sql.unsafe(`
      CREATE TABLE m1 (id INTEGER);
      CREATE TABLE m2 (id INTEGER);
      INSERT INTO m1 VALUES (1);
      INSERT INTO m2 VALUES (2);
    `);

    expect(await sql`SELECT id FROM m1`).toEqual([{ id: 1 }]);
    expect(await sql`SELECT id FROM m2`).toEqual([{ id: 2 }]);
  });

  test("INSERT helper detected past a comment containing a quote", async () => {
    await using sql = new SQL("sqlite://:memory:");
    await sql`CREATE TABLE items (name TEXT)`;

    // The comment holds a lone apostrophe; the old reverse-scan tokenizer let
    // it hijack the quote state and miss INSERT, throwing a bogus SyntaxError.
    await sql`INSERT INTO items /* don't */ ${sql({ name: "a" })}`;

    const rows = await sql`SELECT name FROM items`;
    expect(rows).toEqual([{ name: "a" }]);
  });
});
