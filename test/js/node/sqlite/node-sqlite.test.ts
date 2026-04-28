import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { isBuiltin } from "node:module";
import path from "node:path";
import { DatabaseSync, StatementSync, constants } from "node:sqlite";

test("node:sqlite is a built-in module", () => {
  expect(isBuiltin("node:sqlite")).toBe(true);
  // Like node:test, node:sqlite is only available with the node: prefix.
  expect(isBuiltin("sqlite")).toBe(false);
});

test("process.versions.sqlite is set", () => {
  expect(typeof process.versions.sqlite).toBe("string");
  expect(process.versions.sqlite).toMatch(/^3\.\d+\.\d+$/);
});

describe("DatabaseSync", () => {
  test("basic lifecycle", () => {
    const db = new DatabaseSync(":memory:");
    expect(db.isOpen).toBe(true);
    expect(db.isTransaction).toBe(false);
    expect(db.exec("CREATE TABLE t (k INTEGER PRIMARY KEY, v TEXT)")).toBeUndefined();

    const ins = db.prepare("INSERT INTO t (k, v) VALUES (?, ?)");
    expect(ins).toBeInstanceOf(StatementSync);
    expect(ins.run(1, "hello")).toEqual({ changes: 1, lastInsertRowid: 1 });

    const sel = db.prepare("SELECT * FROM t WHERE k = ?");
    expect(sel.get(1)).toEqual({ __proto__: null, k: 1, v: "hello" });
    expect(sel.all(1)).toEqual([{ __proto__: null, k: 1, v: "hello" }]);

    db.close();
    expect(db.isOpen).toBe(false);
    expect(() => db.close()).toThrow(/database is not open/);
    expect(() => db.exec("SELECT 1")).toThrow(/database is not open/);
  });

  test("deferred open via { open: false }", () => {
    using dir = tempDir("node-sqlite-deferred", {});
    const p = path.join(String(dir), "db.sqlite");
    const db = new DatabaseSync(p, { open: false });
    expect(db.isOpen).toBe(false);
    expect(() => db.exec("SELECT 1")).toThrow(/database is not open/);
    db.open();
    expect(db.isOpen).toBe(true);
    expect(() => db.open()).toThrow(/database is already open/);
    db.close();
  });

  test("Symbol.dispose swallows errors on closed databases", () => {
    const db = new DatabaseSync(":memory:", { open: false });
    expect(() => db[Symbol.dispose]()).not.toThrow();
    expect(() => db.close()).toThrow(/database is not open/);
  });

  test("binds typed arrays as BLOBs and returns Uint8Array", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("CREATE TABLE t (b BLOB)");
    db.prepare("INSERT INTO t VALUES (?)").run(new Uint8Array([1, 2, 3]));
    const row = db.prepare("SELECT b FROM t").get();
    expect(row.b).toBeInstanceOf(Uint8Array);
    expect(row.b).toEqual(new Uint8Array([1, 2, 3]));
    db.close();
  });

  test("rejects unbindable values with ERR_INVALID_ARG_TYPE", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("CREATE TABLE t (a, b)");
    const stmt = db.prepare("INSERT INTO t VALUES (?, ?)");
    expect(() => stmt.run(1, Symbol())).toThrow(
      expect.objectContaining({
        code: "ERR_INVALID_ARG_TYPE",
        message: expect.stringMatching(/Provided value cannot be bound to SQLite parameter 2/),
      }),
    );
    db.close();
  });

  test("rejects oversized BigInt with ERR_INVALID_ARG_VALUE", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("CREATE TABLE t (a)");
    const stmt = db.prepare("INSERT INTO t VALUES (?)");
    expect(() => stmt.run(9223372036854775808n)).toThrow(
      expect.objectContaining({
        code: "ERR_INVALID_ARG_VALUE",
        message: expect.stringMatching(/BigInt value is too large to bind/),
      }),
    );
    db.close();
  });

  test("statements are unbound on each call", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("CREATE TABLE t (k INTEGER PRIMARY KEY, v INTEGER)");
    const stmt = db.prepare("INSERT INTO t (k, v) VALUES (?, ?)");
    expect(stmt.run(1, 5)).toEqual({ changes: 1, lastInsertRowid: 1 });
    // In Node.js, a subsequent call with no arguments binds NULL to all
    // parameters rather than re-using the previous bindings.
    expect(stmt.run()).toEqual({ changes: 1, lastInsertRowid: 2 });
    expect(db.prepare("SELECT * FROM t ORDER BY k").all()).toEqual([
      { __proto__: null, k: 1, v: 5 },
      { __proto__: null, k: 2, v: null },
    ]);
    db.close();
  });

  test("StatementSync cannot be constructed directly", () => {
    expect(() => new StatementSync()).toThrow(/Illegal constructor/);
  });

  test("exposes changeset constants", () => {
    expect(constants.SQLITE_CHANGESET_OMIT).toBe(0);
    expect(constants.SQLITE_CHANGESET_REPLACE).toBe(1);
    expect(constants.SQLITE_CHANGESET_ABORT).toBe(2);
  });
});

// Regression: unclosed bun:sqlite databases would trigger a heap-use-after-free
// when BUN_DESTRUCT_VM_ON_EXIT=1, because Bun__closeAllSQLiteDatabasesForTermination
// closed the handle without nulling it, and the GC finalizer then closed it again.
test("unclosed sqlite database does not use-after-free on VM teardown", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const { Database } = require('bun:sqlite');
       const db = new Database(':memory:');
       db.run('SELECT 1');
       // intentionally not closed`,
    ],
    env: { ...bunEnv, BUN_DESTRUCT_VM_ON_EXIT: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).not.toContain("heap-use-after-free");
  expect(stderr).toBe("");
  expect(stdout).toBe("");
  expect(exitCode).toBe(0);
});
