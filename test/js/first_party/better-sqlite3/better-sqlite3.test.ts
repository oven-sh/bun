// better-sqlite3 is a V8-API native addon; Bun overrides `require("better-sqlite3")`
// with a shim backed by bun:sqlite. https://github.com/oven-sh/bun/issues/14997
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
// @ts-expect-error no types for the builtin override
import Database from "better-sqlite3";

const { SqliteError } = Database;

describe("better-sqlite3 shim", () => {
  test("default export is a Database constructor", () => {
    expect(typeof Database).toBe("function");
    expect(typeof SqliteError).toBe("function");
    expect(require.resolve("better-sqlite3")).toBe("better-sqlite3");
  });

  test("basic CRUD", () => {
    const db = new Database(":memory:");
    expect(db.open).toBe(true);
    expect(db.readonly).toBe(false);
    expect(db.memory).toBe(true);
    expect(db.name).toBe(":memory:");

    db.exec("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)");

    const insert = db.prepare("INSERT INTO users (name) VALUES (?)");
    const r = insert.run("alice");
    expect(r.changes).toBe(1);
    expect(r.lastInsertRowid).toBe(1);
    insert.run("bob");

    const sel = db.prepare("SELECT * FROM users WHERE id = ?");
    expect(sel.get(1)).toEqual({ id: 1, name: "alice" });
    expect(sel.get(999)).toBeUndefined();

    expect(db.prepare("SELECT * FROM users").all()).toEqual([
      { id: 1, name: "alice" },
      { id: 2, name: "bob" },
    ]);

    db.close();
    expect(db.open).toBe(false);
  });

  test("is callable without new", () => {
    // @ts-expect-error
    const db = Database(":memory:");
    expect(db.open).toBe(true);
    db.close();
  });

  test(".raw() / .pluck() / .bind() are chainable mode setters", () => {
    const db = new Database(":memory:");
    db.exec("CREATE TABLE t (a INTEGER, b TEXT)");
    db.prepare("INSERT INTO t VALUES (?, ?)").run(1, "x");
    db.prepare("INSERT INTO t VALUES (?, ?)").run(2, "y");

    expect(db.prepare("SELECT * FROM t").raw().all()).toEqual([
      [1, "x"],
      [2, "y"],
    ]);
    expect(db.prepare("SELECT * FROM t").raw(false).all()).toEqual([
      { a: 1, b: "x" },
      { a: 2, b: "y" },
    ]);
    expect(db.prepare("SELECT * FROM t").raw().get()).toEqual([1, "x"]);

    expect(db.prepare("SELECT b FROM t").pluck().all()).toEqual(["x", "y"]);
    expect(db.prepare("SELECT b FROM t").pluck().get()).toBe("x");

    const bound = db.prepare("SELECT * FROM t WHERE a = ?").bind(2);
    expect(bound.all()).toEqual([{ a: 2, b: "y" }]);
    expect(bound.get()).toEqual({ a: 2, b: "y" });
    expect(() => bound.all(1)).toThrow("already has bound parameters");
    expect(() => bound.iterate(1)).toThrow("already has bound parameters");
    expect(() => bound.bind(1)).toThrow("only be invoked once");

    db.close();
  });

  test(".pragma()", () => {
    const db = new Database(":memory:");
    expect(db.pragma("journal_mode", { simple: true })).toBe("memory");
    const full = db.pragma("journal_mode");
    expect(full).toEqual([{ journal_mode: "memory" }]);
    db.close();
  });

  test(".transaction() has .deferred/.immediate/.exclusive", () => {
    const db = new Database(":memory:");
    db.exec("CREATE TABLE t (a INTEGER)");
    const insert = db.prepare("INSERT INTO t VALUES (?)");
    expect(db.inTransaction).toBe(false);

    const tx = db.transaction((values: number[]) => {
      expect(db.inTransaction).toBe(true);
      for (const v of values) insert.run(v);
    });
    expect(typeof tx.deferred).toBe("function");
    expect(typeof tx.immediate).toBe("function");
    expect(typeof tx.exclusive).toBe("function");

    tx.deferred([1, 2, 3]);
    expect(db.inTransaction).toBe(false);
    expect(db.prepare("SELECT a FROM t").pluck().all()).toEqual([1, 2, 3]);

    expect(() =>
      db.transaction(() => {
        insert.run(4);
        throw new Error("rollback");
      })(),
    ).toThrow("rollback");
    expect(db.prepare("SELECT a FROM t").pluck().all()).toEqual([1, 2, 3]);

    db.close();
  });

  test(".columns(), .reader and .readonly", () => {
    const db = new Database(":memory:");
    db.exec("CREATE TABLE t (a INTEGER, b TEXT)");
    const sel = db.prepare("SELECT a, b FROM t");
    expect(sel.columns()).toEqual([
      { name: "a", column: null, table: null, database: null, type: "INTEGER" },
      { name: "b", column: null, table: null, database: null, type: "TEXT" },
    ]);
    expect(sel.reader).toBe(true);
    expect(sel.readonly).toBe(true);
    const ins = db.prepare("INSERT INTO t VALUES (1, 'x')");
    expect(ins.reader).toBe(false);
    expect(ins.readonly).toBe(false);
    db.close();
  });

  test(".iterate()", () => {
    const db = new Database(":memory:");
    db.exec("CREATE TABLE t (a INTEGER)");
    for (let i = 1; i <= 3; i++) db.prepare("INSERT INTO t VALUES (?)").run(i);

    const seen: number[] = [];
    for (const row of db.prepare("SELECT a FROM t").iterate()) seen.push(row.a);
    expect(seen).toEqual([1, 2, 3]);

    const raw = [...db.prepare("SELECT a FROM t").raw().iterate()];
    expect(raw).toEqual([[1], [2], [3]]);
    db.close();
  });

  test(".raw().iterate() preserves positional values with duplicate column names", () => {
    const db = new Database(":memory:");
    db.exec("CREATE TABLE a (id INTEGER); CREATE TABLE b (id INTEGER)");
    db.exec("INSERT INTO a VALUES (1); INSERT INTO b VALUES (2)");
    const stmt = db.prepare("SELECT a.id, b.id FROM a JOIN b");
    expect(stmt.raw().all()).toEqual([[1, 2]]);
    expect([...stmt.raw().iterate()]).toEqual([[1, 2]]);
    expect(db.prepare("SELECT a.id, b.id FROM a JOIN b").pluck().get()).toBe(1);
    db.close();
  });

  test(".expand() groups columns under $", () => {
    const db = new Database(":memory:");
    db.exec("CREATE TABLE t (a INTEGER, b TEXT)");
    db.prepare("INSERT INTO t VALUES (?, ?)").run(1, "x");
    expect(db.prepare("SELECT * FROM t").expand().get()).toEqual({ $: { a: 1, b: "x" } });
    expect(db.prepare("SELECT * FROM t").expand().all()).toEqual([{ $: { a: 1, b: "x" } }]);
    db.close();
  });

  test("Symbol.iterator on a Statement", () => {
    const db = new Database(":memory:");
    db.exec("CREATE TABLE t (a INTEGER)");
    db.exec("INSERT INTO t VALUES (1); INSERT INTO t VALUES (2)");
    const rows = [...db.prepare("SELECT a FROM t")];
    expect(rows).toEqual([{ a: 1 }, { a: 2 }]);
    db.close();
  });

  test(".serialize() round-trips through new Database(Buffer)", () => {
    const src = new Database(":memory:");
    src.exec("CREATE TABLE t (x INTEGER)");
    src.prepare("INSERT INTO t VALUES (?)").run(7);
    const buf = src.serialize();
    src.close();
    expect(Buffer.isBuffer(buf)).toBe(true);

    const dst = new Database(buf);
    expect(dst.name).toBe(":memory:");
    expect(dst.memory).toBe(true);
    expect(dst.prepare("SELECT x FROM t").pluck().get()).toBe(7);
    dst.close();
  });

  test(".safeIntegers() and .defaultSafeIntegers()", () => {
    const db = new Database(":memory:");
    db.exec("CREATE TABLE t (x INTEGER)");
    db.prepare("INSERT INTO t VALUES (?)").run(42);

    expect(db.prepare("SELECT x FROM t").pluck().get()).toBe(42);
    expect(db.prepare("SELECT x FROM t").safeIntegers(true).pluck().get()).toBe(42n);

    db.defaultSafeIntegers(true);
    expect(db.prepare("SELECT x FROM t").pluck().get()).toBe(42n);
    expect(db.prepare("SELECT x FROM t").safeIntegers(false).pluck().get()).toBe(42);
    db.close();
  });

  test("named parameters bind without the @/$/: prefix", () => {
    const db = new Database(":memory:");
    db.exec("CREATE TABLE t (name TEXT)");
    db.prepare("INSERT INTO t VALUES (@name)").run({ name: "x" });
    db.prepare("INSERT INTO t VALUES ($name)").run({ name: "y" });
    db.prepare("INSERT INTO t VALUES (:name)").run({ name: "z" });
    expect(db.prepare("SELECT name FROM t").pluck().all()).toEqual(["x", "y", "z"]);
    expect(() => db.prepare("INSERT INTO t VALUES (@name)").run({ wrong: "a" })).toThrow('Missing parameter "name"');
    db.close();
  });

  test("transaction().database is the shim Database", () => {
    const db = new Database(":memory:");
    const tx = db.transaction(() => {});
    expect(tx.database).toBe(db);
    expect(tx.deferred.database).toBe(db);
    db.close();
  });

  test("verbose option receives executed SQL", () => {
    const seen: string[] = [];
    const db = new Database(":memory:", { verbose: (sql: string) => seen.push(sql) });
    db.exec("CREATE TABLE t (x INTEGER)");
    db.prepare("INSERT INTO t VALUES (?)").run(1);
    db.prepare("SELECT x FROM t").all();
    db.pragma("journal_mode");
    expect(seen).toEqual([
      "CREATE TABLE t (x INTEGER)",
      "INSERT INTO t VALUES (?)",
      "SELECT x FROM t",
      "PRAGMA journal_mode",
    ]);
    db.close();
  });

  test("SqliteError", () => {
    const err = SqliteError("oops", "SQLITE_TEST");
    expect(err.name).toBe("SqliteError");
    expect(err.code).toBe("SQLITE_TEST");
    expect(err.message).toBe("oops");
    expect(err instanceof SqliteError).toBe(true);
    expect(err instanceof Error).toBe(true);

    const db = new Database(":memory:");
    let thrown: any;
    try {
      db.exec("NOT VALID SQL");
    } catch (e) {
      thrown = e;
    }
    expect(thrown instanceof SqliteError).toBe(true);
    db.close();
  });

  test("constructor option validation matches better-sqlite3", () => {
    // @ts-expect-error
    expect(() => new Database(123)).toThrow("Expected first argument to be a string");
    expect(() => new Database(":memory:", { readOnly: true } as any)).toThrow('Misspelled option "readOnly"');
    expect(() => new Database(":memory:", { readonly: true })).toThrow("cannot be readonly");
    expect(() => new Database(":memory:", { timeout: -1 } as any)).toThrow("positive integer");
  });

  test("opens a file and applies fileMustExist", () => {
    using dir = tempDir("better-sqlite3", {});
    const path = `${dir}/data.db`;

    expect(() => new Database(path, { fileMustExist: true })).toThrow(SqliteError);

    const db = new Database(path);
    db.exec("CREATE TABLE t (x INTEGER)");
    db.prepare("INSERT INTO t VALUES (?)").run(42);
    db.close();

    const db2 = new Database(path, { fileMustExist: true });
    expect(db2.prepare("SELECT x FROM t").pluck().get()).toBe(42);
    db2.close();
  });

  test("unimplemented methods throw ERR_NOT_IMPLEMENTED", () => {
    const db = new Database(":memory:");
    for (const m of ["function", "aggregate", "table", "backup", "unsafeMode"]) {
      let code: string | undefined;
      try {
        (db as any)[m]();
      } catch (e: any) {
        code = e.code;
      }
      expect(code).toBe("ERR_NOT_IMPLEMENTED");
    }
    expect(db.unsafeMode(false)).toBe(db);
    db.close();
  });
});

