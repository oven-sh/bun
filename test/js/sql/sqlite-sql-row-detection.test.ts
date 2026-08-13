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

  test("command label is the statement's leading keyword, whatever DML keywords its body contains", async () => {
    await using sql = new SQL("sqlite://:memory:");
    await sql`CREATE TABLE t (v INTEGER)`;
    await sql`CREATE TABLE log (id INTEGER PRIMARY KEY, n INTEGER)`;
    await sql`INSERT INTO log VALUES (1, 0)`;

    const labels = {
      createTrigger: (await sql.unsafe(`CREATE TRIGGER trg AFTER INSERT ON t BEGIN UPDATE log SET n = n + 1; END`))
        .command,
      transactionString: (await sql.unsafe(`BEGIN; UPDATE log SET n = 5; COMMIT`)).command,
      upsert: (await sql`INSERT INTO log VALUES (1, 9) ON CONFLICT(id) DO UPDATE SET n = excluded.n`).command,
      update: (await sql`UPDATE log SET n = 6`).command,
      deleteWhereIn: (await sql`DELETE FROM log WHERE n IN (${7})`).command,
      withInsert: (await sql`WITH x AS (SELECT 1 AS v) INSERT INTO t SELECT v FROM x`).command,
      explainUpdate: (await sql.unsafe(`EXPLAIN UPDATE log SET n = 1`)).command,
    };

    expect(labels).toEqual({
      createTrigger: "CREATE",
      transactionString: "BEGIN",
      upsert: "INSERT",
      update: "UPDATE",
      deleteWhereIn: "DELETE",
      withInsert: "WITH",
      explainUpdate: "EXPLAIN",
    });
  });

  test("helper after an unquoted non-ASCII identifier", async () => {
    await using sql = new SQL("sqlite://:memory:");
    // SQLite accepts any byte >= 0x80 in an unquoted identifier. The lexer must not
    // split "CAFÉIN" at the É and mistake the trailing "IN" for a WHERE IN helper.
    await sql`CREATE TABLE caféin (name TEXT)`;
    await sql`CREATE TABLE 数据 (name TEXT)`;

    await sql`INSERT INTO caféin ${sql({ name: "a" })}`;
    await sql`INSERT INTO 数据 ${sql({ name: "b" })}`;
    await sql`UPDATE caféin SET ${sql({ name: "c" })}`;

    expect(await sql`SELECT name FROM caféin`).toEqual([{ name: "c" }]);
    expect(await sql`SELECT name FROM 数据`).toEqual([{ name: "b" }]);
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

  // https://github.com/oven-sh/bun/issues/30811
  test("UPDATE / DELETE with a subquery and no RETURNING report affected row count", async () => {
    await using sql = new SQL("sqlite://:memory:");
    await sql`CREATE TABLE src (id INTEGER PRIMARY KEY)`;
    await sql`CREATE TABLE dst (id INTEGER PRIMARY KEY, name TEXT)`;
    await sql`INSERT INTO src VALUES (2), (3)`;
    await sql`INSERT INTO dst VALUES (1, 'x'), (2, 'y'), (3, 'z')`;

    const upd = await sql`
      UPDATE dst SET name = ${"updated"} WHERE id IN (
        SELECT id FROM src
      )`;
    expect({ command: upd.command, count: upd.count, length: upd.length }).toEqual({
      command: "UPDATE",
      count: 2,
      length: 0,
    });

    const del = await sql`
      DELETE FROM dst WHERE id IN (
        SELECT id FROM src
      )`;
    expect({ command: del.command, count: del.count, length: del.length }).toEqual({
      command: "DELETE",
      count: 2,
      length: 0,
    });

    expect(await sql`SELECT id, name FROM dst`).toEqual([{ id: 1, name: "x" }]);
  });

  // https://github.com/oven-sh/bun/issues/30811
  test("WITH ... UPDATE / DELETE / REPLACE INTO without RETURNING report affected row count", async () => {
    await using sql = new SQL("sqlite://:memory:");
    await sql`CREATE TABLE src (id INTEGER PRIMARY KEY, name TEXT)`;
    await sql`CREATE TABLE dst (id INTEGER PRIMARY KEY, name TEXT)`;
    await sql`INSERT INTO src VALUES (1, 'a'), (2, 'b'), (3, 'c')`;
    await sql`INSERT INTO dst VALUES (1, 'x'), (2, 'y'), (3, 'z')`;

    const upd =
      await sql`WITH cte AS (SELECT id FROM src WHERE id > 1) UPDATE dst SET name = ${"updated"} WHERE id IN (SELECT id FROM cte)`;
    expect(upd.count).toBe(2);

    const del =
      await sql`WITH cte AS (SELECT id FROM src WHERE id > 1) DELETE FROM dst WHERE id IN (SELECT id FROM cte)`;
    expect(del.count).toBe(2);

    // dst now holds only (1, 'x'); REPLACE INTO replaces it and inserts two more.
    const rep = await sql`WITH cte AS (SELECT id, name FROM src) REPLACE INTO dst SELECT id, name FROM cte`;
    expect(rep.count).toBe(3);
    expect(await sql`SELECT id, name FROM dst ORDER BY id`).toEqual([
      { id: 1, name: "a" },
      { id: 2, name: "b" },
      { id: 3, name: "c" },
    ]);
  });

  test("INSERT ... SELECT and WITH ... INSERT with RETURNING return the inserted rows", async () => {
    await using sql = new SQL("sqlite://:memory:");
    await sql`CREATE TABLE src (id INTEGER PRIMARY KEY, name TEXT)`;
    await sql`CREATE TABLE dst (id INTEGER PRIMARY KEY, name TEXT)`;
    await sql`INSERT INTO src VALUES (1, 'a'), (2, 'b')`;

    const plain = await sql`INSERT INTO dst SELECT id, name FROM src RETURNING id, name`;
    expect(plain.count).toBe(2);
    expect(Array.from(plain)).toEqual([
      { id: 1, name: "a" },
      { id: 2, name: "b" },
    ]);

    const cte =
      await sql`WITH cte AS (SELECT id + 100 AS id, name FROM src) INSERT INTO dst SELECT id, name FROM cte RETURNING id, name`;
    expect(cte.count).toBe(2);
    expect(Array.from(cte)).toEqual([
      { id: 101, name: "a" },
      { id: 102, name: "b" },
    ]);
  });

  test("leading comment on INSERT ... SELECT still reports affected row count", async () => {
    await using sql = new SQL("sqlite://:memory:");
    await sql`CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)`;
    await sql`INSERT INTO t VALUES (1, 'Alice'), (2, 'Bob')`;

    const block = await sql`/* tag=me */ INSERT INTO t (id, name) SELECT id + 10, name || ${"!"} FROM t`;
    expect({ command: block.command, count: block.count }).toEqual({ command: "INSERT", count: 2 });

    const line = await sql`-- tag=me
INSERT INTO t (id, name) SELECT id + 20, name FROM t WHERE id <= 2`;
    expect({ command: line.command, count: line.count }).toEqual({ command: "INSERT", count: 2 });

    expect((await sql`SELECT count(*) AS n FROM t`)[0].n).toBe(6);
  });

  test("comment markers inside string literals are data, not comments", async () => {
    await using sql = new SQL("sqlite://:memory:");

    expect(await sql.unsafe(`SELECT 'hello -- world' AS quoted`)).toEqual([{ quoted: "hello -- world" }]);
    expect(await sql.unsafe(`SELECT 'x /* not a comment */ y' AS quoted`)).toEqual([
      { quoted: "x /* not a comment */ y" },
    ]);

    await sql`CREATE TABLE t (name TEXT)`;
    const ins = await sql.unsafe(`INSERT INTO t VALUES ('a -- b'), ('c /* d */ e')`);
    expect({ command: ins.command, count: ins.count }).toEqual({ command: "INSERT", count: 2 });
  });

  test("REPLACE as a scalar function inside WITH ... SELECT still returns rows", async () => {
    await using sql = new SQL("sqlite://:memory:");
    await sql`CREATE TABLE t (name TEXT)`;
    await sql`INSERT INTO t VALUES ('apple'), ('banana')`;

    // A keyword-based classifier has to guess whether REPLACE is the statement
    // or the function; the column count does not care.
    const spaced = await sql.unsafe(
      `WITH cte AS (SELECT REPLACE (name, 'a', 'x') AS n FROM t) SELECT * FROM cte ORDER BY n`,
    );
    expect(Array.from(spaced)).toEqual([{ n: "bxnxnx" }, { n: "xpple" }]);

    const aliased = await sql.unsafe(`WITH cte AS (SELECT name AS replace FROM t ORDER BY name) SELECT * FROM cte`);
    expect(Array.from(aliased)).toEqual([{ replace: "apple" }, { replace: "banana" }]);
  });

  test("EXPLAIN on a write returns the plan rows and does not execute the write", async () => {
    await using sql = new SQL("sqlite://:memory:");
    await sql`CREATE TABLE t (v INTEGER)`;

    const plan = await sql.unsafe(`EXPLAIN INSERT INTO t VALUES (1)`);
    expect(plan.length).toBeGreaterThan(0);
    expect(plan[0]).toHaveProperty("opcode");

    expect(await sql`SELECT count(*) AS n FROM t`).toEqual([{ n: 0 }]);
  });

  test("whitespace- and comment-only queries still report 'no valid SQL statement'", async () => {
    await using sql = new SQL("sqlite://:memory:");

    // These never succeeded pre-PR either; db.run() rejects them with a clear
    // message. The probe prepare must not leak a confusing "finalized" error.
    for (const q of ["   ", "-- noop", "/* placeholder */", "-- a\n-- b\n"]) {
      await expect(Promise.resolve(sql.unsafe(q))).rejects.toThrow("Query contained no valid SQL statement");
    }
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
