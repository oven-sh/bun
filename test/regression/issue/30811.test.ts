// Regression tests for oven-sh/bun#30811.
//
// `Bun.SQL` SQLite's `parseSQLQuery` classifier reverse-walked tokens and
// flipped `canReturnRows = true` whenever it saw a `SELECT` / `PRAGMA` /
// `WITH` / `EXPLAIN` token — so `INSERT … SELECT` (without `RETURNING`),
// `WITH … INSERT/UPDATE/DELETE/REPLACE`, and queries whose leading token
// is hidden by a `/* … */` or `-- …` comment all routed through the
// `stmt.all()` branch and reported `count: 0` / `lastInsertRowid: null`
// for mutations that actually affected rows.
import { SQL } from "bun";
import { describe, expect, test } from "bun:test";

describe("#30811: SQLite row-count classifier", () => {
  test("INSERT ... SELECT without RETURNING reports affected row count", async () => {
    // The reported shape: the parser saw `SELECT` mid-query and routed
    // the INSERT through `stmt.all()`, returning an empty array with
    // `count: 0` even though two rows were inserted.
    await using sql = new SQL("sqlite://:memory:");
    await sql`CREATE TABLE company (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL)`;
    await sql`INSERT INTO company (name) VALUES (${"ACME"})`;
    await sql`INSERT INTO company (name) VALUES (${"FOO"})`;

    const result = await sql`
      INSERT INTO company (name)
      SELECT name || ${" 2"} FROM company
    `;

    expect(result.command).toBe("INSERT");
    expect(result.count).toBe(2);
    expect(result.lastInsertRowid).toBe(4);

    const rows = await sql<{ id: number; name: string }[]>`SELECT id, name FROM company ORDER BY id`;
    expect(rows).toEqual([
      { id: 1, name: "ACME" },
      { id: 2, name: "FOO" },
      { id: 3, name: "ACME 2" },
      { id: 4, name: "FOO 2" },
    ]);
  });

  test("WITH ... INSERT/UPDATE/DELETE/REPLACE without RETURNING reports affected row count", async () => {
    // CTE-prefixed DML: the leading token is `WITH`, which used to
    // unconditionally set `canReturnRows = true` in the post-loop
    // block. The fix tracks whether a DML keyword was seen during the
    // walk and leaves `canReturnRows` false for `WITH … DML` without
    // a `RETURNING` clause.
    await using sql = new SQL("sqlite://:memory:");
    await sql`CREATE TABLE src (id INTEGER PRIMARY KEY, name TEXT)`;
    await sql`CREATE TABLE dst (id INTEGER PRIMARY KEY, name TEXT)`;
    await sql`INSERT INTO src VALUES (1, 'a'), (2, 'b'), (3, 'c')`;
    await sql`INSERT INTO dst VALUES (1, 'x'), (2, 'y'), (3, 'z')`;

    // Sanity: `WITH … SELECT` still returns rows (the fix must not
    // over-correct and suppress SELECTs behind CTEs).
    const selResult = await sql<
      { id: number; name: string }[]
    >`WITH cte AS (SELECT id, name FROM src WHERE id > 1) SELECT * FROM cte ORDER BY id`;
    expect(selResult.count).toBe(2);
    expect(Array.from(selResult)).toEqual([
      { id: 2, name: "b" },
      { id: 3, name: "c" },
    ]);

    // WITH … INSERT without RETURNING → `count` and `lastInsertRowid`.
    const insResult =
      await sql`WITH cte AS (SELECT id + 10 AS id, name FROM src) INSERT INTO dst SELECT id, name FROM cte`;
    expect(insResult.count).toBe(3);
    expect(insResult.lastInsertRowid).toBe(13);

    // WITH … UPDATE without RETURNING → `count`.
    const updResult =
      await sql`WITH cte AS (SELECT id FROM src WHERE id > 1) UPDATE dst SET name = ${"updated"} WHERE id IN (SELECT id FROM cte)`;
    expect(updResult.count).toBe(2);

    // WITH … DELETE without RETURNING → `count`.
    const delResult =
      await sql`WITH cte AS (SELECT id FROM src WHERE id > 1) DELETE FROM dst WHERE id IN (SELECT id FROM cte)`;
    expect(delResult.count).toBe(2);

    // WITH … REPLACE INTO (SQLite alias for INSERT OR REPLACE) → `count`.
    await sql`DELETE FROM dst`;
    await sql`INSERT INTO dst VALUES (1, 'x'), (2, 'y')`;
    const repResult = await sql`WITH cte AS (SELECT id, name FROM src) REPLACE INTO dst SELECT id, name FROM cte`;
    expect(repResult.count).toBe(3);

    // Sanity: WITH … INSERT … RETURNING still returns the inserted
    // rows (RETURNING takes precedence over the `sawDML` gate).
    await sql`DELETE FROM dst`;
    const retResult = await sql<
      { id: number; name: string }[]
    >`WITH cte AS (SELECT id + 100 AS id, name FROM src) INSERT INTO dst SELECT id, name FROM cte RETURNING id, name`;
    expect(retResult.count).toBe(3);
    expect(Array.from(retResult)).toEqual([
      { id: 101, name: "a" },
      { id: 102, name: "b" },
      { id: 103, name: "c" },
    ]);
  });

  test("leading SQL comments do not hide the statement keyword", async () => {
    // Queries tagged with a leading `/* … */` or `-- …\n` comment
    // (sqlcommenter / APM query tagging) had their leading `SELECT`
    // hidden from the reverse-walk classifier, so SELECTs silently
    // returned empty arrays via `db.run()`. The fix strips SQL
    // comments before the walk.
    await using sql = new SQL("sqlite://:memory:");
    await sql`CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)`;
    await sql`INSERT INTO t VALUES (1, 'Alice'), (2, 'Bob')`;

    const block = await sql<{ id: number; name: string }[]>`/* note */ SELECT id, name FROM t ORDER BY id`;
    expect(block.command).toBe("SELECT");
    expect(block.count).toBe(2);
    expect(Array.from(block)).toEqual([
      { id: 1, name: "Alice" },
      { id: 2, name: "Bob" },
    ]);

    const line = await sql<{ id: number; name: string }[]>`-- note
SELECT id, name FROM t ORDER BY id`;
    expect(line.command).toBe("SELECT");
    expect(line.count).toBe(2);
    expect(Array.from(line)).toEqual([
      { id: 1, name: "Alice" },
      { id: 2, name: "Bob" },
    ]);

    // Leading comment on an INSERT … SELECT must still report the
    // mutation's affected row count (not go through stmt.all()).
    const ins = await sql`/* tag=me */ INSERT INTO t (id, name) SELECT id + 10, name || ${"!"} FROM t WHERE id <= 2`;
    expect(ins.command).toBe("INSERT");
    expect(ins.count).toBe(2);

    // Sanity: an inline string literal containing `--` must not be
    // mistaken for a line comment by the stripper.
    const lit = await sql.unsafe(`SELECT 'hello -- world' AS quoted`);
    expect(lit[0].quoted).toBe("hello -- world");

    // Same for a `/* … */` inside a string literal.
    const blk = await sql.unsafe(`SELECT 'x /* not a comment */ y' AS quoted`);
    expect(blk[0].quoted).toBe("x /* not a comment */ y");
  });
});