// https://github.com/oven-sh/bun/issues/14997
// drizzle-kit imports better-sqlite3 and calls prepare().bind().all(),
// prepare().raw().all(), and transaction()[behavior](). The native addon
// cannot load under Bun, so this must be served by the shim.
test("issue #14997: drizzle-orm's better-sqlite3 driver call shapes work", async () => {
  using dir = tempDir("issue-14997", {
    "index.js": `
      const Database = require("better-sqlite3");
      const db = new Database("db.sqlite");
      db.exec("CREATE TABLE __drizzle_migrations (id INTEGER PRIMARY KEY, hash TEXT, created_at INTEGER)");
      db.prepare("INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)").run("abc", 1);
      const a = db.prepare("SELECT * FROM __drizzle_migrations WHERE hash = ?").bind("abc").all();
      const b = db.prepare("SELECT hash, created_at FROM __drizzle_migrations").raw(true).all();
      const tx = db.transaction(() => {
        db.prepare("INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)").run("def", 2);
      });
      tx.deferred();
      const c = db.prepare("SELECT hash FROM __drizzle_migrations ORDER BY id").pluck().all();
      console.log(JSON.stringify({ a, b, c }));
      db.close();
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "index.js"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(JSON.parse(stdout)).toEqual({
    a: [{ id: 1, hash: "abc", created_at: 1 }],
    b: [["abc", 1]],
    c: ["abc", "def"],
  });
  expect(exitCode).toBe(0);
});
