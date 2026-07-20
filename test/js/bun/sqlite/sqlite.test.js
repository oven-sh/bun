import { spawnSync } from "bun";
import { constants, Database, SQLiteError } from "bun:sqlite";
import { describe, expect, it } from "bun:test";
import { existsSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "fs";
import { bunEnv, bunExe, isASAN, isDebug, isMacOS, isMacOSVersionAtLeast, isWindows, tempDirWithFiles } from "harness";
import { tmpdir } from "os";
import path from "path";

const tmpbase = tmpdir() + path.sep;

describe("as", () => {
  it("should return an implementation of the class", () => {
    const db = new Database(":memory:");
    db.exec("CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)");
    db.run("INSERT INTO test (name) VALUES ('Hello')");
    db.run("INSERT INTO test (name) VALUES ('World')");

    const q = db.query("SELECT * FROM test WHERE name = ?");
    class MyTest {
      name;

      get isHello() {
        return this.name === "Hello";
      }
    }

    expect(q.get("Hello")).not.toBeInstanceOf(MyTest);
    q.as(MyTest);
    expect(q.get("Hello")).toBeInstanceOf(MyTest);
    expect(q.get("Hello").isHello).toBe(true);

    const list = db.query("SELECT * FROM test");
    list.as(MyTest);
    const all = list.all();
    expect(all[0]).toBeInstanceOf(MyTest);
    expect(all[0].isHello).toBe(true);
    expect(all[1]).toBeInstanceOf(MyTest);
    expect(all[1].isHello).toBe(false);
  });

  it("should work with more complicated getters", () => {
    class User {
      rawBirthdate;
      get birthdate() {
        return new Date(this.rawBirthdate);
      }
    }

    const db = new Database(":memory:");
    db.exec("CREATE TABLE users (id INTEGER PRIMARY KEY, rawBirthdate TEXT)");
    db.run("INSERT INTO users (rawBirthdate) VALUES ('1995-12-19')");
    const query = db.query("SELECT * FROM users");
    query.as(User);
    const user = query.get();
    expect(user.birthdate.getTime()).toBe(new Date("1995-12-19").getTime());
  });

  it("validates the class", () => {
    const db = new Database(":memory:");
    db.exec("CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)");
    db.run("INSERT INTO test (name) VALUES ('Hello')");
    expect(() => db.query("SELECT * FROM test").as(null)).toThrow("Expected class to be a constructor or undefined");
    expect(() => db.query("SELECT * FROM test").as(() => {})).toThrow("Expected a constructor");
    function BadClass() {}
    BadClass.prototype = 123;
    expect(() => db.query("SELECT * FROM test").as(BadClass)).toThrow(
      "Expected a constructor prototype to be an object",
    );
  });
});

describe("async SQLite method semantics (Gate C prerequisite private)", () => {
  it("exposes Promise-shaped private Exec, Run, Get, All, and Values helpers", async () => {
    const {
      asyncSQLiteConnectionOpenForTesting,
      asyncSQLiteConnectionExecForTesting,
      asyncSQLiteConnectionRunForTesting,
      asyncSQLiteConnectionGetForTesting,
      asyncSQLiteConnectionAllForTesting,
      asyncSQLiteConnectionValuesForTesting,
      asyncSQLiteConnectionCloseForTesting,
    } = await import("bun:internal-for-testing");

    expect(typeof asyncSQLiteConnectionExecForTesting).toBe("function");
    expect(typeof asyncSQLiteConnectionRunForTesting).toBe("function");
    expect(typeof asyncSQLiteConnectionGetForTesting).toBe("function");
    expect(typeof asyncSQLiteConnectionAllForTesting).toBe("function");
    expect(typeof asyncSQLiteConnectionValuesForTesting).toBe("function");

    const file = path.join(tempDirWithFiles("sqlite-async-method-surface", { "empty.txt": "" }), "methods.db");
    const connection = asyncSQLiteConnectionOpenForTesting(file, 8);
    await connection.ready;
    try {
      for (const promise of [
        asyncSQLiteConnectionExecForTesting(connection.id, "CREATE TABLE t (value INTEGER)"),
        asyncSQLiteConnectionRunForTesting(connection.id, "INSERT INTO t VALUES (1)"),
        asyncSQLiteConnectionGetForTesting(connection.id, "SELECT value FROM t"),
        asyncSQLiteConnectionAllForTesting(connection.id, "SELECT value FROM t"),
        asyncSQLiteConnectionValuesForTesting(connection.id, "SELECT value FROM t"),
      ]) {
        expect(promise).toBeInstanceOf(Promise);
        await promise;
      }
    } finally {
      await asyncSQLiteConnectionCloseForTesting(connection.id);
    }
  });

  it("exec executes scripts, rejects bindings and empty SQL, and recovers after an error", async () => {
    const {
      asyncSQLiteConnectionOpenForTesting,
      asyncSQLiteConnectionExecForTesting,
      asyncSQLiteConnectionAllForTesting,
      asyncSQLiteConnectionCloseForTesting,
    } = await import("bun:internal-for-testing");
    const file = path.join(tempDirWithFiles("sqlite-async-exec-semantics", { "empty.txt": "" }), "methods.db");
    const connection = asyncSQLiteConnectionOpenForTesting(file, 8);
    await connection.ready;
    try {
      await expect(
        asyncSQLiteConnectionExecForTesting(
          connection.id,
          " /* leading */ CREATE TABLE t (value INTEGER); INSERT INTO t VALUES (1); ; INSERT INTO t VALUES (2); -- trailing\n",
        ),
      ).resolves.toBe(true);
      await expect(asyncSQLiteConnectionExecForTesting(connection.id, "INSERT INTO t VALUES (?)", [3])).rejects.toThrow(
        "does not accept bindings",
      );
      await expect(asyncSQLiteConnectionExecForTesting(connection.id, " ; /* only comment */ ")).rejects.toThrow(
        "requires an executable statement",
      );
      await expect(
        asyncSQLiteConnectionExecForTesting(connection.id, "INSERT INTO t VALUES (3); INSERT INTO missing VALUES (4)"),
      ).rejects.toThrow(SQLiteError);
      expect(await asyncSQLiteConnectionAllForTesting(connection.id, "SELECT value FROM t ORDER BY value")).toEqual([
        { value: 1 },
        { value: 2 },
        { value: 3 },
      ]);
    } finally {
      await asyncSQLiteConnectionCloseForTesting(connection.id);
    }
  });

  it("run returns total changes and final row ID with first-statement bindings", async () => {
    const {
      asyncSQLiteConnectionOpenForTesting,
      asyncSQLiteConnectionExecForTesting,
      asyncSQLiteConnectionRunForTesting,
      asyncSQLiteConnectionAllForTesting,
      asyncSQLiteConnectionCloseForTesting,
    } = await import("bun:internal-for-testing");
    const file = path.join(tempDirWithFiles("sqlite-async-run-semantics", { "empty.txt": "" }), "methods.db");
    const connection = asyncSQLiteConnectionOpenForTesting(file, 8);
    await connection.ready;
    try {
      await asyncSQLiteConnectionExecForTesting(
        connection.id,
        "CREATE TABLE t (id INTEGER PRIMARY KEY, value INTEGER)",
      );
      await expect(
        asyncSQLiteConnectionRunForTesting(
          connection.id,
          "/* lead */ INSERT INTO t (value) VALUES (?); INSERT INTO t (value) VALUES (20);",
          [10],
        ),
      ).resolves.toEqual({ changes: 2, lastInsertRowid: 2 });
      expect(await asyncSQLiteConnectionAllForTesting(connection.id, "SELECT id, value FROM t ORDER BY id")).toEqual([
        { id: 1, value: 10 },
        { id: 2, value: 20 },
      ]);
      await expect(asyncSQLiteConnectionRunForTesting(connection.id, "-- only comment")).rejects.toThrow(
        "requires an executable statement",
      );
    } finally {
      await asyncSQLiteConnectionCloseForTesting(connection.id);
    }
  });

  it("materializes get, all, and values with their distinct result shapes", async () => {
    const {
      asyncSQLiteConnectionOpenForTesting,
      asyncSQLiteConnectionExecForTesting,
      asyncSQLiteConnectionGetForTesting,
      asyncSQLiteConnectionAllForTesting,
      asyncSQLiteConnectionValuesForTesting,
      asyncSQLiteConnectionCloseForTesting,
    } = await import("bun:internal-for-testing");
    const file = path.join(tempDirWithFiles("sqlite-async-row-shapes", { "empty.txt": "" }), "methods.db");
    const connection = asyncSQLiteConnectionOpenForTesting(file, 8);
    await connection.ready;
    try {
      await asyncSQLiteConnectionExecForTesting(
        connection.id,
        "CREATE TABLE t (value INTEGER); INSERT INTO t VALUES (1); INSERT INTO t VALUES (2)",
      );
      expect(
        await asyncSQLiteConnectionGetForTesting(
          connection.id,
          "SELECT value AS first, value + 10 AS first FROM t ORDER BY value",
        ),
      ).toEqual({
        first: 11,
      });
      await expect(
        asyncSQLiteConnectionGetForTesting(connection.id, "SELECT value FROM t WHERE 0"),
      ).resolves.toBeNull();
      expect(await asyncSQLiteConnectionAllForTesting(connection.id, "SELECT value FROM t ORDER BY value")).toEqual([
        { value: 1 },
        { value: 2 },
      ]);
      expect(
        await asyncSQLiteConnectionValuesForTesting(connection.id, "SELECT value, value + 10 FROM t ORDER BY value"),
      ).toEqual([
        [1, 11],
        [2, 12],
      ]);
    } finally {
      await asyncSQLiteConnectionCloseForTesting(connection.id);
    }
  });

  it("copies only the first row for get", async () => {
    const {
      asyncSQLiteConnectionOpenForTesting,
      asyncSQLiteConnectionGetForTesting,
      asyncSQLiteConnectionCloseForTesting,
      asyncSQLiteConnectionStatsForTesting,
    } = await import("bun:internal-for-testing");
    const file = path.join(tempDirWithFiles("sqlite-async-get-first-row", { "empty.txt": "" }), "methods.db");
    const connection = asyncSQLiteConnectionOpenForTesting(file, 8);
    await connection.ready;
    try {
      const before = asyncSQLiteConnectionStatsForTesting().copiedRowValues;
      await expect(
        asyncSQLiteConnectionGetForTesting(connection.id, "SELECT 1 AS value UNION ALL SELECT 2 UNION ALL SELECT 3"),
      ).resolves.toEqual({ value: 1 });
      const copied = asyncSQLiteConnectionStatsForTesting().copiedRowValues - before;
      expect(copied).toBe(isDebug || isASAN ? 1 : 0);
    } finally {
      await asyncSQLiteConnectionCloseForTesting(connection.id);
    }
  });

  it("rejects a second executable get/all/values statement before either statement steps", async () => {
    const {
      asyncSQLiteConnectionOpenForTesting,
      asyncSQLiteConnectionExecForTesting,
      asyncSQLiteConnectionGetForTesting,
      asyncSQLiteConnectionAllForTesting,
      asyncSQLiteConnectionValuesForTesting,
      asyncSQLiteConnectionCloseForTesting,
    } = await import("bun:internal-for-testing");
    const file = path.join(tempDirWithFiles("sqlite-async-single-statement", { "empty.txt": "" }), "methods.db");
    const connection = asyncSQLiteConnectionOpenForTesting(file, 8);
    await connection.ready;
    try {
      await asyncSQLiteConnectionExecForTesting(connection.id, "CREATE TABLE t (value INTEGER)");
      for (const operation of [
        asyncSQLiteConnectionGetForTesting,
        asyncSQLiteConnectionAllForTesting,
        asyncSQLiteConnectionValuesForTesting,
      ]) {
        await expect(
          operation(connection.id, " /* lead */ INSERT INTO t VALUES (1) RETURNING value; INSERT INTO t VALUES (2)"),
        ).rejects.toThrow("exactly one executable statement");
      }
      expect(await asyncSQLiteConnectionAllForTesting(connection.id, "SELECT value FROM t")).toEqual([]);
      await expect(asyncSQLiteConnectionAllForTesting(connection.id, "SELECT 1; -- trailing only\n")).resolves.toEqual([
        { 1: 1 },
      ]);
    } finally {
      await asyncSQLiteConnectionCloseForTesting(connection.id);
    }
  });

  it("keeps run changes numeric while safeIntegers makes row IDs bigint", async () => {
    const {
      asyncSQLiteConnectionOpenForTesting,
      asyncSQLiteConnectionExecForTesting,
      asyncSQLiteConnectionRunForTesting,
      asyncSQLiteConnectionCloseForTesting,
    } = await import("bun:internal-for-testing");
    const dir = tempDirWithFiles("sqlite-async-run-safe-integers", { "empty.txt": "" });
    const defaultConnection = asyncSQLiteConnectionOpenForTesting(path.join(dir, "default.db"), 8);
    const safeConnection = asyncSQLiteConnectionOpenForTesting(path.join(dir, "safe.db"), 8, undefined, {
      safeIntegers: true,
    });
    await Promise.all([defaultConnection.ready, safeConnection.ready]);
    try {
      for (const connection of [defaultConnection, safeConnection])
        await asyncSQLiteConnectionExecForTesting(connection.id, "CREATE TABLE t (id INTEGER PRIMARY KEY)");
      const defaultResult = await asyncSQLiteConnectionRunForTesting(
        defaultConnection.id,
        "INSERT INTO t DEFAULT VALUES",
      );
      const safeResult = await asyncSQLiteConnectionRunForTesting(safeConnection.id, "INSERT INTO t DEFAULT VALUES");
      expect(defaultResult).toEqual({ changes: 1, lastInsertRowid: 1 });
      expect(safeResult).toEqual({ changes: 1, lastInsertRowid: 1n });
      expect(typeof defaultResult.changes).toBe("number");
      expect(typeof safeResult.changes).toBe("number");
    } finally {
      await Promise.all([
        asyncSQLiteConnectionCloseForTesting(defaultConnection.id),
        asyncSQLiteConnectionCloseForTesting(safeConnection.id),
      ]);
    }
  });

  it("keeps the FIFO usable after syntax and schema-change operations", async () => {
    const {
      asyncSQLiteConnectionOpenForTesting,
      asyncSQLiteConnectionExecForTesting,
      asyncSQLiteConnectionAllForTesting,
      asyncSQLiteConnectionCloseForTesting,
    } = await import("bun:internal-for-testing");
    const file = path.join(tempDirWithFiles("sqlite-async-method-recovery", { "empty.txt": "" }), "methods.db");
    const connection = asyncSQLiteConnectionOpenForTesting(file, 8);
    await connection.ready;
    try {
      await expect(asyncSQLiteConnectionAllForTesting(connection.id, "SELECT FROM")).rejects.toThrow(SQLiteError);
      await asyncSQLiteConnectionExecForTesting(connection.id, "CREATE TABLE t (value INTEGER)");
      await asyncSQLiteConnectionExecForTesting(connection.id, "ALTER TABLE t ADD COLUMN extra TEXT");
      await asyncSQLiteConnectionExecForTesting(connection.id, "INSERT INTO t VALUES (1, 'fresh')");
      await expect(asyncSQLiteConnectionAllForTesting(connection.id, "SELECT value, extra FROM t")).resolves.toEqual([
        { value: 1, extra: "fresh" },
      ]);
    } finally {
      await asyncSQLiteConnectionCloseForTesting(connection.id);
    }
  });
});

describe("AsyncDatabase (public Gate C)", () => {
  const asyncTmp = (name, files = { "empty.txt": "" }) => path.join(tempDirWithFiles(name, files), "async.db");

  it("exposes AsyncDatabase as an ESM named export and via CommonJS require", async () => {
    const esm = await import("bun:sqlite");
    expect(typeof esm.AsyncDatabase).toBe("function");
    const cjs = require("bun:sqlite");
    expect(typeof cjs.AsyncDatabase).toBe("function");
    expect(cjs.AsyncDatabase).toBe(esm.AsyncDatabase);
  });

  it("keeps the synchronous exports and default export unchanged", async () => {
    const mod = await import("bun:sqlite");
    expect(typeof mod.Database).toBe("function");
    expect(typeof mod.Statement).toBe("function");
    expect(typeof mod.SQLiteError).toBe("function");
    expect(mod.constants.SQLITE_OPEN_READWRITE).toBe(2);
    // The default export remains the synchronous Database class.
    expect(mod.default).toBe(mod.Database);
    const required = require("bun:sqlite");
    expect(required.Database).toBe(mod.Database);
    expect(required.Statement).toBe(mod.Statement);
    expect(required.SQLiteError).toBe(mod.SQLiteError);
    expect(required.default).toBe(mod.Database);
    expect(required.AsyncDatabase).toBe(mod.AsyncDatabase);
    // The synchronous Database is not an AsyncDatabase and vice versa.
    const sync = new Database(":memory:");
    expect(sync).not.toBeInstanceOf(mod.AsyncDatabase);
    sync.close();
  });

  it("cannot be constructed publicly; open() is the only construction path", async () => {
    const { AsyncDatabase } = await import("bun:sqlite");
    expect(() => new AsyncDatabase()).toThrow(TypeError);
    expect(() => new AsyncDatabase("forged", 0, ":memory:", 1)).toThrow(TypeError);
    expect(() => Reflect.construct(AsyncDatabase, [Symbol("bun:sqlite:async"), 0, ":memory:", 1])).toThrow(TypeError);
  });

  it("open() is observably asynchronous and resolves to an instance", async () => {
    const { AsyncDatabase } = await import("bun:sqlite");
    const pending = AsyncDatabase.open(":memory:");
    expect(pending).toBeInstanceOf(Promise);
    const db = await pending;
    expect(db).toBeInstanceOf(AsyncDatabase);
    expect(db.filename).toBe(":memory:");
    await db.close();
  });

  it("defaults the filename to an in-memory database", async () => {
    const { AsyncDatabase } = await import("bun:sqlite");
    await using db = await AsyncDatabase.open();
    expect(db.filename).toBe(":memory:");
    await db.exec("CREATE TABLE t (v INTEGER)");
    expect(await db.get("SELECT COUNT(*) AS n FROM t")).toEqual({ n: 0 });
  });

  it("exposes filename as a read-only property", async () => {
    const { AsyncDatabase } = await import("bun:sqlite");
    const file = asyncTmp("async-db-filename");
    await using db = await AsyncDatabase.open(file);
    expect(db.filename).toBe(file);
    expect(() => {
      "use strict";
      db.filename = "hacked";
    }).toThrow();
    expect(db.filename).toBe(file);
  });

  it("opens and persists a file-backed database", async () => {
    const { AsyncDatabase } = await import("bun:sqlite");
    const file = asyncTmp("async-db-file");
    {
      await using db = await AsyncDatabase.open(file);
      await db.exec("CREATE TABLE t (v INTEGER)");
      await db.run("INSERT INTO t VALUES (42)");
    }
    const reader = new Database(file, { readonly: true });
    try {
      expect(reader.query("SELECT v FROM t").get()).toEqual({ v: 42 });
    } finally {
      reader.close();
    }
  });

  it("opens read-only against an existing database and rejects writes", async () => {
    const { AsyncDatabase, SQLiteError } = await import("bun:sqlite");
    const file = asyncTmp("async-db-readonly");
    {
      const seed = new Database(file);
      seed.exec("CREATE TABLE t (v INTEGER)");
      seed.run("INSERT INTO t VALUES (7)");
      seed.close();
    }
    await using db = await AsyncDatabase.open(file, { readonly: true });
    expect(await db.get("SELECT v FROM t")).toEqual({ v: 7 });
    await expect(db.run("INSERT INTO t VALUES (8)")).rejects.toThrow(SQLiteError);
  });

  it("rejects opening an anonymous database read-only", async () => {
    const { AsyncDatabase } = await import("bun:sqlite");
    await expect(AsyncDatabase.open(":memory:", { readonly: true })).rejects.toThrow(/anonymous/);
  });

  it("rejects opening a missing file when create is false with SQLITE_CANTOPEN", async () => {
    const { AsyncDatabase } = await import("bun:sqlite");
    const missing = path.join(tempDirWithFiles("async-db-nocreate", { "empty.txt": "" }), "missing.db");
    let error;
    try {
      await AsyncDatabase.open(missing, { create: false, readwrite: true });
    } catch (e) {
      error = e;
    }
    expect(error).toBeDefined();
    expect(error.message).toBe("unable to open database file");
    expect(error.code).toBe("SQLITE_CANTOPEN");
  });

  it("validates open option types, ranges, and conflicting flags", async () => {
    const { AsyncDatabase } = await import("bun:sqlite");
    await expect(AsyncDatabase.open(":memory:", { readonly: true, readwrite: true })).rejects.toThrow();
    await expect(AsyncDatabase.open(":memory:", { readonly: true, create: true })).rejects.toThrow();
    await expect(AsyncDatabase.open(":memory:", { readonly: 1 })).rejects.toThrow(TypeError);
    await expect(AsyncDatabase.open(":memory:", { strict: "yes" })).rejects.toThrow(TypeError);
    await expect(AsyncDatabase.open(":memory:", { safeIntegers: 1 })).rejects.toThrow(TypeError);
    await expect(AsyncDatabase.open(":memory:", { busyTimeout: -1 })).rejects.toThrow(RangeError);
    await expect(AsyncDatabase.open(":memory:", { busyTimeout: 1.5 })).rejects.toThrow(RangeError);
    await expect(AsyncDatabase.open(":memory:", { busyTimeout: NaN })).rejects.toThrow(RangeError);
    await expect(AsyncDatabase.open(":memory:", { busyTimeout: Infinity })).rejects.toThrow(RangeError);
    await expect(AsyncDatabase.open(":memory:", { maxPending: 0 })).rejects.toThrow(RangeError);
    await expect(AsyncDatabase.open(":memory:", { maxPending: -3 })).rejects.toThrow(RangeError);
    await expect(AsyncDatabase.open(":memory:", { maxPending: 2.5 })).rejects.toThrow(RangeError);
    await expect(AsyncDatabase.open(":memory:", { maxPending: Infinity })).rejects.toThrow(RangeError);
    await expect(AsyncDatabase.open(1234)).rejects.toThrow(TypeError);
  });

  it("accepts busyTimeout of zero and normal values", async () => {
    const { AsyncDatabase } = await import("bun:sqlite");
    await using zero = await AsyncDatabase.open(":memory:", { busyTimeout: 0 });
    expect(zero).toBeInstanceOf(AsyncDatabase);
    await using normal = await AsyncDatabase.open(":memory:", { busyTimeout: 5000 });
    expect(normal).toBeInstanceOf(AsyncDatabase);
  });

  it("every method returns a Promise", async () => {
    const { AsyncDatabase } = await import("bun:sqlite");
    await using db = await AsyncDatabase.open(":memory:");
    await db.exec("CREATE TABLE t (v INTEGER)");
    await db.run("INSERT INTO t VALUES (1)");
    const calls = [
      db.exec("SELECT 1"),
      db.run("INSERT INTO t VALUES (2)"),
      db.get("SELECT v FROM t ORDER BY v"),
      db.all("SELECT v FROM t ORDER BY v"),
      db.values("SELECT v FROM t ORDER BY v"),
    ];
    for (const call of calls) expect(call).toBeInstanceOf(Promise);
    await Promise.all(calls);
  });

  it("materializes exec/run/get/all/values shapes matching sync semantics", async () => {
    const { AsyncDatabase } = await import("bun:sqlite");
    await using db = await AsyncDatabase.open(":memory:");
    expect(await db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)")).toBeUndefined();
    expect(await db.run("INSERT INTO t (v) VALUES (?)", ["a"])).toEqual({ changes: 1, lastInsertRowid: 1 });
    expect(await db.get("SELECT v FROM t WHERE id = ?", [1])).toEqual({ v: "a" });
    expect(await db.get("SELECT v FROM t WHERE id = ?", [999])).toBeNull();
    await db.run("INSERT INTO t (v) VALUES (?)", ["b"]);
    expect(await db.all("SELECT v FROM t ORDER BY id")).toEqual([{ v: "a" }, { v: "b" }]);
    expect(await db.values("SELECT v FROM t ORDER BY id")).toEqual([["a"], ["b"]]);
    expect(await db.all("SELECT v FROM t WHERE id = 999")).toEqual([]);
    expect(await db.values("SELECT v FROM t WHERE id = 999")).toEqual([]);
  });

  it("executes multi-statement scripts through exec", async () => {
    const { AsyncDatabase } = await import("bun:sqlite");
    await using db = await AsyncDatabase.open(":memory:");
    await db.exec("CREATE TABLE a (x INTEGER); CREATE TABLE b (y INTEGER); INSERT INTO a VALUES (1);");
    expect(await db.get("SELECT x FROM a")).toEqual({ x: 1 });
    expect(await db.all("SELECT y FROM b")).toEqual([]);
  });

  it("supports positional and named bindings", async () => {
    const { AsyncDatabase } = await import("bun:sqlite");
    await using db = await AsyncDatabase.open(":memory:", { strict: true });
    await db.exec("CREATE TABLE t (a INTEGER, b INTEGER)");
    await db.run("INSERT INTO t VALUES ($a, $b)", { a: 1, b: 2 });
    await db.run("INSERT INTO t VALUES (?, ?)", [3, 4]);
    expect(await db.all("SELECT a, b FROM t ORDER BY a")).toEqual([
      { a: 1, b: 2 },
      { a: 3, b: 4 },
    ]);
  });

  it("rejects invalid SQL, invalid bindings, and invalid argument types", async () => {
    const { AsyncDatabase, SQLiteError } = await import("bun:sqlite");
    await using db = await AsyncDatabase.open(":memory:");
    await db.exec("CREATE TABLE t (v INTEGER)");
    await expect(db.all("SELECT FROM")).rejects.toThrow(SQLiteError);
    await expect(db.get("this is not sql")).rejects.toThrow(SQLiteError);
    await expect(db.run("INSERT INTO t VALUES (?)", 5)).rejects.toThrow();
    await expect(db.run(123)).rejects.toThrow(TypeError);
    await expect(db.exec(null)).rejects.toThrow(TypeError);
  });

  it("rejects an invalid per-operation signal option as a Promise rejection", async () => {
    const { AsyncDatabase } = await import("bun:sqlite");
    await using db = await AsyncDatabase.open(":memory:");
    await db.exec("CREATE TABLE t (v INTEGER)");
    // A non-AbortSignal signal is a validation error surfaced as a rejection,
    // never a synchronous throw, and it must not admit or apply any work.
    await expect(db.run("INSERT INTO t VALUES (1)", [], { signal: {} })).rejects.toThrow();
    await expect(db.get("SELECT v FROM t", undefined, { signal: 123 })).rejects.toThrow();
    await expect(db.all("SELECT v FROM t", undefined, { signal: "nope" })).rejects.toThrow();
    expect(await db.get("SELECT COUNT(*) AS n FROM t")).toEqual({ n: 0 });
  });

  it("honors safeIntegers for bindings and results", async () => {
    const { AsyncDatabase } = await import("bun:sqlite");
    await using db = await AsyncDatabase.open(":memory:", { safeIntegers: true });
    await db.exec("CREATE TABLE t (v INTEGER)");
    await db.run("INSERT INTO t VALUES (?)", [9007199254740993n]);
    const row = await db.get("SELECT v FROM t");
    expect(typeof row.v).toBe("bigint");
    expect(row.v).toBe(9007199254740993n);
  });

  it("enforces the maxPending boundary: at the limit succeeds, one over rejects", async () => {
    const { AsyncDatabase } = await import("bun:sqlite");
    const file = asyncTmp("async-db-maxpending");
    await using db = await AsyncDatabase.open(file, { maxPending: 1, busyTimeout: 60000 });
    await db.exec("CREATE TABLE t (v INTEGER)");
    const blocker = new Database(file);
    try {
      blocker.exec("BEGIN IMMEDIATE");
      const active = db.run("INSERT INTO t VALUES (1)");
      await expect(db.run("INSERT INTO t VALUES (2)")).rejects.toThrow(/pending/i);
      blocker.exec("COMMIT");
      await expect(active).resolves.toEqual({ changes: 1, lastInsertRowid: 1 });
      // The rejected op never executed, so the next rowid is 2, not 3.
      await expect(db.run("INSERT INTO t VALUES (3)")).resolves.toEqual({ changes: 1, lastInsertRowid: 2 });
    } finally {
      blocker.close();
    }
  });

  it("close is idempotent, returns coherent promises, and fences later work", async () => {
    const { AsyncDatabase } = await import("bun:sqlite");
    const db = await AsyncDatabase.open(":memory:");
    await db.exec("CREATE TABLE t (v INTEGER)");
    const first = db.close();
    const second = db.close();
    expect(first).toBeInstanceOf(Promise);
    expect(second).toBeInstanceOf(Promise);
    await Promise.all([first, second]);
    await db.close();
    await expect(db.run("INSERT INTO t VALUES (1)")).rejects.toThrow();
    await expect(db.exec("SELECT 1")).rejects.toThrow();
  });

  it("close fences admission immediately while draining accepted work", async () => {
    const { AsyncDatabase } = await import("bun:sqlite");
    await using outer = await AsyncDatabase.open(":memory:");
    await outer.exec("CREATE TABLE seed (v INTEGER)");
    const db = await AsyncDatabase.open(asyncTmp("async-db-fence"));
    await db.exec("CREATE TABLE t (v INTEGER)");
    const accepted = db.run("INSERT INTO t VALUES (1)");
    const closing = db.close();
    await expect(db.run("INSERT INTO t VALUES (2)")).rejects.toThrow();
    await expect(accepted).resolves.toEqual({ changes: 1, lastInsertRowid: 1 });
    await closing;
  });

  it("[Symbol.asyncDispose] closes the database", async () => {
    const { AsyncDatabase } = await import("bun:sqlite");
    let escaped;
    {
      await using db = await AsyncDatabase.open(":memory:");
      escaped = db;
      await db.exec("CREATE TABLE t (v INTEGER)");
      expect(await db.get("SELECT 1 AS one")).toEqual({ one: 1 });
    }
    await expect(escaped.run("INSERT INTO t VALUES (1)")).rejects.toThrow();
  });
});

describe("AsyncDatabase lifecycle (Gate C validation)", () => {
  const asyncTmp = (name, files = { "empty.txt": "" }) => path.join(tempDirWithFiles(name, files), "async.db");

  // Runs a Bun subprocess script and drains stdout, stderr, and exit concurrently.
  const runScript = async (files, { env = {}, cmd = ["main.js"] } = {}) => {
    const dir = tempDirWithFiles("sqlite-async-lifecycle-proc", files);
    await using proc = Bun.spawn({
      cmd: [bunExe(), ...cmd],
      cwd: dir,
      env: { ...bunEnv, ...env },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { dir, stdout, stderr, exitCode };
  };

  it("keeps the event loop responsive while a public write waits on a contended lock", async () => {
    const { AsyncDatabase } = await import("bun:sqlite");
    const file = asyncTmp("async-db-responsive");
    {
      const seed = new Database(file);
      seed.exec("CREATE TABLE t (v INTEGER)");
      seed.close();
    }
    await using db = await AsyncDatabase.open(file, { busyTimeout: 60000 });
    const blocker = new Database(file);
    blocker.exec("BEGIN IMMEDIATE");
    blocker.run("INSERT INTO t VALUES (1)"); // hold the write lock

    const order = [];
    // The write is admitted and blocks on the write lock inside a worker thread.
    const write = db.run("INSERT INTO t VALUES (2)");
    // The JS event loop must stay free to run scheduled work; that work releases
    // the lock. No elapsed-time assertions or sleeps are used.
    queueMicrotask(() => order.push("microtask"));
    setImmediate(() => {
      order.push("release");
      blocker.exec("COMMIT");
      blocker.close();
    });

    const result = await write;
    expect(result).toEqual({ changes: 1, lastInsertRowid: 2 });
    // The contended write could only resolve after the event-loop task committed,
    // proving the loop processed queued work while the worker was blocked.
    expect(order).toEqual(["microtask", "release"]);
    expect(await db.get("SELECT COUNT(*) AS n FROM t")).toEqual({ n: 2 });
  });

  it("runs one connection's operations in FIFO submission order with one active at a time", async () => {
    const { AsyncDatabase } = await import("bun:sqlite");
    await using db = await AsyncDatabase.open(":memory:");
    await db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY AUTOINCREMENT, tag TEXT)");
    const tags = ["a", "b", "c", "d", "e"];
    const results = await Promise.all(tags.map(tag => db.run("INSERT INTO t (tag) VALUES (?)", [tag])));
    // Row IDs are assigned in execution order; FIFO makes them match submission order.
    expect(results.map(r => Number(r.lastInsertRowid))).toEqual([1, 2, 3, 4, 5]);
    expect(await db.all("SELECT tag FROM t ORDER BY id")).toEqual(tags.map(tag => ({ tag })));
  });

  it("keeps the FIFO ordered and usable after a failed public operation", async () => {
    const { AsyncDatabase, SQLiteError } = await import("bun:sqlite");
    await using db = await AsyncDatabase.open(":memory:");
    await db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY AUTOINCREMENT, v INTEGER)");
    const first = db.run("INSERT INTO t (v) VALUES (10)");
    const failing = db.run("INSERT INTO missing VALUES (1)").then(
      () => {
        throw new Error("expected failure");
      },
      error => error,
    );
    const third = db.run("INSERT INTO t (v) VALUES (20)");
    const [r1, err, r3] = await Promise.all([first, failing, third]);
    expect(Number(r1.lastInsertRowid)).toBe(1);
    expect(err).toBeInstanceOf(SQLiteError);
    expect(Number(r3.lastInsertRowid)).toBe(2);
    // The failed operation never applied and never displaced the ordering.
    expect(await db.all("SELECT v FROM t ORDER BY id")).toEqual([{ v: 10 }, { v: 20 }]);
  });

  it("lets an independent AsyncDatabase make progress while another blocks on a lock", async () => {
    const { AsyncDatabase } = await import("bun:sqlite");
    const fileA = asyncTmp("async-db-overlap");
    {
      const seed = new Database(fileA);
      seed.exec("CREATE TABLE t (v INTEGER)");
      seed.close();
    }
    await using a = await AsyncDatabase.open(fileA, { busyTimeout: 60000 });
    await using b = await AsyncDatabase.open(":memory:");
    await b.exec("CREATE TABLE t (v INTEGER)");

    const blocker = new Database(fileA);
    try {
      blocker.exec("BEGIN IMMEDIATE");
      blocker.run("INSERT INTO t VALUES (99)"); // holds fileA's write lock

      // a's write is admitted and blocks on the lock inside one worker thread.
      const aWrite = a.run("INSERT INTO t VALUES (1)");
      // b runs on an independent connection; the WorkPool has >= 2 threads, so b's
      // result must land while a is still blocked.
      expect(await b.run("INSERT INTO t VALUES (2)")).toEqual({ changes: 1, lastInsertRowid: 1 });
      expect(await b.get("SELECT v FROM t")).toEqual({ v: 2 });

      // Release a; it now completes too.
      blocker.exec("COMMIT");
      await aWrite;
      expect(await a.get("SELECT COUNT(*) AS n FROM t")).toEqual({ n: 2 });
    } finally {
      // Always release the lock (closing rolls back any open transaction) so a's
      // pending write can drain during disposal even if an assertion above throws.
      blocker.close();
    }
  });

  it("releases owned native rows, results, and requests after teardown of a result-producing op", async () => {
    const { AsyncDatabase } = await import("bun:sqlite");
    const { asyncSQLiteConnectionStatsForTesting } = await import("bun:internal-for-testing");
    const file = asyncTmp("async-db-owned-drop");
    {
      const seed = new Database(file);
      seed.exec("CREATE TABLE t (v INTEGER)");
      for (let i = 0; i < 200; i++) seed.run("INSERT INTO t VALUES (?)", [i]);
      seed.close();
    }
    const baseline = asyncSQLiteConnectionStatsForTesting();
    {
      await using db = await AsyncDatabase.open(file);
      // A result-producing operation materializes owned rows, then the database is
      // torn down (await using -> close) while its owned payloads must be released.
      expect((await db.all("SELECT v FROM t ORDER BY v")).length).toBe(200);
      expect(await db.get("SELECT COUNT(*) AS n FROM t")).toEqual({ n: 200 });
      await expect(db.get("this is not sql")).rejects.toThrow();
    }
    await waitForAsyncSQLiteStats(
      asyncSQLiteConnectionStatsForTesting,
      current =>
        current.liveConnections === baseline.liveConnections &&
        current.liveRows === baseline.liveRows &&
        current.liveErrors === baseline.liveErrors &&
        current.liveResults === baseline.liveResults &&
        current.liveRequests === baseline.liveRequests &&
        current.liveJobs === baseline.liveJobs,
      "owned async SQLite native state did not return to baseline after teardown",
    );
    const after = asyncSQLiteConnectionStatsForTesting();
    expect(after.liveRows).toBe(baseline.liveRows);
    expect(after.liveErrors).toBe(baseline.liveErrors);
    expect(after.liveResults).toBe(baseline.liveResults);
    expect(after.liveRequests).toBe(baseline.liveRequests);
    expect(after.liveJobs).toBe(baseline.liveJobs);
    expect(after.liveConnections).toBe(baseline.liveConnections);
  });

  it("abandons active and queued public operations when workers terminate, without leaking", async () => {
    const { asyncSQLiteConnectionStatsForTesting } = await import("bun:internal-for-testing");
    const { Worker } = await import("node:worker_threads");
    const rounds = isASAN || isDebug ? 2 : 5;
    const dir = tempDirWithFiles("sqlite-async-public-worker-teardown", {
      "worker.js": `
        import { parentPort, workerData } from "node:worker_threads";
        import { AsyncDatabase } from "bun:sqlite";
        const db = await AsyncDatabase.open(workerData, { maxPending: 8, busyTimeout: 60000 });
        const active = db.run("INSERT INTO gate VALUES (1)"); // blocks on the parent's lock
        const queued = db.run("INSERT INTO gate VALUES (2)"); // queued behind the active op
        active.catch(() => {});
        queued.catch(() => {});
        parentPort.postMessage("submitted");
        await new Promise(() => {}); // never resolve; the parent terminates this worker
      `,
    });
    const file = path.join(dir, "gate.db");
    const blocker = new Database(file);
    try {
      blocker.exec("CREATE TABLE gate (value INTEGER)");
      for (let round = 0; round < rounds; round++) {
        blocker.exec("BEGIN IMMEDIATE");
        blocker.run("INSERT INTO gate VALUES (0)"); // hold the write lock
        const baseline = asyncSQLiteConnectionStatsForTesting();
        const worker = new Worker(path.join(dir, "worker.js"), { type: "module", workerData: file });
        try {
          await new Promise((resolve, reject) => {
            worker.once("message", resolve);
            worker.once("error", reject);
            worker.once("exit", code => reject(new Error(`worker exited before submitting work: ${code}`)));
          });
          await waitForAsyncSQLiteStats(
            asyncSQLiteConnectionStatsForTesting,
            current => current.activeConnectionOperations === baseline.activeConnectionOperations + 1,
            "worker did not publish an active public operation",
          );
          await worker.terminate();
        } finally {
          await worker.terminate();
        }
        blocker.exec("COMMIT");
        await waitForAsyncSQLiteStats(
          asyncSQLiteConnectionStatsForTesting,
          current =>
            current.liveConnections === baseline.liveConnections &&
            current.liveJobs === baseline.liveJobs &&
            current.liveResults === baseline.liveResults &&
            current.liveRequests === baseline.liveRequests &&
            current.activeConnectionOperations === baseline.activeConnectionOperations,
          "worker teardown leaked public connection state",
        );
        const final = asyncSQLiteConnectionStatsForTesting();
        expect(final.liveConnections).toBe(baseline.liveConnections);
        expect(final.liveJobs).toBe(baseline.liveJobs);
        expect(final.liveResults).toBe(baseline.liveResults);
        expect(final.liveRequests).toBe(baseline.liveRequests);
        expect(final.activeConnectionOperations).toBe(baseline.activeConnectionOperations);
        expect(final.connectionInterrupts).toBe(baseline.connectionInterrupts + 1);
        expect(final.physicalCloses).toBe(baseline.physicalCloses + 1);
        // The interrupted and queued writes must never have been applied.
        expect(blocker.query("SELECT COUNT(*) AS n FROM gate WHERE value IN (1, 2)").get()).toEqual({ n: 0 });
        blocker.exec("DELETE FROM gate");
      }
    } finally {
      blocker.close();
    }
  }, 30000);

  it("keeps an accepted unawaited write alive across a natural process exit", async () => {
    const { dir, stdout, stderr, exitCode } = await runScript({
      "main.js": `
        import { AsyncDatabase } from "bun:sqlite";
        const db = await AsyncDatabase.open("data.db");
        await db.exec("CREATE TABLE IF NOT EXISTS t (v INTEGER)");
        // Fire-and-forget: never awaited, never closed. The pending op refs the
        // event loop, so a natural process exit must still let it complete.
        db.run("INSERT INTO t VALUES (4242)");
        console.log("SUBMITTED");
      `,
    });
    expect({ stdout: stdout.trim(), stderr, exitCode }).toMatchObject({ stdout: "SUBMITTED", exitCode: 0 });
    const reader = new Database(path.join(dir, "data.db"), { readonly: true });
    try {
      expect(reader.query("SELECT v FROM t").get()).toEqual({ v: 4242 });
    } finally {
      reader.close();
    }
  }, 30000);

  it("survives an explicit process.exit while a public write is in flight", async () => {
    const { stdout, stderr, exitCode } = await runScript({
      "main.js": `
        import { AsyncDatabase } from "bun:sqlite";
        const db = await AsyncDatabase.open("data.db");
        await db.exec("CREATE TABLE IF NOT EXISTS t (v INTEGER)");
        db.run("INSERT INTO t VALUES (1)"); // in flight
        console.log("EXITING");
        process.exit(0); // the abandon path must drop in-flight work without a crash
      `,
    });
    // Under debug + ASAN a use-after-free on abrupt teardown would abort with a
    // nonzero exit; a clean exit is the assertion.
    expect({ stdout: stdout.trim(), exitCode }).toMatchObject({ stdout: "EXITING", exitCode: 0 });
    expect(stderr).not.toContain("Sanitizer");
  }, 30000);

  it("reaps a dropped AsyncDatabase via finalization without leaking or double-closing", async () => {
    const { stdout, stderr, exitCode } = await runScript(
      {
        "main.js": `
          import { AsyncDatabase } from "bun:sqlite";
          const { asyncSQLiteConnectionStatsForTesting } = await import("bun:internal-for-testing");
          const yieldLoop = () => new Promise(resolve => setImmediate(resolve));
          const settle = async () => {
            for (let i = 0; i < 4; i++) { Bun.gc(true); await yieldLoop(); }
          };

          const baseline = asyncSQLiteConnectionStatsForTesting();

          // (a) explicit close, then drop the wrapper + GC. The finalizer was
          // unregistered by close(), so it must NOT run a second physical close.
          {
            const db = await AsyncDatabase.open("close.db");
            await db.exec("CREATE TABLE IF NOT EXISTS t (v INTEGER)");
            await db.run("INSERT INTO t VALUES (1)");
            await db.close();
          }
          await settle();
          const afterExplicit = asyncSQLiteConnectionStatsForTesting();

          // (b) drop the wrapper WITHOUT close(); finalization must reap the
          // still-open native connection under forced GC while queued/ran work.
          {
            const db = await AsyncDatabase.open("drop.db");
            await db.exec("CREATE TABLE IF NOT EXISTS t (v INTEGER)");
            await db.run("INSERT INTO t VALUES (1)");
          }
          for (let i = 0; i < 200; i++) {
            await settle();
            if (asyncSQLiteConnectionStatsForTesting().liveConnections === baseline.liveConnections) break;
          }
          const after = asyncSQLiteConnectionStatsForTesting();

          console.log(JSON.stringify({
            explicitLeakedConnections: afterExplicit.liveConnections - baseline.liveConnections,
            explicitCloses: afterExplicit.physicalCloses - baseline.physicalCloses,
            leakedConnections: after.liveConnections - baseline.liveConnections,
            leakedJobs: after.liveJobs - baseline.liveJobs,
            leakedResults: after.liveResults - baseline.liveResults,
            leakedRequests: after.liveRequests - baseline.liveRequests,
          }));
        `,
      },
      { env: { BUN_DESTRUCT_VM_ON_EXIT: "1" } },
    );
    expect({ stderr, exitCode }).toMatchObject({ exitCode: 0 });
    expect(stderr).not.toContain("Sanitizer");
    const summary = JSON.parse(stdout.trim().split("\n").at(-1));
    // Explicit close performed exactly one physical close and left nothing alive.
    expect(summary.explicitLeakedConnections).toBe(0);
    expect(summary.explicitCloses).toBe(1);
    // The dropped-without-close connection was reaped; nothing native leaked.
    expect(summary.leakedConnections).toBe(0);
    expect(summary.leakedJobs).toBe(0);
    expect(summary.leakedResults).toBe(0);
    expect(summary.leakedRequests).toBe(0);
  }, 30000);

  it("runs a full public open/work/close lifecycle inside a Worker and tears down cleanly", async () => {
    const { stdout, stderr, exitCode } = await runScript(
      {
        "main.js": `
          import { Worker } from "node:worker_threads";
          const worker = new Worker(new URL("./worker.js", import.meta.url), { type: "module", workerData: "worker.db" });
          const result = await new Promise((resolve, reject) => {
            let value;
            worker.once("message", message => { value = message; });
            worker.once("error", reject);
            worker.once("exit", code => resolve({ value, code }));
          });
          console.log(JSON.stringify(result));
        `,
        "worker.js": `
          import { parentPort, workerData } from "node:worker_threads";
          import { AsyncDatabase } from "bun:sqlite";
          const db = await AsyncDatabase.open(workerData);
          await db.exec("CREATE TABLE IF NOT EXISTS t (v INTEGER)");
          await db.run("INSERT INTO t VALUES (7)");
          const row = await db.get("SELECT v FROM t");
          await db.close();
          parentPort.postMessage(row.v);
          // No pending work remains; release the port so the Worker exits naturally.
          parentPort.close();
        `,
      },
      { env: { BUN_DESTRUCT_VM_ON_EXIT: "1" } },
    );
    expect({ stderr, exitCode }).toMatchObject({ exitCode: 0 });
    expect(stderr).not.toContain("Sanitizer");
    const result = JSON.parse(stdout.trim().split("\n").at(-1));
    expect(result).toEqual({ value: 7, code: 0 });
  }, 30000);
});

describe("AsyncDatabase cancellation (Gate D)", () => {
  const cancelTmp = (name, files = { "empty.txt": "" }) => path.join(tempDirWithFiles(name, files), "cancel.db");

  // Opens a synchronous blocker that holds the write lock via BEGIN IMMEDIATE so
  // that a subsequent async write becomes deterministically active-but-blocked.
  const withWriteLock = fn => {
    return async (...args) => {
      const file = cancelTmp("async-cancel");
      const blocker = new Database(file);
      blocker.exec("CREATE TABLE t (v INTEGER)");
      blocker.exec("BEGIN IMMEDIATE");
      blocker.run("INSERT INTO t VALUES (0)"); // hold the write lock
      try {
        return await fn({ file, blocker }, ...args);
      } finally {
        try {
          blocker.exec("COMMIT");
        } catch {}
        blocker.close();
      }
    };
  };

  const waitForActive = async (stats, baseline, delta = 1) =>
    waitForAsyncSQLiteStats(
      stats,
      current => current.activeConnectionOperations === baseline.activeConnectionOperations + delta,
      "an active connection operation never became visible",
    );

  it("rejects an already-aborted signal without admitting the operation", async () => {
    const { AsyncDatabase } = await import("bun:sqlite");
    await using db = await AsyncDatabase.open(":memory:");
    await db.exec("CREATE TABLE t (v INTEGER)");
    const reason = new Error("gone before it began");
    const controller = new AbortController();
    controller.abort(reason);
    // The rejection is the signal's own reason and the write never executed.
    await expect(db.run("INSERT INTO t VALUES (1)", [], { signal: controller.signal })).rejects.toBe(reason);
    await expect(db.get("SELECT v FROM t", undefined, { signal: controller.signal })).rejects.toBe(reason);
    expect(await db.get("SELECT COUNT(*) AS n FROM t")).toEqual({ n: 0 });
  });

  it("rejects an already-aborted default signal with an AbortError", async () => {
    const { AsyncDatabase } = await import("bun:sqlite");
    await using db = await AsyncDatabase.open(":memory:");
    await db.exec("CREATE TABLE t (v INTEGER)");
    const controller = new AbortController();
    controller.abort();
    const error = await db.run("INSERT INTO t VALUES (1)", [], { signal: controller.signal }).catch(e => e);
    expect(error).toBe(controller.signal.reason);
    expect(error.name).toBe("AbortError");
    expect(await db.get("SELECT COUNT(*) AS n FROM t")).toEqual({ n: 0 });
  });

  it(
    "removes a queued operation on abort so it never enters SQLite, keeping the FIFO usable",
    withWriteLock(async ({ file, blocker }) => {
      const { asyncSQLiteConnectionStatsForTesting } = await import("bun:internal-for-testing");
      const { AsyncDatabase } = await import("bun:sqlite");
      await using db = await AsyncDatabase.open(file, { busyTimeout: 60000 });
      const baseline = asyncSQLiteConnectionStatsForTesting();

      const active = db.run("INSERT INTO t VALUES (1)"); // becomes active, blocks on the lock
      active.catch(() => {});
      await waitForActive(asyncSQLiteConnectionStatsForTesting, baseline);

      const controller = new AbortController();
      const queued = db.run("INSERT INTO t VALUES (2)", [], { signal: controller.signal }); // queued behind active
      queued.catch(() => {});
      const reason = new Error("cancel the queued write");
      controller.abort(reason);
      await expect(queued).rejects.toBe(reason);
      // No interrupt was issued: the queued op was erased, not stepped.
      expect(asyncSQLiteConnectionStatsForTesting().connectionInterrupts).toBe(baseline.connectionInterrupts);

      blocker.exec("COMMIT"); // release the lock so the active op finishes
      await active;
      // FIFO remains usable and the cancelled write was never applied.
      await db.run("INSERT INTO t VALUES (3)");
      expect(await db.get("SELECT COUNT(*) AS n FROM t WHERE v = 2")).toEqual({ n: 0 });
      expect(await db.all("SELECT v FROM t WHERE v IN (1, 3) ORDER BY v")).toEqual([{ v: 1 }, { v: 3 }]);
    }),
  );

  it(
    "interrupts a running operation that is waiting on a contended lock",
    withWriteLock(async ({ file, blocker }) => {
      const { asyncSQLiteConnectionStatsForTesting } = await import("bun:internal-for-testing");
      const { AsyncDatabase } = await import("bun:sqlite");
      await using db = await AsyncDatabase.open(file, { busyTimeout: 60000 });
      const baseline = asyncSQLiteConnectionStatsForTesting();

      const controller = new AbortController();
      const running = db.run("INSERT INTO t VALUES (1)", [], { signal: controller.signal });
      running.catch(() => {});
      await waitForActive(asyncSQLiteConnectionStatsForTesting, baseline);

      controller.abort();
      const error = await running.catch(e => e);
      expect(error).toBe(controller.signal.reason);
      expect(asyncSQLiteConnectionStatsForTesting().connectionInterrupts).toBe(baseline.connectionInterrupts + 1);

      // The connection survives the interrupt and remains usable.
      blocker.exec("COMMIT");
      await db.run("INSERT INTO t VALUES (5)");
      expect(await db.get("SELECT COUNT(*) AS n FROM t WHERE v = 5")).toEqual({ n: 1 });
    }),
  );

  it("interrupts a running recursive query and keeps the connection usable", async () => {
    const { asyncSQLiteConnectionStatsForTesting } = await import("bun:internal-for-testing");
    const { AsyncDatabase } = await import("bun:sqlite");
    await using db = await AsyncDatabase.open(":memory:");
    await db.exec("CREATE TABLE t (v INTEGER)");
    const baseline = asyncSQLiteConnectionStatsForTesting();

    const controller = new AbortController();
    // An unbounded recursive CTE steps forever until sqlite3_interrupt lands.
    const runaway = db.get(
      "WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c) SELECT count(*) AS n FROM c",
      undefined,
      { signal: controller.signal },
    );
    runaway.catch(() => {});
    await waitForActive(asyncSQLiteConnectionStatsForTesting, baseline);

    controller.abort();
    await expect(runaway).rejects.toBe(controller.signal.reason);
    expect(asyncSQLiteConnectionStatsForTesting().connectionInterrupts).toBe(baseline.connectionInterrupts + 1);

    // A fresh query after the interrupt succeeds: the connection is intact.
    await db.run("INSERT INTO t VALUES (9)");
    expect(await db.get("SELECT v FROM t")).toEqual({ v: 9 });
  });

  it("lets a completion win when it settles before the abort (abort after settle is a no-op)", async () => {
    const { AsyncDatabase } = await import("bun:sqlite");
    await using db = await AsyncDatabase.open(":memory:");
    await db.exec("CREATE TABLE t (v INTEGER)");
    const controller = new AbortController();
    // The op completes fast; awaiting resolves before we abort.
    const value = await db.run("INSERT INTO t VALUES (1)", [], { signal: controller.signal });
    expect(value).toMatchObject({ changes: 1 });
    // Aborting an already-settled operation must not throw or double-settle.
    controller.abort();
    expect(await db.get("SELECT v FROM t")).toEqual({ v: 1 });
  });

  it(
    "aborting operation N never disturbs operation N+1 and a later query still succeeds",
    withWriteLock(async ({ file, blocker }) => {
      const { asyncSQLiteConnectionStatsForTesting } = await import("bun:internal-for-testing");
      const { AsyncDatabase } = await import("bun:sqlite");
      await using db = await AsyncDatabase.open(file, { busyTimeout: 60000 });
      const baseline = asyncSQLiteConnectionStatsForTesting();

      const active = db.run("INSERT INTO t VALUES (1)"); // active, blocked on the lock
      active.catch(() => {});
      await waitForActive(asyncSQLiteConnectionStatsForTesting, baseline);

      const controller = new AbortController();
      const n = db.run("INSERT INTO t VALUES (2)", [], { signal: controller.signal }); // queued: N
      const nPlus1 = db.run("INSERT INTO t VALUES (3)"); // queued: N+1
      n.catch(() => {});
      controller.abort();
      await expect(n).rejects.toThrow();

      blocker.exec("COMMIT");
      await Promise.all([active, nPlus1]); // both survive N's cancellation
      const rows = await db.all("SELECT v FROM t WHERE v > 0 ORDER BY v");
      expect(rows).toEqual([{ v: 1 }, { v: 3 }]); // N (value 2) never applied
    }),
  );

  it(
    "settles a running abort cleanly when close() races the interrupt",
    withWriteLock(async ({ file, blocker }) => {
      const { asyncSQLiteConnectionStatsForTesting } = await import("bun:internal-for-testing");
      const { AsyncDatabase } = await import("bun:sqlite");
      const db = await AsyncDatabase.open(file, { busyTimeout: 60000 });
      const baseline = asyncSQLiteConnectionStatsForTesting();

      const controller = new AbortController();
      const running = db.run("INSERT INTO t VALUES (1)", [], { signal: controller.signal });
      running.catch(() => {});
      await waitForActive(asyncSQLiteConnectionStatsForTesting, baseline);

      const closing = db.close(); // fences admission; the physical close waits for the active op
      controller.abort(); // interrupt races the close
      await expect(running).rejects.toThrow();
      blocker.exec("COMMIT");
      await closing; // close resolves exactly once with no crash
      await expect(db.run("INSERT INTO t VALUES (2)")).rejects.toThrow();
    }),
  );

  it("cleans up abort listeners and pending requests on every terminal path", async () => {
    const { asyncSQLiteTaskStatsForTesting, asyncSQLiteConnectionStatsForTesting } = await import(
      "bun:internal-for-testing"
    );
    const { AsyncDatabase } = await import("bun:sqlite");
    await using db = await AsyncDatabase.open(":memory:");
    await db.exec("CREATE TABLE t (v INTEGER)");
    const baseline = asyncSQLiteTaskStatsForTesting();

    // (a) success with a never-fired signal: the algorithm is removed on resolve.
    {
      const controller = new AbortController();
      await db.run("INSERT INTO t VALUES (1)", [], { signal: controller.signal });
    }
    // (b) running interrupt: the algorithm is removed on the abort settlement.
    {
      const controller = new AbortController();
      const connBaseline = asyncSQLiteConnectionStatsForTesting();
      const runaway = db.get(
        "WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c) SELECT count(*) AS n FROM c",
        undefined,
        { signal: controller.signal },
      );
      runaway.catch(() => {});
      await waitForActive(asyncSQLiteConnectionStatsForTesting, connBaseline);
      controller.abort();
      await expect(runaway).rejects.toThrow();
    }
    // (c) already-aborted: no algorithm/request is ever retained.
    {
      const controller = new AbortController();
      controller.abort();
      await expect(db.get("SELECT 1", undefined, { signal: controller.signal })).rejects.toThrow();
    }

    await waitForAsyncSQLiteStats(
      asyncSQLiteTaskStatsForTesting,
      current =>
        current.liveAbortAlgorithms === baseline.liveAbortAlgorithms && current.liveRequests === baseline.liveRequests,
      "cancellation leaked abort algorithms or pending requests",
    );
    const final = asyncSQLiteTaskStatsForTesting();
    expect(final.liveAbortAlgorithms).toBe(baseline.liveAbortAlgorithms);
    expect(final.liveRequests).toBe(baseline.liveRequests);
  });

  it("interrupts a write and leaves the connection usable without assuming rollback", async () => {
    const { asyncSQLiteConnectionStatsForTesting } = await import("bun:internal-for-testing");
    const { AsyncDatabase } = await import("bun:sqlite");
    const file = cancelTmp("async-cancel-tx");
    await using db = await AsyncDatabase.open(file);
    await db.exec("CREATE TABLE t (v INTEGER)");
    await db.exec("BEGIN"); // explicit transaction
    const baseline = asyncSQLiteConnectionStatsForTesting();

    const controller = new AbortController();
    // A long recursive INSERT inside the open transaction, interrupted mid-write.
    const write = db.run(
      "INSERT INTO t SELECT x FROM (WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c) SELECT x FROM c)",
      [],
      { signal: controller.signal },
    );
    write.catch(() => {});
    await waitForActive(asyncSQLiteConnectionStatsForTesting, baseline);
    controller.abort();
    await expect(write).rejects.toThrow();

    // Observe the ACTUAL post-interrupt state instead of assuming a rollback:
    // finish the transaction (whichever way the engine left it) and confirm the
    // connection is fully usable afterwards.
    await db.exec("ROLLBACK").catch(() => db.exec("COMMIT").catch(() => {}));
    await db.exec("DELETE FROM t");
    await db.run("INSERT INTO t VALUES (42)");
    expect(await db.get("SELECT v FROM t")).toEqual({ v: 42 });

    const reader = new Database(file, { readonly: true });
    try {
      expect(reader.query("SELECT v FROM t").get()).toEqual({ v: 42 });
    } finally {
      reader.close();
    }
  });

  it("tears down a Worker with signalled active and queued work without leaking", async () => {
    const { asyncSQLiteConnectionStatsForTesting } = await import("bun:internal-for-testing");
    const { Worker } = await import("node:worker_threads");
    const rounds = isASAN || isDebug ? 2 : 4;
    const dir = tempDirWithFiles("sqlite-async-cancel-worker-teardown", {
      "worker.js": `
        import { parentPort, workerData } from "node:worker_threads";
        import { AsyncDatabase } from "bun:sqlite";
        const db = await AsyncDatabase.open(workerData, { maxPending: 8, busyTimeout: 60000 });
        const activeController = new AbortController();
        const queuedController = new AbortController();
        const active = db.run("INSERT INTO gate VALUES (1)", [], { signal: activeController.signal });
        const queued = db.run("INSERT INTO gate VALUES (2)", [], { signal: queuedController.signal });
        active.catch(() => {});
        queued.catch(() => {});
        parentPort.postMessage("submitted");
        await new Promise(() => {}); // never resolves; the parent terminates this worker
      `,
    });
    const file = path.join(dir, "gate.db");
    const blocker = new Database(file);
    try {
      blocker.exec("CREATE TABLE gate (value INTEGER)");
      for (let round = 0; round < rounds; round++) {
        blocker.exec("BEGIN IMMEDIATE");
        blocker.run("INSERT INTO gate VALUES (0)"); // hold the write lock
        const baseline = asyncSQLiteConnectionStatsForTesting();
        const worker = new Worker(path.join(dir, "worker.js"), { type: "module", workerData: file });
        try {
          await new Promise((resolve, reject) => {
            worker.once("message", resolve);
            worker.once("error", reject);
            worker.once("exit", code => reject(new Error(`worker exited before submitting work: ${code}`)));
          });
          await waitForActive(asyncSQLiteConnectionStatsForTesting, baseline);
          await worker.terminate();
        } finally {
          await worker.terminate();
        }
        blocker.exec("COMMIT");
        await waitForAsyncSQLiteStats(
          asyncSQLiteConnectionStatsForTesting,
          current =>
            current.liveConnections === baseline.liveConnections &&
            current.liveJobs === baseline.liveJobs &&
            current.liveResults === baseline.liveResults &&
            current.liveRequests === baseline.liveRequests,
          "worker teardown with signals leaked connection state",
        );
        const final = asyncSQLiteConnectionStatsForTesting();
        expect(final.liveConnections).toBe(baseline.liveConnections);
        expect(final.liveRequests).toBe(baseline.liveRequests);
        // Neither the interrupted nor the queued signalled write was applied.
        expect(blocker.query("SELECT COUNT(*) AS n FROM gate WHERE value IN (1, 2)").get()).toEqual({ n: 0 });
        blocker.exec("DELETE FROM gate");
      }
    } finally {
      blocker.close();
    }
  }, 30000);
});

describe("safeIntegers", () => {
  it("should default to false", () => {
    const db = Database.open(":memory:");
    db.exec("CREATE TABLE foo (id INTEGER PRIMARY KEY AUTOINCREMENT, age INTEGER NOT NULL)");
    db.run("INSERT INTO foo (age) VALUES (?)", BigInt(Number.MAX_SAFE_INTEGER) + 10n);
    const query = db.query("SELECT * FROM foo");
    expect(query.all()).toEqual([{ id: 1, age: Number.MAX_SAFE_INTEGER + 10 }]);
    query.safeIntegers(true);
    expect(query.all()).toEqual([
      {
        id: 1n,
        age: BigInt(Number.MAX_SAFE_INTEGER) + 10n,
      },
    ]);
  });

  it("should allow overwriting default", () => {
    const db = Database.open(":memory:", { safeIntegers: true });
    db.exec("CREATE TABLE foo (id INTEGER PRIMARY KEY AUTOINCREMENT, age INTEGER NOT NULL)");
    db.run("INSERT INTO foo (age) VALUES (?)", BigInt(Number.MAX_SAFE_INTEGER) + 10n);
    const query = db.query("SELECT * FROM foo");
    expect(query.all()).toEqual([
      {
        id: 1n,
        age: BigInt(Number.MAX_SAFE_INTEGER) + 10n,
      },
    ]);
    query.safeIntegers(false);
    query.as;
    expect(query.all()).toEqual([{ id: 1, age: Number.MAX_SAFE_INTEGER + 10 }]);
  });

  it("should throw range error if value is out of range", () => {
    const db = new Database(":memory:", { safeIntegers: true });
    db.run("CREATE TABLE test (id INTEGER PRIMARY KEY, value INTEGER)");

    const query = db.query("INSERT INTO test (value) VALUES ($value)");

    expect(() => query.run({ $value: BigInt(Number.MAX_SAFE_INTEGER) ** 2n })).toThrow(RangeError);
    query.safeIntegers(false);
    expect(() => query.run({ $value: BigInt(Number.MAX_SAFE_INTEGER) ** 2n })).not.toThrow(RangeError);
  });
});

{
  const strictInputs = [
    { name: "myname", age: 42 },
    { age: 42, name: "myname" },
    ["myname", 42],
    { 0: "myname", 1: 42 },
    { 1: "myname", 0: 42 },
  ];
  const queries = ["$name, $age", "$name, $age", "?, ?", "?1, ?2", "?2, ?1"];
  const uglyInputs = [
    { $name: "myname", $age: 42 },
    { $age: 42, $name: "myname" },
    ["myname", 42],
    { "?1": "myname", "?2": 42 },
    { "?2": "myname", "?1": 42 },
  ];

  for (const strict of [true, false]) {
    describe(strict ? "strict" : "default", () => {
      const inputs = strict ? strictInputs : uglyInputs;
      for (let i = 0; i < strictInputs.length; i++) {
        const input = inputs[i];
        const query = queries[i];
        it(`${JSON.stringify(input)} -> ${query}`, () => {
          const db = Database.open(":memory:", { strict });
          db.exec(
            "CREATE TABLE cats (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL, age INTEGER NOT NULL)",
          );
          const { changes, lastInsertRowid } = db.run(`INSERT INTO cats (name, age) VALUES (${query})`, input);
          expect(changes).toBe(1);
          expect(lastInsertRowid).toBe(1);

          expect(db.query("SELECT * FROM cats").all()).toStrictEqual([
            {
              id: 1,
              name: "myname",
              age: 42,
            },
          ]);
          expect(db.query(`SELECT * FROM cats WHERE (name, age) = (${query})`).all(input)).toStrictEqual([
            { id: 1, name: "myname", age: 42 },
          ]);
          expect(db.query(`SELECT * FROM cats WHERE (name, age) = (${query})`).get(input)).toStrictEqual({
            id: 1,
            name: "myname",
            age: 42,
          });
          expect(db.query(`SELECT * FROM cats WHERE (name, age) = (${query})`).values(input)).toStrictEqual([
            [1, "myname", 42],
          ]);
        });
      }

      if (strict) {
        describe("throws missing parameter error in", () => {
          for (let method of ["all", "get", "values", "run"]) {
            it(`${method}()`, () => {
              const db = Database.open(":memory:", { strict: true });

              db.exec("CREATE TABLE cats (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, age INTEGER)");

              expect(() => {
                const query = db.query("INSERT INTO cats (name, age) VALUES (@name, @age)");

                query[method]({
                  "name": "Joey",
                });
              }).toThrow('Missing parameter "age"');
            });
          }
        });
      }
    });
  }
}

var encode = text => new TextEncoder().encode(text);

// Use different numbers of columns to ensure we crash if using initializeIndex() on a large array can cause bugs.
// https://github.com/oven-sh/bun/issues/11747
it.each([1, 16, 256, 512, 768])("should work with duplicate columns in values() of length %d", columnCount => {
  const db = new Database(":memory:");

  db.prepare(
    `create table \`users\` ( id integer primary key autoincrement, name text, reportTo integer, ${Array.from(
      {
        length: columnCount,
      },
      (_, i) => `column${i} text DEFAULT "make GC happen!!" NOT NULL${i === columnCount - 1 ? "" : ","}`,
    ).join("")} );`,
  ).run();
  const names = [
    ["dan", null],
    ["alef", 1],
    ["bob", 2],
    ["carl", 3],
    ["dave", 4],
    ["eve", 5],
    ["fred", 6],
    ["george", 7],
    ["harry", 8],
    ["isaac", 9],
    ["jacob", 10],
    ["kevin", 11],
    ["larry", 12],
    ["mike", 13],
    ["nathan", 14],
    ["oscar", 15],
    ["peter", 16],
    ["qwerty", 17],
    ["robert", 18],
    ["samuel", 19],
    ["tom", 20],
    ["william", 21],
    ["xavier", 22],
    ["yanny", 23],
    ["zachary", 24],
  ];
  for (const [name, reportTo] of names) {
    db.prepare("insert into `users` (name, reportTo) values (?, ?);").run(name, reportTo);
  }
  const results = db
    .prepare("select * from 'users' left join 'users' reportee on `users`.id = reportee.reportTo; ")
    .values();
  expect(results).toHaveLength(names.length);
  expect(results[0]).toHaveLength((columnCount + 3) * 2);
  let prevResult;
  for (let result of results) {
    expect(result).toHaveLength((columnCount + 3) * 2);
    if (prevResult) {
      expect(prevResult.slice(columnCount + 3, (columnCount + 3) * 2)).toEqual(result.slice(0, columnCount + 3));
    }
    prevResult = result;
  }
});

it("Database.open", () => {
  // in a folder which doesn't exist
  try {
    Database.open("/this/database/does/not/exist.sqlite", constants.SQLITE_OPEN_READWRITE);
    throw new Error("Expected an error to be thrown");
  } catch (error) {
    expect(error.message).toBe("unable to open database file");
  }

  // in a file which doesn't exist
  try {
    Database.open(tmpbase + `database-${Math.random()}.sqlite`, constants.SQLITE_OPEN_READWRITE);
    throw new Error("Expected an error to be thrown");
  } catch (error) {
    expect(error.message).toBe("unable to open database file");
  }

  // in a file which doesn't exist
  try {
    Database.open(tmpbase + `database-${Math.random()}.sqlite`, {
      readonly: true,
    });
    throw new Error("Expected an error to be thrown");
  } catch (error) {
    expect(error.message).toBe("unable to open database file");
  }

  // in a file which doesn't exist
  try {
    Database.open(tmpbase + `database-${Math.random()}.sqlite`, {
      readwrite: true,
    });
    throw new Error("Expected an error to be thrown");
  } catch (error) {
    expect(error.message).toBe("unable to open database file");
  }

  // create works
  {
    var db = Database.open(tmpbase + `database-${Math.random()}.sqlite`, {
      create: true,
    });
    db.close();
  }

  // this should not throw
  // it creates an in-memory db
  new Database().close();
});

it("upsert cross-process, see #1366", () => {
  const dir = realpathSync(tmpdir()) + "/";
  const { exitCode } = spawnSync([bunExe(), import.meta.dir + "/sqlite-cross-process.js"], {
    env: {
      ...bunEnv,
      SQLITE_DIR: dir,
    },
    stderr: "inherit",
  });
  expect(exitCode).toBe(0);

  const db2 = Database.open(dir + "get-persist.sqlite");

  expect(db2.query(`SELECT id FROM examples`).all()).toEqual([
    { id: "hello" },
    {
      id: "world",
    },
  ]);
});

it("creates", () => {
  const db = Database.open(":memory:");
  db.exec(
    "CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT, value INTEGER, created TEXT, deci FLOAT, blobby BLOB)",
  );
  const stmt = db.prepare("INSERT INTO test (name, value, deci, created, blobby) VALUES (?, ?, ?, ?, ?)");

  stmt.run(["foo", 1, Math.fround(1.111), new Date(1995, 12, 19).toISOString(), encode("Hello World")]);
  stmt.run(["bar", 2, Math.fround(2.222), new Date(1995, 12, 19).toISOString(), encode("Hello World")]);
  stmt.run(["baz", 3, Math.fround(3.333), new Date(1995, 12, 19).toISOString(), encode("Hello World")]);

  stmt.finalize();

  const stmt2 = db.prepare("SELECT * FROM test");
  expect(JSON.stringify(stmt2.get())).toBe(
    JSON.stringify({
      id: 1,
      name: "foo",
      value: 1,
      created: new Date(1995, 12, 19).toISOString(),
      deci: Math.fround(1.111),
      blobby: encode("Hello World"),
    }),
  );

  expect(JSON.stringify(stmt2.all())).toBe(
    JSON.stringify([
      {
        id: 1,
        name: "foo",
        value: 1,
        created: new Date(1995, 12, 19).toISOString(),
        deci: Math.fround(1.111),
        blobby: encode("Hello World"),
      },
      {
        id: 2,
        name: "bar",
        value: 2,
        created: new Date(1995, 12, 19).toISOString(),
        deci: Math.fround(2.222),
        blobby: encode("Hello World"),
      },
      {
        id: 3,
        name: "baz",
        value: 3,
        created: new Date(1995, 12, 19).toISOString(),
        deci: Math.fround(3.333),
        blobby: encode("Hello World"),
      },
    ]),
  );
  expect(stmt2.run()).toStrictEqual({
    changes: 0,
    lastInsertRowid: 3,
  });

  // not necessary to run but it's a good practice
  stmt2.finalize();
});

it("int52", () => {
  const db = Database.open(":memory:");
  db.exec("CREATE TABLE test (id INTEGER PRIMARY KEY, int64 INTEGER)");
  db.run("INSERT INTO test (int64) VALUES (?)", Number.MAX_SAFE_INTEGER);
  expect(db.query("SELECT * FROM test").get().int64).toBe(Number.MAX_SAFE_INTEGER);
});

it("typechecks", () => {
  const db = Database.open(":memory:");
  db.exec("CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)");
  db.exec('INSERT INTO test (name) VALUES ("Hello")');
  db.exec('INSERT INTO test (name) VALUES ("World")');

  const q = db.prepare("SELECT * FROM test WHERE (name = ?)");

  var expectfail = val => {
    try {
      q.run([val]);
      throw new Error("Expected error");
    } catch (e) {
      expect(e.message !== "Expected error").toBe(true);
      expect(e.name).toBe("TypeError");
    }

    try {
      q.all([val]);
      throw new Error("Expected error");
    } catch (e) {
      expect(e.message !== "Expected error").toBe(true);
      expect(e.name).toBe("TypeError");
    }

    try {
      q.get([val]);
      throw new Error("Expected error");
    } catch (e) {
      expect(e.message !== "Expected error").toBe(true);
      expect(e.name).toBe("TypeError");
    }
  };

  expectfail(Symbol("oh hai"));
  expectfail(new Date());
  expectfail(class Foo {});
  expectfail(() => class Foo {});
  expectfail(new RangeError("what"));
  expectfail(new Map());
  expectfail(new Map([["foo", "bar"]]));
  expectfail(new Set());
  expectfail(new Set([1, 2, 3]));
});

it("db.query supports TypedArray", () => {
  const db = Database.open(":memory:");

  db.exec("CREATE TABLE test (id INTEGER PRIMARY KEY, blobby BLOB)");

  const stmt = db.prepare("INSERT INTO test (blobby) VALUES (?)");
  stmt.run([encode("Hello World")]);
  stmt.finalize();

  const stmt2 = db.prepare("SELECT * FROM test");
  expect(JSON.stringify(stmt2.get())).toBe(
    JSON.stringify({
      id: 1,
      blobby: encode("Hello World"),
    }),
  );

  const stmt3 = db.prepare("SELECT * FROM test WHERE (blobby = ?)");

  expect(JSON.stringify(stmt3.get([encode("Hello World")]))).toBe(
    JSON.stringify({
      id: 1,
      blobby: encode("Hello World"),
    }),
  );

  expect(JSON.stringify(db.query("SELECT * FROM test WHERE (blobby = ?)").get([encode("Hello World")]))).toBe(
    JSON.stringify({
      id: 1,
      blobby: encode("Hello World"),
    }),
  );

  expect(stmt3.get([encode("Hello World NOT")])).toBe(null);
});

it("supports serialize/deserialize", () => {
  const db = Database.open(":memory:");
  db.exec("CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)");
  db.exec('INSERT INTO test (name) VALUES ("Hello")');
  db.exec('INSERT INTO test (name) VALUES ("World")');

  const input = db.serialize();
  const db2 = new Database(input);

  const stmt = db2.prepare("SELECT * FROM test");
  expect(JSON.stringify(stmt.get())).toBe(
    JSON.stringify({
      id: 1,
      name: "Hello",
    }),
  );

  expect(JSON.stringify(stmt.all())).toBe(
    JSON.stringify([
      {
        id: 1,
        name: "Hello",
      },
      {
        id: 2,
        name: "World",
      },
    ]),
  );
  db2.exec("insert into test (name) values ('foo')");
  expect(JSON.stringify(stmt.all())).toBe(
    JSON.stringify([
      {
        id: 1,
        name: "Hello",
      },
      {
        id: 2,
        name: "World",
      },
      {
        id: 3,
        name: "foo",
      },
    ]),
  );

  const db3 = new Database(input, { readonly: true });
  try {
    db3.exec("insert into test (name) values ('foo')");
    throw new Error("Expected error");
  } catch (e) {
    expect(e.message).toBe("attempt to write a readonly database");
  }

  // https://github.com/oven-sh/bun/issues/3712#issuecomment-1725259824
  expect(Database.deserialize(input)).toBeInstanceOf(Database);
});

it("Database.deserialize should support strict mode", () => {
  const db1 = new Database(":memory:");
  db1.run("CREATE TABLE test (name TEXT)");
  db1.run("INSERT INTO test VALUES (:name)", { ":name": "test1" });

  // Deserialize the database with strict mode
  const serialized = db1.serialize();
  const db2 = Database.deserialize(serialized, {
    strict: true,
    readonly: false,
  });

  // Use strict mode
  db2.run("CREATE TABLE test2 (name TEXT)");
  db2.run("INSERT INTO test2 VALUES ($name)", { name: "test2" });

  // Verify the data was inserted correctly
  const result = db2.query("SELECT * FROM test2").all();
  expect(result).toEqual([{ name: "test2" }]);

  // Also verify we can access the data from the original database
  const result1 = db2.query("SELECT * FROM test").all();
  expect(result1).toEqual([{ name: "test1" }]);
});

it("Database.deserialize should support readonly when passed as a flag or boolean", () => {
  expect.assertions(2);

  const db1 = new Database(":memory:");
  db1.run("CREATE TABLE test (name TEXT)");
  db1.run("INSERT INTO test VALUES (:name)", { ":name": "test1" });

  // Deserialize the database with readonly as flag
  const serialized = db1.serialize();
  const db2 = Database.deserialize(serialized, {
    readonly: true,
  });
  // Create another table
  // It should fail because it is readonly.
  try {
    db2.run("CREATE TABLE test2 (name TEXT)");
  } catch (e) {
    expect(e.message).toContain("attempt to write a readonly database");
  }

  // Deserialize the database with readonly as boolean
  const db3 = Database.deserialize(serialized, true);
  try {
    db3.run("CREATE TABLE test2 (name TEXT)");
  } catch (e) {
    expect(e.message).toContain("attempt to write a readonly database");
  }
});

it("db.query()", () => {
  const db = Database.open(":memory:");
  db.exec("CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)");

  expect(db[Symbol.for("Bun.Database.cache.count")]).toBe(0);

  var q = db.query("SELECT * FROM test WHERE name = ?");
  expect(q.get("Hello") === null).toBe(true);

  db.exec('INSERT INTO test (name) VALUES ("Hello")');
  db.exec('INSERT INTO test (name) VALUES ("World")');

  var rows = db.query("SELECT * FROM test WHERE name = ?").all(["Hello"]);

  expect(JSON.stringify(rows)).toBe(JSON.stringify([{ id: 1, name: "Hello" }]));

  rows = db.query("SELECT * FROM test WHERE name = ?").all(["World"]);

  // if this fails, it means the query caching failed to update
  expect(JSON.stringify(rows)).toBe(JSON.stringify([{ id: 2, name: "World" }]));

  rows = db.query("SELECT * FROM test WHERE name = ?").all(["Hello"]);
  expect(JSON.stringify(rows)).toBe(JSON.stringify([{ id: 1, name: "Hello" }]));

  // check that the query is cached
  expect(db[Symbol.for("Bun.Database.cache.count")]).toBe(1);

  db.clearQueryCache();

  // check clearing the cache decremented the counter
  expect(db[Symbol.for("Bun.Database.cache.count")]).toBe(0);

  q.finalize();
  try {
    // check clearing the cache decremented the counter

    q.all(["Hello"]);
    throw new Error("Should have thrown");
  } catch (e) {
    expect(e.message !== "Should have thrown").toBe(true);
  }

  // check that invalid queries are not cached
  // and invalid queries throw
  try {
    db.query("SELECT * FROM BACON", ["Hello"]).all();
    throw new Error("Should have thrown");
  } catch (e) {
    expect(e.message !== "Should have thrown").toBe(true);
    expect(db[Symbol.for("Bun.Database.cache.count")]).toBe(0);
  }

  // check that it supports multiple arguments
  expect(JSON.stringify(db.query("SELECT * FROM test where (name = ? OR name = ?)").all(["Hello", "Fooooo"]))).toBe(
    JSON.stringify([{ id: 1, name: "Hello" }]),
  );
  expect(JSON.stringify(db.query("SELECT * FROM test where (name = ? OR name = ?)").all("Hello", "Fooooo"))).toBe(
    JSON.stringify([{ id: 1, name: "Hello" }]),
  );

  // throws if insufficeint arguments
  try {
    db.query("SELECT * FROM test where (name = ? OR name = ?)").all("Hello");
  } catch (e) {
    expect(e.message).toBe("SQLite query expected 2 values, received 1");
  }

  // named parameters
  expect(
    JSON.stringify(
      db.query("SELECT * FROM test where (name = $hello OR name = $goodbye)").all({
        $hello: "Hello",
        $goodbye: "Fooooo",
      }),
    ),
  ).toBe(JSON.stringify([{ id: 1, name: "Hello" }]));

  const domjit = db.query("SELECT * FROM test");
  (function (domjit) {
    for (let i = 0; i < 100000; i++) {
      domjit.get().name;
    }
  })(domjit);

  // statement iterator
  let i;
  i = 0;
  for (const row of db.query("SELECT * FROM test")) {
    i === 0 && expect(JSON.stringify(row)).toBe(JSON.stringify({ id: 1, name: "Hello" }));
    i === 1 && expect(JSON.stringify(row)).toBe(JSON.stringify({ id: 2, name: "World" }));
    i++;
  }
  expect(i).toBe(2);

  // iterate (no args)
  i = 0;
  for (const row of db.query("SELECT * FROM test").iterate()) {
    i === 0 && expect(JSON.stringify(row)).toBe(JSON.stringify({ id: 1, name: "Hello" }));
    i === 1 && expect(JSON.stringify(row)).toBe(JSON.stringify({ id: 2, name: "World" }));
    i++;
  }
  expect(i).toBe(2);

  // iterate (args)
  i = 0;
  for (const row of db.query("SELECT * FROM test WHERE name = $name").iterate({
    $name: "World",
  })) {
    i === 0 && expect(JSON.stringify(row)).toBe(JSON.stringify({ id: 2, name: "World" }));
    i++;
  }
  expect(i).toBe(1);

  // interrupted iterating, then call all()
  const stmt = db.query("SELECT * FROM test");
  i = 0;
  for (const row of stmt) {
    i === 0 && expect(JSON.stringify(row)).toBe(JSON.stringify({ id: 1, name: "Hello" }));
    i++;
    break;
  }
  expect(i).toBe(1);
  rows = stmt.all();
  expect(JSON.stringify(rows)).toBe(
    JSON.stringify([
      { id: 1, name: "Hello" },
      { id: 2, name: "World" },
    ]),
  );

  db.close();

  // Check that a closed database doesn't crash
  // and does throw an error when trying to run a query
  try {
    db.query("SELECT * FROM test WHERE name = ?").all(["Hello"]);
    throw new Error("Should have thrown");
  } catch (e) {
    expect(e.message !== "Should have thrown").toBe(true);
  }

  // check that we can call close multiple times
  // it should not throw so that your code doesn't break
  db.close();
  db.close();
  db.close();
});

it("db.run()", () => {
  const db = Database.open(":memory:");

  db.exec("CREATE TABLE cats (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL, age INTEGER NOT NULL)");

  const insert = db.query("INSERT INTO cats (name, age) VALUES (@name, @age) RETURNING name").all({
    "@name": "Joey",
    "@age": 2,
  });
});

for (let strict of [false, true]) {
  it(`strict: ${strict}`, () => {
    const db = Database.open(":memory:", { strict });

    db.exec("CREATE TABLE cats (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, age INTEGER)");

    const result = db.query("INSERT INTO cats (name, age) VALUES (@name, @age) RETURNING name").all({
      [(!strict ? "@" : "") + "name"]: "Joey",
      [(!strict ? "@" : "") + "age"]: 2,
    });
    expect(result).toStrictEqual([{ name: "Joey" }]);
  });
}
it("strict: true", () => {
  const db = Database.open(":memory:", { strict: true });

  db.exec("CREATE TABLE cats (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL, age INTEGER NOT NULL)");

  const insert = db.query("INSERT INTO cats (name, age) VALUES (@name, @age) RETURNING name").all({
    "name": "Joey",
    "age": 2,
  });
});

describe("does not throw missing parameter error in", () => {
  for (let method of ["all", "get", "values", "run"]) {
    it(`${method}()`, () => {
      const db = Database.open(":memory:");

      db.exec("CREATE TABLE cats (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, age INTEGER)");

      expect(() => {
        const query = db.query("INSERT INTO cats (name, age) VALUES (@name, @age) RETURNING name");
        const result = query[method]({
          "@name": "Joey",
        });
        switch (method) {
          case "all":
            expect(result).toHaveLength(1);
            expect(result[0]).toStrictEqual({ name: "Joey" });
            break;
          case "get":
            expect(result).toStrictEqual({ name: "Joey" });
            break;
          case "values":
            expect(result).toStrictEqual([["Joey"]]);
            break;
          case "run":
            expect(result).toEqual({ changes: 1, lastInsertRowid: 1 });
            break;
        }
      }).not.toThrow();
    });
  }
});

it("db.transaction()", () => {
  const db = Database.open(":memory:");

  db.exec("CREATE TABLE cats (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, age INTEGER)");

  const insert = db.prepare("INSERT INTO cats (name, age) VALUES (@name, @age)");

  expect(db.inTransaction).toBe(false);
  const insertMany = db.transaction(cats => {
    expect(db.inTransaction).toBe(true);
    try {
      for (const cat of cats) insert.run(cat);
    } catch (exception) {
      throw exception;
    }
  });

  try {
    insertMany([
      { "@name": "Joey", "@age": 2 },
      { "@name": "Sally", "@age": 4 },
      { "@name": "Junior", "@age": 1 },
      { "@name": "Sally", "@age": 4 },
    ]);
    throw new Error("Should have thrown");
  } catch (exception) {
    expect(exception.message).toEqual("UNIQUE constraint failed: cats.name");
    expect(exception.code).toEqual("SQLITE_CONSTRAINT_UNIQUE");
    expect(exception.errno).toEqual(2067);
    expect(exception.byteOffset).toEqual(-1);
  }

  expect(db.inTransaction).toBe(false);
  expect(db.query("SELECT * FROM cats").all().length).toBe(0);

  expect(db.inTransaction).toBe(false);
  insertMany([
    { "@name": "Joey", "@age": 2 },
    { "@name": "Sally", "@age": 4 },
    { "@name": "Junior", "@age": 1 },
  ]);
  expect(db.inTransaction).toBe(false);
  expect(db.query("SELECT * FROM cats").all().length).toBe(3);
  expect(db.inTransaction).toBe(false);
});

// this bug was fixed by ensuring FinalObject has no more than 64 properties
it("inlineCapacity #987", async () => {
  const db = new Database(":memory:");
  // Create schema matching the original regression test (media + logs tables)
  db.exec(`
    CREATE TABLE media (id INTEGER PRIMARY KEY, mid TEXT, name TEXT, url TEXT, duration INTEGER);
    CREATE TABLE logs (mid INTEGER, duration INTEGER, start INTEGER, did TEXT, vid TEXT);
    INSERT INTO media VALUES (1, 'm1', 'Test Media', 'http://test', 120);
    INSERT INTO logs VALUES (1, 60, 1654100000, 'd1', 'v1');
    INSERT INTO logs VALUES (1, 45, 1654200000, 'd2', 'v2');
  `);

  const query = `SELECT
  media.mid,
  UPPER(media.name) as name,
  media.url,
  media.duration,
  time(media.duration, 'unixepoch') AS durationStr,
  sum(totalDurations) AS totalDurations,
  sum(logs.views) AS views,
  total.venues,
  total.devices,
  SUM(CASE WHEN day = '01' THEN logs.views ELSE 0 END) as 'vi01', SUM(CASE WHEN day = '02' THEN logs.views ELSE 0 END) as 'vi02', SUM(CASE WHEN day = '03' THEN logs.views ELSE 0 END) as 'vi03', SUM(CASE WHEN day = '04' THEN logs.views ELSE 0 END) as 'vi04', SUM(CASE WHEN day = '05' THEN logs.views ELSE 0 END) as 'vi05', SUM(CASE WHEN day = '06' THEN logs.views ELSE 0 END) as 'vi06', SUM(CASE WHEN day = '07' THEN logs.views ELSE 0 END) as 'vi07', SUM(CASE WHEN day = '08' THEN logs.views ELSE 0 END) as 'vi08', SUM(CASE WHEN day = '09' THEN logs.views ELSE 0 END) as 'vi09', SUM(CASE WHEN day = '10' THEN logs.views ELSE 0 END) as 'vi10', SUM(CASE WHEN day = '11' THEN logs.views ELSE 0 END) as 'vi11', SUM(CASE WHEN day = '12' THEN logs.views ELSE 0 END) as 'vi12', SUM(CASE WHEN day = '13' THEN logs.views ELSE 0 END) as 'vi13', SUM(CASE WHEN day = '14' THEN logs.views ELSE 0 END) as 'vi14', SUM(CASE WHEN day = '15' THEN logs.views ELSE 0 END) as 'vi15', SUM(CASE WHEN day = '16' THEN logs.views ELSE 0 END) as 'vi16', SUM(CASE WHEN day = '17' THEN logs.views ELSE 0 END) as 'vi17', SUM(CASE WHEN day = '18' THEN logs.views ELSE 0 END) as 'vi18', SUM(CASE WHEN day = '19' THEN logs.views ELSE 0 END) as 'vi19', SUM(CASE WHEN day = '20' THEN logs.views ELSE 0 END) as 'vi20', SUM(CASE WHEN day = '21' THEN logs.views ELSE 0 END) as 'vi21', SUM(CASE WHEN day = '22' THEN logs.views ELSE 0 END) as 'vi22', SUM(CASE WHEN day = '23' THEN logs.views ELSE 0 END) as 'vi23', SUM(CASE WHEN day = '24' THEN logs.views ELSE 0 END) as 'vi24', SUM(CASE WHEN day = '25' THEN logs.views ELSE 0 END) as 'vi25', SUM(CASE WHEN day = '26' THEN logs.views ELSE 0 END) as 'vi26', SUM(CASE WHEN day = '27' THEN logs.views ELSE 0 END) as 'vi27', SUM(CASE WHEN day = '28' THEN logs.views ELSE 0 END) as 'vi28', SUM(CASE WHEN day = '29' THEN logs.views ELSE 0 END) as 'vi29', SUM(CASE WHEN day = '30' THEN logs.views ELSE 0 END) as 'vi30', MAX(CASE WHEN day = '01' THEN logs.venues ELSE 0 END) as 've01', MAX(CASE WHEN day = '02' THEN logs.venues ELSE 0 END) as 've02', MAX(CASE WHEN day = '03' THEN logs.venues ELSE 0 END) as 've03', MAX(CASE WHEN day = '04' THEN logs.venues ELSE 0 END) as 've04', MAX(CASE WHEN day = '05' THEN logs.venues ELSE 0 END) as 've05', MAX(CASE WHEN day = '06' THEN logs.venues ELSE 0 END) as 've06', MAX(CASE WHEN day = '07' THEN logs.venues ELSE 0 END) as 've07', MAX(CASE WHEN day = '08' THEN logs.venues ELSE 0 END) as 've08', MAX(CASE WHEN day = '09' THEN logs.venues ELSE 0 END) as 've09', MAX(CASE WHEN day = '10' THEN logs.venues ELSE 0 END) as 've10', MAX(CASE WHEN day = '11' THEN logs.venues ELSE 0 END) as 've11', MAX(CASE WHEN day = '12' THEN logs.venues ELSE 0 END) as 've12', MAX(CASE WHEN day = '13' THEN logs.venues ELSE 0 END) as 've13', MAX(CASE WHEN day = '14' THEN logs.venues ELSE 0 END) as 've14', MAX(CASE WHEN day = '15' THEN logs.venues ELSE 0 END) as 've15', MAX(CASE WHEN day = '16' THEN logs.venues ELSE 0 END) as 've16', MAX(CASE WHEN day = '17' THEN logs.venues ELSE 0 END) as 've17', MAX(CASE WHEN day = '18' THEN logs.venues ELSE 0 END) as 've18', MAX(CASE WHEN day = '19' THEN logs.venues ELSE 0 END) as 've19', MAX(CASE WHEN day = '20' THEN logs.venues ELSE 0 END) as 've20', MAX(CASE WHEN day = '21' THEN logs.venues ELSE 0 END) as 've21', MAX(CASE WHEN day = '22' THEN logs.venues ELSE 0 END) as 've22', MAX(CASE WHEN day = '23' THEN logs.venues ELSE 0 END) as 've23', MAX(CASE WHEN day = '24' THEN logs.venues ELSE 0 END) as 've24', MAX(CASE WHEN day = '25' THEN logs.venues ELSE 0 END) as 've25', MAX(CASE WHEN day = '26' THEN logs.venues ELSE 0 END) as 've26', MAX(CASE WHEN day = '27' THEN logs.venues ELSE 0 END) as 've27', MAX(CASE WHEN day = '28' THEN logs.venues ELSE 0 END) as 've28', MAX(CASE WHEN day = '29' THEN logs.venues ELSE 0 END) as 've29', MAX(CASE WHEN day = '30' THEN logs.venues ELSE 0 END) as 've30', MAX(CASE WHEN day = '01' THEN logs.devices ELSE 0 END) as 'de01', MAX(CASE WHEN day = '02' THEN logs.devices ELSE 0 END) as 'de02', MAX(CASE WHEN day = '03' THEN logs.devices ELSE 0 END) as 'de03', MAX(CASE WHEN day = '04' THEN logs.devices ELSE 0 END) as 'de04', MAX(CASE WHEN day = '05' THEN logs.devices ELSE 0 END) as 'de05', MAX(CASE WHEN day = '06' THEN logs.devices ELSE 0 END) as 'de06', MAX(CASE WHEN day = '07' THEN logs.devices ELSE 0 END) as 'de07', MAX(CASE WHEN day = '08' THEN logs.devices ELSE 0 END) as 'de08', MAX(CASE WHEN day = '09' THEN logs.devices ELSE 0 END) as 'de09', MAX(CASE WHEN day = '10' THEN logs.devices ELSE 0 END) as 'de10', MAX(CASE WHEN day = '11' THEN logs.devices ELSE 0 END) as 'de11', MAX(CASE WHEN day = '12' THEN logs.devices ELSE 0 END) as 'de12', MAX(CASE WHEN day = '13' THEN logs.devices ELSE 0 END) as 'de13', MAX(CASE WHEN day = '14' THEN logs.devices ELSE 0 END) as 'de14', MAX(CASE WHEN day = '15' THEN logs.devices ELSE 0 END) as 'de15', MAX(CASE WHEN day = '16' THEN logs.devices ELSE 0 END) as 'de16', MAX(CASE WHEN day = '17' THEN logs.devices ELSE 0 END) as 'de17', MAX(CASE WHEN day = '18' THEN logs.devices ELSE 0 END) as 'de18', MAX(CASE WHEN day = '19' THEN logs.devices ELSE 0 END) as 'de19', MAX(CASE WHEN day = '20' THEN logs.devices ELSE 0 END) as 'de20', MAX(CASE WHEN day = '21' THEN logs.devices ELSE 0 END) as 'de21', MAX(CASE WHEN day = '22' THEN logs.devices ELSE 0 END) as 'de22', MAX(CASE WHEN day = '23' THEN logs.devices ELSE 0 END) as 'de23', MAX(CASE WHEN day = '24' THEN logs.devices ELSE 0 END) as 'de24', MAX(CASE WHEN day = '25' THEN logs.devices ELSE 0 END) as 'de25', MAX(CASE WHEN day = '26' THEN logs.devices ELSE 0 END) as 'de26', MAX(CASE WHEN day = '27' THEN logs.devices ELSE 0 END) as 'de27', MAX(CASE WHEN day = '28' THEN logs.devices ELSE 0 END) as 'de28', MAX(CASE WHEN day = '29' THEN logs.devices ELSE 0 END) as 'de29', MAX(CASE WHEN day = '30' THEN logs.devices ELSE 0 END) as 'de30'
  FROM
  (
    SELECT
      logs.mid,
      sum(logs.duration) AS totalDurations,
      strftime ('%d', START, 'unixepoch', 'localtime') AS day,
      count(*) AS views,
      count(DISTINCT did) AS devices,
      count(DISTINCT vid) AS venues
    FROM
      logs
    WHERE strftime('%m-%Y', start, 'unixepoch', 'localtime')='06-2022'
    GROUP BY
      day,
      logs.mid
  ) logs
  INNER JOIN media ON media.id = logs.mid
  INNER JOIN (
    SELECT
      mid,
      count(DISTINCT vid) as venues,
      count(DISTINCT did) as devices
    FROM
      logs
    WHERE strftime('%m-%Y', start, 'unixepoch', 'localtime')='06-2022'
    GROUP by
      mid
  ) total ON logs.mid = total.mid
  ORDER BY
  name`;

  expect(Object.keys(db.query(query).all()[0]).length).toBe(99);
});

// https://github.com/oven-sh/bun/issues/1553
it("latin1 supplement chars", () => {
  const db = new Database();
  db.run("CREATE TABLE IF NOT EXISTS foo (id INTEGER PRIMARY KEY AUTOINCREMENT, greeting TEXT)");
  db.run("INSERT INTO foo (greeting) VALUES (?)", "Welcome to bun!");
  db.run("INSERT INTO foo (greeting) VALUES (?)", "Español");
  db.run("INSERT INTO foo (greeting) VALUES (?)", "¿Qué sucedió?");

  expect(db.query("SELECT * FROM foo").all()).toEqual([
    {
      id: 1,
      greeting: "Welcome to bun!",
    },
    {
      id: 2,
      greeting: "Español",
    },
    {
      id: 3,
      greeting: "¿Qué sucedió?",
    },
  ]);

  // test that it doesn't break when we do a structure transition
  db.query("SELECT * FROM foo").all()[0].booop = true;
  db.query("SELECT * FROM foo").all()[0].beep = true;
  expect(db.query("SELECT * FROM foo").all()).toEqual([
    {
      id: 1,
      greeting: "Welcome to bun!",
    },
    {
      id: 2,
      greeting: "Español",
    },
    {
      id: 3,
      greeting: "¿Qué sucedió?",
    },
  ]);

  expect(db.query("SELECT * FROM foo").values()).toEqual([
    [1, "Welcome to bun!"],
    [2, "Español"],
    [3, "¿Qué sucedió?"],
  ]);
  expect(db.query("SELECT * FROM foo WHERE id > 9999").all()).toEqual([]);
  expect(db.query("SELECT * FROM foo WHERE id > 9999").values()).toEqual([]);
});

it("supports FTS5", () => {
  const db = new Database();
  db.run("CREATE VIRTUAL TABLE movies USING fts5(title, tokenize='trigram')");
  const insert = db.prepare("INSERT INTO movies VALUES ($title)");
  const insertMovies = db.transaction(movies => {
    for (const movie of movies) insert.run(movie);
  });
  insertMovies([
    { $title: "The Shawshank Redemption" },
    { $title: "WarGames" },
    { $title: "Interstellar" },
    { $title: "Se7en" },
    { $title: "City of God" },
    { $title: "Spirited Away" },
  ]);
  expect(db.query("SELECT * FROM movies('game')").all()).toEqual([
    {
      title: "WarGames",
    },
  ]);
});

describe("Database.run", () => {
  it("should not throw error `not an error` when provided query containing only whitespace", () => {
    const db = Database.open(":memory:");
    db.exec("CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)");

    expect(db[Symbol.for("Bun.Database.cache.count")]).toBe(0);

    var q = db.query("SELECT * FROM test WHERE name = ?");
    expect(q.get("Hello") === null).toBe(true);

    db.exec('INSERT INTO test (name) VALUES ("Hello")');
    db.exec('INSERT INTO test (name) VALUES ("World")');

    try {
      db.run(" ");
      expect(true).toBeFalsy();
    } catch (e) {
      expect(e.message).not.toBe("not an error");
      expect(e.message).toBe("Query contained no valid SQL statement; likely empty query.");
    }
  });
});

it("#3991", () => {
  const db = new Database(":memory:");
  db.prepare(
    `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    xx TEXT)
`,
  ).run();

  db.prepare(
    `insert into users (id, xx) values (
    'foobar',
    '{
        "links": [{"1": {
    "2": "https://foobar.to/123",
    "3": "4"
    }}]

    }'
)`,
  ).run();

  let x = db
    .query(
      `SELECT * FROM users
        WHERE users.id = 'foobar'
        limit 1`,
    )
    .get();

  // Check we don't crash when a column with a string value greater than 64 characters is present.
  expect(x.abc).toBeUndefined();

  expect(x.id).toBe("foobar");
});

it("#5872", () => {
  const db = new Database(":memory:");
  db.run("CREATE TABLE foo (id INTEGER PRIMARY KEY AUTOINCREMENT, greeting TEXT)");
  const query = db.query("INSERT INTO foo (greeting) VALUES ($greeting);");
  const result = query.all({ $greeting: "sup" });
  expect(result).toEqual([]);
});

it("latin1 sqlite3 column name", () => {
  const db = new Database(":memory:");

  db.run("CREATE TABLE foo (id INTEGER PRIMARY KEY AUTOINCREMENT, copyright© TEXT)");

  db.run("INSERT INTO foo (id, copyright©) VALUES (?, ?)", [1, "© 2021 The Authors. All rights reserved."]);

  expect(db.query("SELECT * FROM foo").all()).toEqual([
    {
      id: 1,
      "copyright©": "© 2021 The Authors. All rights reserved.",
    },
  ]);
});

it("syntax error sets the byteOffset", () => {
  const db = new Database(":memory:");
  try {
    db.query("SELECT * FROM foo!!").all();
    throw new Error("Expected error");
  } catch (error) {
    if (isMacOS && !isMacOSVersionAtLeast(13)) {
      // older versions of macOS don't have the function which returns the byteOffset
      // we internally use a polyfill, so we need to allow that.
      expect(error.byteOffset).toBe(-1);
    } else {
      expect(error.byteOffset).toBe(17);
    }
  }
});

it("Missing DB throws SQLITE_CANTOPEN", () => {
  try {
    new Database("./definitely/not/found");
    expect.unreachable();
  } catch (error) {
    expect(error.code).toBe("SQLITE_CANTOPEN");
    expect(error).toBeInstanceOf(SQLiteError);
  }
});

it.each([
  ["query().get() with a syntax error", db => db.query("selecx 1").get()],
  ["query().all() with an unknown table", db => db.query("SELECT * FROM not_a_table").all()],
  ["query().all() with an unknown column", db => db.query("SELECT not_a_column FROM foo").all()],
  ["run() with a syntax error", db => db.run("selecx 1")],
  ["exec() with a syntax error", db => db.exec("selecx 1")],
  ["prepare() with a syntax error", db => db.prepare("selecx 1")],
])("generic errors set code to SQLITE_ERROR: %s", (label, fn) => {
  using db = new Database(":memory:");
  db.run("CREATE TABLE foo (id INTEGER PRIMARY KEY)");

  let error;
  try {
    fn(db);
  } catch (e) {
    error = e;
  }

  expect(error).toBeInstanceOf(SQLiteError);
  expect({ code: error.code, errno: error.errno }).toEqual({
    code: "SQLITE_ERROR",
    errno: 1,
  });
});

it("empty blob", () => {
  const db = new Database(":memory:");
  db.run("CREATE TABLE foo (id INTEGER PRIMARY KEY AUTOINCREMENT, blob BLOB)");
  db.run("INSERT INTO foo (blob) VALUES (?)", [new Uint8Array()]);
  expect(db.query("SELECT * FROM foo").all()).toEqual([
    {
      id: 1,
      blob: new Uint8Array(),
    },
  ]);
});

it("multiple statements with a schema change", () => {
  const db = new Database(":memory:");
  db.run(
    `
    CREATE TABLE foo (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT);
    CREATE TABLE bar (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT);

    INSERT INTO foo (name) VALUES ('foo');
    INSERT INTO foo (name) VALUES ('bar');

    INSERT INTO bar (name) VALUES ('foo');
    INSERT INTO bar (name) VALUES ('bar');
  `,
  );

  expect(db.query("SELECT * FROM foo").all()).toEqual([
    {
      id: 1,
      name: "foo",
    },
    {
      id: 2,
      name: "bar",
    },
  ]);

  expect(db.query("SELECT * FROM bar").all()).toEqual([
    {
      id: 1,
      name: "foo",
    },
    {
      id: 2,
      name: "bar",
    },
  ]);
});

it("multiple statements", () => {
  const fixtures = [
    "INSERT INTO foo (name) VALUES ('foo')",
    "INSERT INTO foo (name) VALUES ('barabc')",
    "INSERT INTO foo (name) VALUES ('!bazaspdok')",
  ];
  for (let separator of [";", ";\n", "\n;", "\r\n;", ";\r\n", ";\t", "\t;", "\r\n;"]) {
    for (let spaceOffset of [1, 0, -1]) {
      for (let spacesCount = 0; spacesCount < 8; spacesCount++) {
        const db = new Database(":memory:");
        db.run("CREATE TABLE foo (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT)");

        const prefix = spaceOffset < 0 ? " ".repeat(spacesCount) : "";
        const suffix = spaceOffset > 0 ? " ".repeat(spacesCount) : "";
        const query = fixtures.join(prefix + separator + suffix);
        db.run(query);

        expect(db.query("SELECT * FROM foo").all()).toEqual([
          {
            id: 1,
            name: "foo",
          },
          {
            id: 2,
            name: "barabc",
          },
          {
            id: 3,
            name: "!bazaspdok",
          },
        ]);
      }
    }
  }
});

it.skipIf(
  // We use the system version, which may or may not have math functions
  process.platform === "darwin",
)("math functions", () => {
  const db = new Database(":memory:");

  expect(db.prepare("SELECT ABS(-243.5)").all()).toEqual([
    {
      "ABS(-243.5)": 243.5,
    },
  ]);
  expect(db.prepare("SELECT ACOS(0.25)").all()).toEqual([
    {
      "ACOS(0.25)": 1.318116071652818,
    },
  ]);
  expect(db.prepare("SELECT ASIN(0.25)").all()).toEqual([
    {
      "ASIN(0.25)": 0.25268025514207865,
    },
  ]);
  expect(db.prepare("SELECT ATAN(0.25)").all()).toEqual([
    {
      "ATAN(0.25)": 0.24497866312686414,
    },
  ]);
  db.exec(
    `
    CREATE TABLE num_table (value TEXT NOT NULL);
    INSERT INTO num_table values (1), (2), (6);
    `,
  );
  expect(db.prepare(`SELECT AVG(value) as value FROM num_table`).all()).toEqual([{ value: 3 }]);
  expect(db.prepare("SELECT CEILING(0.25)").all()).toEqual([
    {
      "CEILING(0.25)": 1,
    },
  ]);
  expect(db.prepare("SELECT COUNT(*) FROM num_table").all()).toEqual([
    {
      "COUNT(*)": 3,
    },
  ]);
  expect(db.prepare("SELECT COS(0.25)").all()).toEqual([
    {
      "COS(0.25)": 0.9689124217106447,
    },
  ]);
  expect(db.prepare("SELECT DEGREES(0.25)").all()).toEqual([
    {
      "DEGREES(0.25)": 14.32394487827058,
    },
  ]);
  expect(db.prepare("SELECT EXP(0.25)").all()).toEqual([
    {
      "EXP(0.25)": 1.2840254166877414,
    },
  ]);
  expect(db.prepare("SELECT FLOOR(0.25)").all()).toEqual([
    {
      "FLOOR(0.25)": 0,
    },
  ]);
  expect(db.prepare("SELECT LOG10(0.25)").all()).toEqual([
    {
      "LOG10(0.25)": -0.6020599913279624,
    },
  ]);
  expect(db.prepare("SELECT PI()").all()).toEqual([
    {
      "PI()": 3.141592653589793,
    },
  ]);
  expect(db.prepare("SELECT POWER(0.25, 3)").all()).toEqual([
    {
      "POWER(0.25, 3)": 0.015625,
    },
  ]);
  expect(db.prepare("SELECT RADIANS(0.25)").all()).toEqual([
    {
      "RADIANS(0.25)": 0.004363323129985824,
    },
  ]);
  expect(db.prepare("SELECT ROUND(0.25)").all()).toEqual([
    {
      "ROUND(0.25)": 0,
    },
  ]);
  expect(db.prepare("SELECT SIGN(0.25)").all()).toEqual([{ "SIGN(0.25)": 1 }]);
  expect(db.prepare("SELECT SIN(0.25)").all()).toEqual([
    {
      "SIN(0.25)": 0.24740395925452294,
    },
  ]);
  expect(db.prepare("SELECT SQRT(0.25)").all()).toEqual([
    {
      "SQRT(0.25)": 0.5,
    },
  ]);
  expect(db.prepare("SELECT TAN(0.25)").all()).toEqual([
    {
      "TAN(0.25)": 0.25534192122103627,
    },
  ]);
});

it("issue#6597", () => {
  // better-sqlite3 returns the last value of duplicate fields
  const db = new Database(":memory:");
  db.run("CREATE TABLE Users (Id INTEGER PRIMARY KEY, Name VARCHAR(255), CreatedAt TIMESTAMP)");
  db.run(
    "CREATE TABLE Cars (Id INTEGER PRIMARY KEY, Driver INTEGER, CreatedAt TIMESTAMP, FOREIGN KEY (Driver) REFERENCES Users(Id))",
  );
  db.run('INSERT INTO Users (Id, Name, CreatedAt) VALUES (1, "Alice", "2022-01-01");');
  db.run('INSERT INTO Cars (Id, Driver, CreatedAt) VALUES (2, 1, "2023-01-01");');
  const result = db.prepare("SELECT * FROM Cars JOIN Users ON Driver=Users.Id").get();
  expect(result).toStrictEqual({
    Id: 1,
    Driver: 1,
    CreatedAt: "2022-01-01",
    Name: "Alice",
  });
  db.close();
});

it("issue#6597 with many columns", () => {
  // better-sqlite3 returns the last value of duplicate fields
  const db = new Database(":memory:");
  const count = 100;
  const columns = Array.from({ length: count }, (_, i) => `col${i}`);
  const values_foo = Array.from({ length: count }, (_, i) => `'foo${i}'`);
  const values_bar = Array.from({ length: count }, (_, i) => `'bar${i}'`);
  values_bar[0] = values_foo[0];
  db.run(`CREATE TABLE foo (${columns.join(",")})`);
  db.run(`CREATE TABLE bar (${columns.join(",")})`);
  db.run(`INSERT INTO foo (${columns.join(",")}) VALUES (${values_foo.join(",")})`);
  db.run(`INSERT INTO bar (${columns.join(",")}) VALUES (${values_bar.join(",")})`);
  const result = db.prepare("SELECT * FROM foo JOIN bar ON foo.col0 = bar.col0").get();
  expect(result.col0).toBe("foo0");
  for (let i = 1; i < count; i++) {
    expect(result[`col${i}`]).toBe(`bar${i}`);
  }
  db.close();
});

it("issue#7147", () => {
  const db = new Database(":memory:");
  db.exec("CREATE TABLE foos (foo_id INTEGER NOT NULL PRIMARY KEY, foo_a TEXT, foo_b TEXT)");
  db.exec(
    "CREATE TABLE bars (bar_id INTEGER NOT NULL PRIMARY KEY, foo_id INTEGER NOT NULL, bar_a INTEGER, bar_b INTEGER, FOREIGN KEY (foo_id) REFERENCES foos (foo_id))",
  );
  db.exec("INSERT INTO foos VALUES (1, 'foo_1', 'foo_2')");
  db.exec("INSERT INTO bars VALUES (1, 1, 'bar_1', 'bar_2')");
  db.exec("INSERT INTO bars VALUES (2, 1, 'baz_3', 'baz_4')");
  const query = db.query("SELECT f.*, b.* FROM foos f JOIN bars b ON b.foo_id = f.foo_id");
  const result = query.all();
  expect(result).toStrictEqual([
    {
      foo_id: 1,
      foo_a: "foo_1",
      foo_b: "foo_2",
      bar_id: 1,
      bar_a: "bar_1",
      bar_b: "bar_2",
    },
    {
      foo_id: 1,
      foo_a: "foo_1",
      foo_b: "foo_2",
      bar_id: 2,
      bar_a: "baz_3",
      bar_b: "baz_4",
    },
  ]);
  db.close();
});

it("should close with WAL enabled", () => {
  const dir = tempDirWithFiles("sqlite-wal-test", { "empty.txt": "" });
  const file = path.join(dir, "my.db");
  const db = new Database(file);
  db.exec("PRAGMA journal_mode = WAL");
  db.fileControl(constants.SQLITE_FCNTL_PERSIST_WAL, 0);
  db.exec("CREATE TABLE foo (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT)");
  db.exec("INSERT INTO foo (name) VALUES ('foo')");
  expect(db.query("SELECT * FROM foo").all()).toEqual([{ id: 1, name: "foo" }]);
  db.exec("PRAGMA wal_checkpoint(truncate)");
  db.close();
  expect(readdirSync(dir).sort()).toEqual(["empty.txt", "my.db"]);
});

it("close(true) should throw an error if the database is in use", () => {
  const db = new Database(":memory:");
  db.exec("CREATE TABLE foo (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT)");
  db.exec("INSERT INTO foo (name) VALUES ('foo')");
  const prepared = db.prepare("SELECT * FROM foo");
  expect(() => db.close(true)).toThrow("database is locked");
  prepared.finalize();
  expect(() => db.close(true)).not.toThrow();
});

it("close() should NOT throw an error if the database is in use", () => {
  const db = new Database(":memory:");
  db.exec("CREATE TABLE foo (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT)");
  db.exec("INSERT INTO foo (name) VALUES ('foo')");
  const prepared = db.prepare("SELECT * FROM foo");
  expect(() => db.close()).not.toThrow("database is locked");
});

it("should dispose AND throw an error if the database is in use", () => {
  expect(() => {
    let prepared;
    {
      using db = new Database(":memory:");
      db.exec("CREATE TABLE foo (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT)");
      db.exec("INSERT INTO foo (name) VALUES ('foo')");
      prepared = db.prepare("SELECT * FROM foo");
    }
  }).toThrow("database is locked");
});

it("should dispose", () => {
  expect(() => {
    {
      using db = new Database(":memory:");
      db.exec("CREATE TABLE foo (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT)");
      db.exec("INSERT INTO foo (name) VALUES ('foo')");
    }
  }).not.toThrow();
});

it("can continue to use existing statements after database has been GC'd", async () => {
  let called = false;
  async function run() {
    const registry = new FinalizationRegistry(() => {
      called = true;
    });
    function leakTheStatement() {
      const db = new Database(":memory:");
      console.log("---");
      db.exec("CREATE TABLE foo (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT)");
      db.exec("INSERT INTO foo (name) VALUES ('foo')");
      const prepared = db.prepare("SELECT * FROM foo");
      registry.register(db);
      return prepared;
    }

    const stmt = leakTheStatement();

    Bun.gc(true);
    await Bun.sleep(1);
    Bun.gc(true);
    expect(stmt.all()).toEqual([{ id: 1, name: "foo" }]);
    stmt.finalize();
    expect(() => stmt.all()).toThrow();
  }
  await run();
  Bun.gc(true);
  await Bun.sleep(1);
  Bun.gc(true);
  if (!isWindows) {
    // on Windows, FinalizationRegistry is more flaky than on POSIX.
    expect(called).toBe(true);
  }
});

it("statements should be disposable", () => {
  {
    using db = new Database("mydb.sqlite");
    using query = db.query("select 'Hello world' as message;");
    console.log(query.get()); // => { message: "Hello world" }
  }
});

it("query should work if the cached statement was finalized", () => {
  {
    let prevQuery;
    using db = new Database("mydb.sqlite");
    {
      using query = db.query("select 'Hello world' as message;");
      prevQuery = query;
      query.get();
    }
    {
      using query = db.query("select 'Hello world' as message;");
      expect(() => query.get()).not.toThrow();
    }
    expect(() => prevQuery.get()).toThrow();
  }
});

// https://github.com/oven-sh/bun/issues/12012
it("reports changes in Statement#run", () => {
  const db = new Database(":memory:");
  db.exec("CREATE TABLE cats (id INTEGER PRIMARY KEY, name TEXT)");

  const sql = "INSERT INTO cats (name) VALUES ('Fluffy'), ('Furry')";

  expect(db.run(sql).changes).toBe(2);
  expect(db.prepare(sql).run().changes).toBe(2);
  expect(db.query(sql).run().changes).toBe(2);
});

it("#13082", async () => {
  async function run() {
    const stmt = (() => {
      const db = new Database(":memory:");
      let stmt = db.prepare("select 1");
      db.close();
      return stmt;
    })();
    Bun.gc(true);
    await Bun.sleep(100);
    Bun.gc(true);
    stmt.all();
    stmt.get();
    stmt.run();
  }

  const count = 100;
  const runs = new Array(count);
  for (let i = 0; i < count; i++) {
    runs[i] = run();
  }

  await Promise.allSettled(runs);
});

// The internal SQL.run / SQL.prepare / SQL.isInTransaction helpers used to
// perform an off-by-one bounds check on the database handle (`>` instead of
// `>=`), so a handle equal to databases().size() skipped the early-return and
// indexed past the end of the WTF::Vector, crashing the process instead of
// throwing a catchable error.
it("internal SQL helpers reject out-of-range database handles", async () => {
  const src = `
    const { SQL } = require("bun:internal-for-testing");
    const ctor = SQL[0];
    const tuple = SQL[1];

    // No databases have been opened, so databases().size() === 0 and handle 0
    // is out of range. Each call must throw "Invalid database handle" rather
    // than fall through to databases()[0] and crash.
    const results = [];
    for (const [name, fn] of [
      ["isInTransaction", () => ctor.isInTransaction(0)],
      ["prepare", () => ctor.prepare(0, "SELECT 1", undefined, 0, 0)],
      ["run", () => ctor.run(0, 0, tuple, "SELECT 1")],
    ]) {
      try {
        fn();
        results.push(name + ": no throw");
      } catch (e) {
        results.push(name + ": " + e.message);
      }
    }
    console.log(JSON.stringify(results));
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", src],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect({ stdout: stdout.trim(), stderr, exitCode }).toEqual({
    stdout: JSON.stringify([
      "isInTransaction: Invalid database handle",
      "prepare: Invalid database handle",
      "run: Invalid database handle",
    ]),
    stderr: "",
    exitCode: 0,
  });
});

// Property getters on a bindings object run arbitrary JS in the middle of the
// bind loop. A getter for a later parameter must not be able to (1) change the
// bytes sqlite stores for an earlier blob parameter by mutating/detaching its
// ArrayBuffer after it was bound, or (2) keep the bind/step loop running on a
// statement it just finalized. Run in a subprocess because the unsafe variant
// of (2) operates on a freed sqlite3_stmt.
it("binds blob parameters by copy and rejects statements finalized while binding", async () => {
  const src = `
    const { Database } = require("bun:sqlite");
    const out = {};

    // 1. The getter for $b mutates and detaches the buffer that was already
    //    bound for $a. The stored blob must be the bytes as they were at bind
    //    time, not whatever the buffer's memory holds when the query runs.
    {
      const db = new Database(":memory:");
      db.run("CREATE TABLE t (a BLOB, b INT)");
      const ab = new ArrayBuffer(256);
      const u8 = new Uint8Array(ab);
      u8.fill(0xab);
      db.run("INSERT INTO t VALUES ($a, $b)", {
        get $a() {
          return u8;
        },
        get $b() {
          u8.fill(0xee);
          ab.transfer();
          return 1;
        },
      });
      const row = db.query("SELECT a, b FROM t").get();
      out.blobLength = row.a.length;
      out.blobIsOriginal = row.a.every(byte => byte === 0xab);
      out.b = row.b;
      db.close();
    }

    // 2. A getter that finalizes the statement whose parameters are being
    //    bound must result in an error, not continued use of the statement.
    {
      const db = new Database(":memory:");
      const q = db.query("SELECT $x AS x");
      let message = "did not throw";
      try {
        q.get({
          get $x() {
            q.finalize();
            return 1;
          },
        });
      } catch (e) {
        message = e.message;
      }
      out.finalizeDuringBind = message;
      out.dbStillWorks = db.query("SELECT 123 AS y").get().y;
      db.close();
    }

    // 3. Plain blob binding still round-trips.
    {
      const db = new Database(":memory:");
      db.run("CREATE TABLE t (a BLOB)");
      db.run("INSERT INTO t VALUES ($a)", { $a: new Uint8Array([1, 2, 3]) });
      out.plainBlob = Array.from(db.query("SELECT a FROM t").get().a);
      db.close();
    }

    console.log(JSON.stringify(out));
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", src],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(stdout.trim()).toBe(
    JSON.stringify({
      blobLength: 256,
      blobIsOriginal: true,
      b: 1,
      finalizeDuringBind: "Statement has finalized",
      dbStillWorks: 123,
      plainBlob: [1, 2, 3],
    }),
  );
  expect(exitCode).toBe(0);
});

// Pushing a result row into the output array can re-enter JavaScript when an
// indexed accessor is installed on Array.prototype. If that JS finalizes the
// statement being iterated, the row-collection loop must stop with an error
// instead of stepping the freed sqlite3_stmt. Run in a subprocess because the
// unsafe variant operates on freed memory and because installing an indexed
// accessor on Array.prototype affects every array in the process.
it("all() reports an error when a result-row push finalizes the statement", async () => {
  const src = `
    const { Database } = require("bun:sqlite");
    const out = {};

    const db = new Database(":memory:");
    db.exec("CREATE TABLE t (a INTEGER)");
    db.run("INSERT INTO t VALUES (1), (2), (3)");

    const stmt = db.query("SELECT a FROM t ORDER BY a ASC");
    Object.defineProperty(Array.prototype, 0, {
      configurable: true,
      get() {
        return undefined;
      },
      set(_row) {
        stmt.finalize();
      },
    });

    let message = "did not throw";
    try {
      stmt.all();
    } catch (e) {
      message = e.message;
    }
    out.finalizeDuringAll = message;

    // Remove the accessor; result collection must still work afterwards.
    delete Array.prototype[0];
    out.rows = db.query("SELECT a FROM t ORDER BY a DESC").all();
    db.close();

    console.log(JSON.stringify(out));
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", src],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(stdout.trim()).toBe(
    JSON.stringify({
      finalizeDuringAll: "Statement has finalized",
      rows: [{ a: 3 }, { a: 2 }, { a: 1 }],
    }),
  );
  expect(exitCode).toBe(0);
});

// Binding an ArrayStorage-backed sparse array whose public length exceeds the
// number of slots in its backing vector must not read JSValues from beyond the
// vector. Holes fall back to the slow indexed lookup and bind as NULL. Run in
// a subprocess because the unsafe variant reads out-of-bounds heap memory.
it("binds sparse array holes as NULL instead of reading past the backing store", async () => {
  const src = `
    const { Database } = require("bun:sqlite");
    const out = {};
    const db = new Database(":memory:");

    // defineProperty with non-default attributes followed by growing .length
    // forces the array into ArrayStorage with a public length (3) larger than
    // the number of elements actually stored in the butterfly vector.
    const params = [];
    Object.defineProperty(params, 0, {
      value: 1,
      configurable: true,
      enumerable: true,
      writable: false,
    });
    params.length = 3;

    out.sparse = db.query("SELECT ?1 AS a, ?2 AS b, ?3 AS c").get(params);

    // A plain dense array still binds positionally.
    out.dense = db.query("SELECT ?1 AS a, ?2 AS b, ?3 AS c").get([4, 5, 6]);
    db.close();

    console.log(JSON.stringify(out));
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", src],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(stdout.trim()).toBe(
    JSON.stringify({
      sparse: { a: 1, b: null, c: null },
      dense: { a: 4, b: 5, c: 6 },
    }),
  );
  expect(exitCode).toBe(0);
});

it("run() reports a closed database when a bound parameter's getter closes it", async () => {
  const src = `
    const { Database } = require("bun:sqlite");
    const out = {};

    const db = new Database(":memory:");
    db.run("CREATE TABLE t (a TEXT, b TEXT)");

    let message = "did not throw";
    try {
      db.run("INSERT INTO t (a, b) VALUES ($a, $b)", {
        get $a() {
          db.close();
          return "x";
        },
        get $b() {
          return "y";
        },
      });
    } catch (e) {
      message = e.message;
    }
    out.closeDuringBind = message;

    const db2 = new Database(":memory:");
    db2.run("CREATE TABLE t (a TEXT, b TEXT)");
    db2.run("INSERT INTO t (a, b) VALUES ($a, $b)", { $a: "x", $b: "y" });
    out.plain = db2.query("SELECT a, b FROM t").get();
    db2.close();

    console.log(JSON.stringify(out));
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", src],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect({ stdout: stdout.trim(), exitCode }).toEqual({
    stdout: JSON.stringify({
      closeDuringBind: "Database has closed",
      plain: { a: "x", b: "y" },
    }),
    exitCode: 0,
  });
});

// Several SQLITE_FCNTL_* opcodes (VFSNAME, MMAP_SIZE, FILE_POINTER, ...) write
// a full pointer or int64 through the result argument, so the result buffer
// must be at least 8 bytes. A 1-byte Uint8Array used to be passed through
// as-is and overflowed.
it("fileControl rejects result TypedArrays smaller than 8 bytes", () => {
  const dir = tempDirWithFiles("sqlite-fcntl-bounds", { "empty.txt": "" });
  const db = new Database(path.join(dir, "my.db"));

  expect(() => db.fileControl(constants.SQLITE_FCNTL_PERSIST_WAL, new Uint8Array(1))).toThrow(
    "TypedArray must be at least 8 bytes",
  );
  expect(() => db.fileControl(constants.SQLITE_FCNTL_PERSIST_WAL, new Uint8Array(7))).toThrow(
    "TypedArray must be at least 8 bytes",
  );

  // 8-byte buffers and plain numbers still work.
  expect(db.fileControl(constants.SQLITE_FCNTL_PERSIST_WAL, new Uint8Array(8))).toBe(0);
  expect(db.fileControl(constants.SQLITE_FCNTL_PERSIST_WAL, 0)).toBe(0);
  // Pointer-returning opcodes get an 8-byte output slot even when JS passes a
  // plain number for the result argument.
  expect(db.fileControl(constants.SQLITE_FCNTL_VFSNAME, 0)).toBe(0);

  db.close();
});

it("decodes non-UTF-8 TEXT leniently and consistently across the 64-byte boundary", () => {
  const db = new Database(":memory:");
  const q = bytes => db.query(`SELECT CAST(x'${Buffer.from(bytes).toString("hex")}' AS TEXT) t`);

  // Short non-UTF-8 TEXT (4 bytes, Latin-1 "José") used to be silently dropped to "".
  // It must now decode leniently with U+FFFD, matching node:sqlite.
  const stmt = q([0x4a, 0x6f, 0x73, 0xe9]);
  expect(stmt.get().t).toBe("Jos�");
  expect(stmt.all()).toEqual([{ t: "Jos�" }]);
  expect(stmt.values()).toEqual([["Jos�"]]);

  // The decoder previously switched implementations at len === 64. Verify the
  // same invalid trailing byte yields the same replacement on both sides of
  // that boundary so there is no length-dependent discontinuity.
  for (const n of [1, 4, 32, 63, 64, 65, 100]) {
    const bytes = Buffer.alloc(n, 0x61);
    bytes[n - 1] = 0xe9;
    expect(q(bytes).get().t).toBe(Buffer.alloc(n - 1, "a").toString() + "�");
  }

  // Valid UTF-8 short strings are unaffected.
  expect(q(Buffer.from("héllo")).get().t).toBe("héllo");
  expect(q(Buffer.from("👋")).get().t).toBe("👋");

  db.close();
});

it("decodes non-UTF-8 column names leniently instead of dropping the column", () => {
  // SQLite does not validate UTF-8 in identifiers, so a database created by an
  // external tool can have a column name containing raw non-UTF-8 bytes. The
  // column-name decoder used strict fromUTF8, which returns a null string on any
  // invalid byte; two such names then both collapsed to "" and collided, silently
  // dropping one column from every row (and tripping a null-AtomString assertion
  // in debug builds). Decode leniently to U+FFFD instead.
  const file = tmpbase + `sqlite-badcols-${Date.now()}-${(Math.random() * 1e9) | 0}.db`;

  const setup = new Database(file, { create: true });
  // Distinctive, same-length ASCII names so we can binary-patch them in place.
  setup.run(`CREATE TABLE t ("Xaa" INTEGER, "Ybb" INTEGER)`);
  setup.run("INSERT INTO t VALUES (1, 2)");
  setup.close();

  // Replace the ASCII names inside the stored CREATE TABLE text with the same
  // length but different invalid lead bytes (0xE9, 0xFF) so the two names decode
  // to distinct replacement strings and must not collide.
  const buf = readFileSync(file);
  const patch = (find, replacement) => {
    const at = buf.indexOf(Buffer.from(find, "latin1"));
    expect(at).toBeGreaterThanOrEqual(0);
    Buffer.from(replacement).copy(buf, at);
  };
  patch('"Xaa"', [0x22, 0x58, 0xe9, 0x61, 0x22]); // "X\xe9a"
  patch('"Ybb"', [0x22, 0x59, 0xff, 0x62, 0x22]); // "Y\xffb"
  writeFileSync(file, buf);

  const db = new Database(file);
  const q = db.query("SELECT * FROM t");
  const row = q.get();

  // Both columns survive with distinct, leniently-decoded names; no data is lost.
  expect(q.columnNames).toEqual(["X\uFFFDa", "Y\uFFFDb"]);
  expect(row).toEqual({ "X\uFFFDa": 1, "Y\uFFFDb": 2 });

  db.close();
});

it("expands bound non-UTF-8 values in Statement#toString instead of returning an empty string", () => {
  const db = new Database(":memory:");
  const stmt = db.prepare("SELECT ? AS x");

  // A lone surrogate binds via sqlite3_bind_text16 and is stored by SQLite as
  // invalid UTF-8. sqlite3_expanded_sql() then returns those bytes, which the
  // strict decoder turned into a null string -> the whole toString() became "".
  stmt.get("\uD800");
  expect(String(stmt)).toBe("SELECT '\uFFFD\uFFFD\uFFFD' AS x");

  // Valid values still round-trip.
  stmt.get("ok");
  expect(String(stmt)).toBe("SELECT 'ok' AS x");

  db.close();
});

it("decodes declared types leniently and accepts single-character declared types", () => {
  // A single-character declared type is valid SQLite but tripped a length>1 assert
  // (jsNontrivialString). A non-UTF-8 declared type from an externally-created DB
  // decoded to a null string and then null-dereferenced. Both must work now.
  const mem = new Database(":memory:");
  mem.run(`CREATE TABLE t (a "X", b "INTEGER")`);
  const s0 = mem.query("SELECT a, b FROM t");
  s0.all();
  expect(s0.declaredTypes).toEqual(["X", "INTEGER"]);
  mem.close();

  // Non-UTF-8 declared type: patch "INTQGER" -> "INT\xe9GER" in the stored schema.
  const file = tmpbase + `sqlite-decltype-${Date.now()}-${(Math.random() * 1e9) | 0}.db`;
  const setup = new Database(file, { create: true });
  setup.run(`CREATE TABLE t (a "INTQGER")`);
  setup.run("INSERT INTO t VALUES (5)");
  setup.close();

  const buf = readFileSync(file);
  const at = buf.indexOf(Buffer.from("INTQGER", "latin1"));
  expect(at).toBeGreaterThanOrEqual(0);
  buf[at + 3] = 0xe9; // the "Q" -> 0xe9
  writeFileSync(file, buf);

  const db = new Database(file);
  const s = db.query("SELECT a FROM t");
  s.all();
  expect(s.declaredTypes).toEqual(["INT\uFFFDGER"]);
  db.close();
});

// The process-global SQLite database registry is shared by every Worker
// thread. Concurrent opens, prepares, serialize/deserialize, and closes from
// several Workers must not corrupt the registry while its backing storage
// grows. Run in a subprocess so a crash shows up as a non-zero exit code
// instead of taking down the test runner.
it("keeps database handles working when many Workers open databases concurrently", async () => {
  const dir = tempDirWithFiles("sqlite-worker-registry", {
    "main.js": `
      import { Database } from "bun:sqlite";

      const WORKER_COUNT = 4;
      const workerUrl = new URL("./worker.js", import.meta.url).href;

      const results = await Promise.all(
        Array.from({ length: WORKER_COUNT }, () => {
          return new Promise((resolve, reject) => {
            const worker = new Worker(workerUrl);
            worker.onmessage = event => {
              resolve(event.data);
              worker.terminate();
            };
            worker.onerror = event => {
              reject(new Error(event.message ?? "worker error"));
              worker.terminate();
            };
          });
        }),
      );

      // The main thread's own database still works after the Workers churned
      // the shared registry.
      const db = new Database(":memory:");
      db.exec("CREATE TABLE t (a INTEGER)");
      db.run("INSERT INTO t VALUES (42)");
      const main = db.query("SELECT a FROM t").get().a;
      db.close();

      console.log(JSON.stringify({ workers: results, main }));
    `,
    "worker.js": `
      import { Database } from "bun:sqlite";

      const ROUNDS = 12;
      const DBS_PER_ROUND = 8;
      const ROWS = 4;

      let total = 0;
      for (let round = 0; round < ROUNDS; round++) {
        const dbs = [];
        for (let i = 0; i < DBS_PER_ROUND; i++) {
          const db = new Database(":memory:");
          db.exec("CREATE TABLE t (a INTEGER, b TEXT)");
          const insert = db.query("INSERT INTO t (a, b) VALUES (?1, ?2)");
          for (let j = 0; j < ROWS; j++) insert.run(j, "row" + j);
          total += db.query("SELECT count(*) AS n FROM t").get().n;

          // serialize() and deserialize() index into / append to the same
          // process-wide registry as open().
          const restored = Database.deserialize(db.serialize());
          total += restored.query("SELECT count(*) AS n FROM t").get().n;
          restored.close();

          dbs.push(db);
        }
        for (const db of dbs) db.close();
      }

      const expected = ROUNDS * DBS_PER_ROUND * ROWS * 2;
      postMessage(total === expected ? "ok" : "bad total: " + total + " expected " + expected);
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "main.js"],
    env: bunEnv,
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect({ stdout: stdout.trim(), stderr, exitCode }).toEqual({
    stdout: JSON.stringify({ workers: ["ok", "ok", "ok", "ok"], main: 42 }),
    stderr: "",
    exitCode: 0,
  });
}, 30000);

it("exit-time WAL checkpoint runs even with a never-finalized prepared statement", async () => {
  // Sibling of the node:sqlite test. With un-finalized statements, close_v2
  // zombifies the connection and defers the WAL checkpoint to a finalize
  // that never comes; Bun__closeAllSQLiteDatabasesForTermination now
  // checkpoints explicitly first.
  const dir = tempDirWithFiles("bun-sqlite-exit-zombie", {});
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const { Database } = require('bun:sqlite');
       const db = new Database('exit.db');
       db.exec('PRAGMA journal_mode = WAL');
       db.exec('CREATE TABLE t (x INTEGER)');
       const stmt = db.prepare('INSERT INTO t VALUES (?)');
       stmt.run(42);
       // stmt stays referenced and is never finalized; db is never closed.
       console.log(require('node:fs').statSync('exit.db-wal').size > 0);`,
    ],
    env: bunEnv,
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stdout).toBe("true\n");
  const wal = path.join(dir, "exit.db-wal");
  // TRUNCATE moved every frame into exit.db (or the sidecar was unlinked
  // by a full close). Either way, no un-checkpointed data is stranded.
  expect(existsSync(wal) ? statSync(wal).size : 0).toBe(0);
  const verify = new Database(path.join(dir, "exit.db"));
  expect(verify.query("SELECT x FROM t").get().x).toBe(42);
  verify.close();
  expect(exitCode).toBe(0);
});

// sqlite3_prepare_v3 treats an interior NUL byte as end-of-SQL. The exec/run
// multi-statement loop used to re-prepare the same empty statement forever
// once the head reached a NUL, pinning the event loop at 100% CPU.
it("exec/run with an embedded NUL byte in the SQL string does not hang", async () => {
  const src = `
    const { Database } = require("bun:sqlite");
    const db = new Database(":memory:");
    const results = [];
    const cases = [
      ["lone", () => db.exec("\\0")],
      ["trailing", () => db.exec("select 1\\0")],
      ["leading", () => db.exec("\\0select 1")],
      ["mid", () => db.exec("select 1\\0; select 2")],
      ["run", () => db.run("select ?\\0x", [1])],
    ];
    for (const [name, fn] of cases) {
      try {
        fn();
        results.push(name + ": ok");
      } catch (e) {
        results.push(name + ": " + e.message);
      }
    }
    console.log(JSON.stringify(results));
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", src],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
    // Kill switch: before the fix, the first case spun forever at 100% CPU.
    timeout: 20_000,
    killSignal: "SIGKILL",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const empty = "Query contained no valid SQL statement; likely empty query.";
  expect({ stdout: stdout.trim(), stderr, signalCode: proc.signalCode, exitCode }).toEqual({
    stdout: JSON.stringify(["lone: " + empty, "trailing: ok", "leading: " + empty, "mid: ok", "run: ok"]),
    stderr: "",
    signalCode: null,
    exitCode: 0,
  });
});

async function waitForAsyncSQLiteStats(stats, predicate, description) {
  const maxYields = 10_000;
  for (let i = 0; i < maxYields; i++) {
    const current = stats();
    if (predicate(current)) return;
    await new Promise(resolve => setImmediate(resolve));
  }
  throw new Error(`${description}: ${JSON.stringify(stats())}`);
}

describe("async SQLite task substrate (Gate A private)", () => {
  it("runs an async SQLite task off-thread, remains responsive, and cleans up GC roots", async () => {
    const { asyncSQLiteTaskForTesting, asyncSQLiteTaskStatsForTesting } = await import("bun:internal-for-testing");
    expect(typeof asyncSQLiteTaskForTesting).toBe("function");
    expect(typeof asyncSQLiteTaskStatsForTesting).toBe("function");

    const dir = tempDirWithFiles("sqlite-async-gate-a", { "empty.txt": "" });
    const file = path.join(dir, "gate.db");
    const blocker = new Database(file);
    const controller = new AbortController();

    try {
      blocker.exec("CREATE TABLE gate (value INTEGER)");
      blocker.exec("BEGIN IMMEDIATE");

      const baseline = asyncSQLiteTaskStatsForTesting();
      const task = asyncSQLiteTaskForTesting(file, controller.signal);
      task.result.catch(() => {});

      const started = await task.started;
      expect(started.offThread).toBe(true);

      Bun.gc(true);
      blocker.exec("COMMIT");

      expect(await task.result).toBe(1);
      expect(blocker.query("SELECT value FROM gate").all()).toEqual([{ value: 1 }]);

      await waitForAsyncSQLiteStats(
        asyncSQLiteTaskStatsForTesting,
        current => {
          return (
            current.liveJobs === baseline.liveJobs &&
            current.liveResults === baseline.liveResults &&
            current.liveRequests === baseline.liveRequests &&
            current.liveAbortAlgorithms === baseline.liveAbortAlgorithms
          );
        },
        "async SQLite task counters did not return to baseline",
      );

      const final = asyncSQLiteTaskStatsForTesting();
      expect(final.liveJobs).toBe(baseline.liveJobs);
      expect(final.liveResults).toBe(baseline.liveResults);
      expect(final.liveRequests).toBe(baseline.liveRequests);
      expect(final.liveAbortAlgorithms).toBe(baseline.liveAbortAlgorithms);
      expect(final.completionsRun).toBe(baseline.completionsRun + 1);
      expect(final.postFailures).toBe(baseline.postFailures);
      expect(final.completionsDropped).toBe(baseline.completionsDropped);
    } finally {
      blocker.close();
    }
  });

  it("tears down running and queued async SQLite tasks after Worker termination", async () => {
    const rounds = isASAN || isDebug ? 2 : 6;
    const dir = tempDirWithFiles("sqlite-async-gate-a-workers", {
      "main.js": `
        import { Database } from "bun:sqlite";
        import { Worker } from "node:worker_threads";

        const { asyncSQLiteTaskStatsForTesting } = await import("bun:internal-for-testing");
        const ROUND_COUNT = ${rounds};
        const workerURL = new URL("./worker.js", import.meta.url);

        const waitForCondition = async (predicate, describeCurrent) => {
          const maxYields = 10_000;
          for (let i = 0; i < maxYields; i++) {
            if (predicate()) return;
            await new Promise(resolve => setImmediate(resolve));
          }
          throw new Error(describeCurrent());
        };

        const failIf = (condition, message) => {
          if (condition) throw new Error(message);
        };

        const runRound = async (db, dbPath, round) => {
          const baseline = asyncSQLiteTaskStatsForTesting();
          const workers = Array.from({ length: 3 }, () => new Worker(workerURL, {
            type: "module",
            workerData: dbPath,
          }));
          let allWorkersTerminated = false;
          let scheduledCount = 0;
          let startedCount = 0;
          const startedWorkers = new Set();
          const terminatedWorkers = new Set();
          let resolveScheduled;
          let rejectScheduled;
          let resolveStarted;
          let rejectStarted;
          const allScheduled = new Promise((resolve, reject) => {
            resolveScheduled = resolve;
            rejectScheduled = reject;
          });
          const twoStarted = new Promise((resolve, reject) => {
            resolveStarted = resolve;
            rejectStarted = reject;
          });
          let failed = false;
          const failHandshake = error => {
            if (failed) return;
            failed = true;
            rejectScheduled(error);
            rejectStarted(error);
          };

          for (const worker of workers) {
            worker.on("message", message => {
              if (message.type === "scheduled") {
                scheduledCount++;
                if (scheduledCount === workers.length) resolveScheduled();
              } else if (message.type === "started") {
                if (message.offThread !== true) {
                  failHandshake(new Error("async SQLite task did not start off-thread"));
                  return;
                }
                startedWorkers.add(worker);
                startedCount = startedWorkers.size;
                if (startedCount === 2) resolveStarted();
              } else if (message.type === "error") {
                failHandshake(new Error(message.message));
              }
            });
            worker.on("error", failHandshake);
          }

          try {
            await allScheduled;
            await twoStarted;
            failIf(scheduledCount !== 3, "not all async SQLite tasks were scheduled");
            failIf(startedCount !== 2, "expected exactly two running async SQLite tasks");
            await waitForCondition(
              () => asyncSQLiteTaskStatsForTesting().activeTaskDatabases === baseline.activeTaskDatabases + 2,
              () =>
                "two async SQLite tasks did not publish active databases: " +
                JSON.stringify(asyncSQLiteTaskStatsForTesting()),
            );

            const terminateWorker = async worker => {
              const exited = new Promise(resolve => worker.once("exit", resolve));
              const terminated = worker.terminate();
              await Promise.all([terminated, exited]);
              terminatedWorkers.add(worker);
            };
            const queuedWorker = workers.find(worker => !startedWorkers.has(worker));
            failIf(!queuedWorker, "expected one queued async SQLite task");
            await terminateWorker(queuedWorker);
            await Promise.all([...startedWorkers].map(terminateWorker));
            allWorkersTerminated = true;

            const afterTermination = asyncSQLiteTaskStatsForTesting();
            failIf(
              afterTermination.liveRequests !== baseline.liveRequests,
              "Worker teardown left native async SQLite requests alive",
            );
            failIf(
              afterTermination.liveAbortAlgorithms !== baseline.liveAbortAlgorithms,
              "Worker teardown left native AbortSignal algorithms alive",
            );

            db.exec("COMMIT");
            await waitForCondition(
              () => {
                const current = asyncSQLiteTaskStatsForTesting();
                return (
                  current.liveJobs === baseline.liveJobs &&
                  current.liveResults === baseline.liveResults &&
                  current.liveRequests === baseline.liveRequests &&
                  current.liveAbortAlgorithms === baseline.liveAbortAlgorithms
                );
              },
              () => "terminated async SQLite counters did not return to baseline: " +
                JSON.stringify(asyncSQLiteTaskStatsForTesting()),
            );

            const final = asyncSQLiteTaskStatsForTesting();
            failIf(final.activeTaskDatabases !== baseline.activeTaskDatabases, "active task databases did not return to baseline");
            failIf(final.taskInterrupts !== baseline.taskInterrupts + 2, "expected two interrupts for published task databases");
            failIf(final.deliveryDisabledDrops !== baseline.deliveryDisabledDrops + 3, "expected three delivery-disabled drops");
            failIf(final.postFailures !== baseline.postFailures, "delivery-disabled completions must not attempt posts");
            failIf(final.completionsRun !== baseline.completionsRun, "terminated tasks must not run completions");
            failIf(final.completionsDropped !== baseline.completionsDropped, "delivery-disabled completions must not create captures");
            failIf(final.liveJobs !== baseline.liveJobs, "native async SQLite jobs leaked");
            failIf(final.liveResults !== baseline.liveResults, "native async SQLite results leaked");
            failIf(final.liveRequests !== baseline.liveRequests, "native async SQLite requests leaked");
            failIf(final.liveAbortAlgorithms !== baseline.liveAbortAlgorithms, "native AbortSignal algorithms leaked");

            return {
              round,
              scheduled: scheduledCount,
              started: startedCount,
              activeTaskDatabases: final.activeTaskDatabases - baseline.activeTaskDatabases,
              taskInterrupts: final.taskInterrupts - baseline.taskInterrupts,
              deliveryDisabledDrops: final.deliveryDisabledDrops - baseline.deliveryDisabledDrops,
              postFailures: final.postFailures - baseline.postFailures,
              completionsRun: final.completionsRun - baseline.completionsRun,
              completionsDropped: final.completionsDropped - baseline.completionsDropped,
            };
          } finally {
            if (!allWorkersTerminated) {
              await Promise.all(workers.filter(worker => !terminatedWorkers.has(worker)).map(worker => worker.terminate()));
            }
          }
        };

        const dbPath = "gate.db";
        const db = new Database(dbPath);
        db.exec("CREATE TABLE gate (value INTEGER)");
        const summaries = [];
        try {
          for (let round = 0; round < ROUND_COUNT; round++) {
            db.exec("BEGIN IMMEDIATE");
            summaries.push(await runRound(db, dbPath, round));
          }
        } finally {
          db.close();
        }

        console.log(JSON.stringify({ rounds: summaries }));
      `,
      "worker.js": `
        import { parentPort, workerData } from "node:worker_threads";

        const { asyncSQLiteTaskForTesting } = await import("bun:internal-for-testing");
        const controller = new AbortController();
        const task = asyncSQLiteTaskForTesting(workerData, controller.signal);

        parentPort.postMessage({ type: "scheduled" });
        Bun.gc(true);
        task.result.catch(() => {});
        task.started.then(
          ({ offThread }) => parentPort.postMessage({ type: "started", offThread }),
          error => parentPort.postMessage({ type: "error", message: error?.message ?? String(error) }),
        );
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "main.js"],
      env: {
        ...bunEnv,
        UV_THREADPOOL_SIZE: "2",
        BUN_DESTRUCT_VM_ON_EXIT: "1",
      },
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout.trim(), stderr, exitCode }).toMatchObject({
      stdout: JSON.stringify({
        rounds: Array.from({ length: rounds }, (_, round) => ({
          round,
          scheduled: 3,
          started: 2,
          activeTaskDatabases: 0,
          taskInterrupts: 2,
          deliveryDisabledDrops: 3,
          postFailures: 0,
          completionsRun: 0,
          completionsDropped: 0,
        })),
      }),
      exitCode: 0,
    });
  }, 30000);
});

describe("async SQLite connection core (Gate B private)", () => {
  it("opens and closes a file-backed connection off-thread", async () => {
    const {
      asyncSQLiteConnectionOpenForTesting,
      asyncSQLiteConnectionExecForTesting,
      asyncSQLiteConnectionCloseForTesting,
    } = await import("bun:internal-for-testing");
    expect(typeof asyncSQLiteConnectionOpenForTesting).toBe("function");

    const dir = tempDirWithFiles("sqlite-async-gate-b-open", { "empty.txt": "" });
    const file = path.join(dir, "gate-b.db");
    const connection = asyncSQLiteConnectionOpenForTesting(file, 4);
    expect((await connection.ready).offThread).toBe(true);
    await asyncSQLiteConnectionExecForTesting(connection.id, "CREATE TABLE gate (value INTEGER)");
    await asyncSQLiteConnectionCloseForTesting(connection.id);
    await expect(asyncSQLiteConnectionCloseForTesting(connection.id)).resolves.toBe(false);
  });

  it("does not alias forged or non-safe private connection IDs", async () => {
    const {
      asyncSQLiteConnectionOpenForTesting,
      asyncSQLiteConnectionExecForTesting,
      asyncSQLiteConnectionCloseForTesting,
    } = await import("bun:internal-for-testing");
    const file = path.join(tempDirWithFiles("sqlite-async-gate-b-ids", { "empty.txt": "" }), "gate-b.db");
    const connection = asyncSQLiteConnectionOpenForTesting(file, 4);
    await connection.ready;
    await asyncSQLiteConnectionExecForTesting(connection.id, "CREATE TABLE gate (value INTEGER)");

    const forgedId = connection.id + 2 ** 32;
    const [forgedExec] = await Promise.allSettled([
      asyncSQLiteConnectionExecForTesting(forgedId, "INSERT INTO gate VALUES (100)"),
    ]);
    const forgedClose = await asyncSQLiteConnectionCloseForTesting(forgedId).then(
      value => ({ status: "fulfilled", value }),
      error => ({ status: "rejected", message: error?.message }),
    );
    const [originalExec] = await Promise.allSettled([
      asyncSQLiteConnectionExecForTesting(connection.id, "INSERT INTO gate VALUES (1)"),
    ]);
    const originalClose = await asyncSQLiteConnectionCloseForTesting(connection.id);

    const db = new Database(file);
    let rows;
    try {
      rows = db.query("SELECT value FROM gate ORDER BY value").all();
    } finally {
      db.close();
    }

    expect({
      forgedExec: forgedExec.status,
      forgedClose,
      originalExec: originalExec.status,
      originalClose,
      rows,
    }).toEqual({
      forgedExec: "rejected",
      forgedClose: { status: "fulfilled", value: false },
      originalExec: "fulfilled",
      originalClose: true,
      rows: [{ value: 1 }],
    });
    await expect(asyncSQLiteConnectionExecForTesting(Number.MAX_SAFE_INTEGER + 1, "SELECT 1")).rejects.toThrow(
      "connection ID must be a finite, non-negative safe integer",
    );
    await expect(asyncSQLiteConnectionCloseForTesting(Number.MAX_SAFE_INTEGER + 1)).rejects.toThrow(
      "connection ID must be a finite, non-negative safe integer",
    );
  });

  it("executes accepted operations in FIFO order with one active operation", async () => {
    const {
      asyncSQLiteConnectionOpenForTesting,
      asyncSQLiteConnectionExecForTesting,
      asyncSQLiteConnectionCloseForTesting,
    } = await import("bun:internal-for-testing");
    const file = path.join(tempDirWithFiles("sqlite-async-gate-b-fifo", { "empty.txt": "" }), "gate-b.db");
    const connection = asyncSQLiteConnectionOpenForTesting(file, 8);
    await connection.ready;

    await asyncSQLiteConnectionExecForTesting(connection.id, "CREATE TABLE gate (value INTEGER)");
    const operations = [1, 2, 3, 4, 5].map(value =>
      asyncSQLiteConnectionExecForTesting(connection.id, `INSERT INTO gate VALUES (${value})`),
    );
    await Promise.all(operations);
    await asyncSQLiteConnectionCloseForTesting(connection.id);

    const db = new Database(file);
    try {
      expect(db.query("SELECT value FROM gate ORDER BY rowid").all()).toEqual(
        [1, 2, 3, 4, 5].map(value => ({ value })),
      );
    } finally {
      db.close();
    }
  });

  it("enforces the bounded queue and keeps running after an operation error", async () => {
    const {
      asyncSQLiteConnectionOpenForTesting,
      asyncSQLiteConnectionExecForTesting,
      asyncSQLiteConnectionCloseForTesting,
    } = await import("bun:internal-for-testing");
    const file = path.join(tempDirWithFiles("sqlite-async-gate-b-queue", { "empty.txt": "" }), "gate-b.db");
    const connection = asyncSQLiteConnectionOpenForTesting(file, 2, 60000);
    await connection.ready;
    await asyncSQLiteConnectionExecForTesting(connection.id, "CREATE TABLE gate (value INTEGER)");

    const blocker = new Database(file);
    try {
      blocker.exec("BEGIN IMMEDIATE");
      const active = asyncSQLiteConnectionExecForTesting(connection.id, "INSERT INTO gate VALUES (1)");
      const queued = asyncSQLiteConnectionExecForTesting(connection.id, "INSERT INTO gate VALUES (2)");
      await expect(asyncSQLiteConnectionExecForTesting(connection.id, "INSERT INTO gate VALUES (3)")).rejects.toThrow(
        "connection queue is full or closing",
      );
      blocker.exec("COMMIT");
      await expect(active).resolves.toBe(true);
      await expect(queued).resolves.toBe(true);

      await expect(asyncSQLiteConnectionExecForTesting(connection.id, "not valid SQL")).rejects.toThrow(
        'near "not": syntax error',
      );
      await expect(asyncSQLiteConnectionExecForTesting(connection.id, "INSERT INTO gate VALUES (4)")).resolves.toBe(
        true,
      );
      await asyncSQLiteConnectionCloseForTesting(connection.id);
    } finally {
      blocker.close();
    }
  });

  it("uses close as an admission fence and closes exactly once", async () => {
    const dir = tempDirWithFiles("sqlite-async-gate-b-close", {
      "main.js": `
        import { Database } from "bun:sqlite";
        import {
          asyncSQLiteConnectionCloseForTesting,
          asyncSQLiteConnectionExecForTesting,
          asyncSQLiteConnectionOpenForTesting,
          asyncSQLiteConnectionStatsForTesting,
        } from "bun:internal-for-testing";

        const waitForCondition = async (predicate, describeCurrent) => {
          const maxYields = 10_000;
          for (let i = 0; i < maxYields; i++) {
            if (predicate()) return;
            await new Promise(resolve => setImmediate(resolve));
          }
          throw new Error(describeCurrent());
        };

        const file = process.argv[2];
        const baseline = asyncSQLiteConnectionStatsForTesting();
        const connection = asyncSQLiteConnectionOpenForTesting(file, 4);
        const blocker = new Database(file);
        try {
          await connection.ready;
          await asyncSQLiteConnectionExecForTesting(connection.id, "CREATE TABLE gate (value INTEGER)");
          blocker.exec("BEGIN IMMEDIATE");
          const accepted = asyncSQLiteConnectionExecForTesting(connection.id, "INSERT INTO gate VALUES (1)");
          await waitForCondition(
            () => asyncSQLiteConnectionStatsForTesting().activeConnectionOperations === baseline.activeConnectionOperations + 1,
            () => "accepted operation did not become active: " + JSON.stringify(asyncSQLiteConnectionStatsForTesting()),
          );

          const closing = asyncSQLiteConnectionCloseForTesting(connection.id);
          let postCloseError;
          try {
            await asyncSQLiteConnectionExecForTesting(connection.id, "INSERT INTO gate VALUES (2)");
          } catch (error) {
            postCloseError = error;
          }
          if (postCloseError?.message !== "connection queue is full or closing")
            throw new Error("post-close admission did not reject: " + postCloseError?.message);

          blocker.exec("COMMIT");
          if (await accepted !== true)
            throw new Error("accepted operation did not settle successfully");
          if (await closing !== true)
            throw new Error("close did not settle successfully");
          if (await asyncSQLiteConnectionCloseForTesting(connection.id))
            throw new Error("repeated close must report false");

          await waitForCondition(
            () => {
              const stats = asyncSQLiteConnectionStatsForTesting();
              return (
                stats.liveConnections === baseline.liveConnections &&
                stats.liveJobs === baseline.liveJobs &&
                stats.liveResults === baseline.liveResults &&
                stats.liveRequests === baseline.liveRequests &&
                stats.activeConnectionOperations === baseline.activeConnectionOperations
              );
            },
            () => "close left native state live: " + JSON.stringify(asyncSQLiteConnectionStatsForTesting()),
          );
          const final = asyncSQLiteConnectionStatsForTesting();
          if (final.closeJobsRun !== baseline.closeJobsRun + 1)
            throw new Error("expected exactly one close job: " + JSON.stringify({ baseline, final }));
          if (final.physicalCloses !== baseline.physicalCloses + 1)
            throw new Error("expected exactly one physical close: " + JSON.stringify({ baseline, final }));
          console.log(JSON.stringify({
            accepted: true,
            closed: true,
            postCloseRejected: true,
            closeJobsRun: final.closeJobsRun - baseline.closeJobsRun,
            physicalCloses: final.physicalCloses - baseline.physicalCloses,
          }));
        } finally {
          blocker.close();
        }
      `,
    });
    const file = path.join(dir, "gate-b.db");
    await using proc = Bun.spawn({
      cmd: [bunExe(), "main.js", file],
      cwd: dir,
      env: { ...bunEnv, UV_THREADPOOL_SIZE: "2" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout.trim(), stderr, exitCode }).toMatchObject({
      stdout: JSON.stringify({
        accepted: true,
        closed: true,
        postCloseRejected: true,
        closeJobsRun: 1,
        physicalCloses: 1,
      }),
      exitCode: 0,
    });
  });

  it("drains accepted operations when close is requested during Opening", async () => {
    const dir = tempDirWithFiles("sqlite-async-gate-b-close-opening", {
      "main.js": `
        import { Database } from "bun:sqlite";
        import {
          asyncSQLiteConnectionCloseForTesting,
          asyncSQLiteConnectionExecForTesting,
          asyncSQLiteConnectionOpenForTesting,
          asyncSQLiteConnectionStatsForTesting,
          asyncSQLiteTaskForTesting,
        } from "bun:internal-for-testing";

        const waitForCondition = async (predicate, describeCurrent) => {
          const maxYields = 10_000;
          for (let i = 0; i < maxYields; i++) {
            if (predicate()) return;
            await new Promise(resolve => setImmediate(resolve));
          }
          throw new Error(describeCurrent());
        };

        const file = process.argv[2];
        const baseline = asyncSQLiteConnectionStatsForTesting();
        const blocker = new Database(file);
        try {
          blocker.exec("CREATE TABLE gate (value INTEGER)");
          blocker.exec("BEGIN IMMEDIATE");

          const blockers = [asyncSQLiteTaskForTesting(file), asyncSQLiteTaskForTesting(file)];
          await Promise.all(blockers.map(task => task.started));

          const connection = asyncSQLiteConnectionOpenForTesting(file, 4);
          let ready;
          let accepted;
          let closed;
          let readyError;
          let acceptedError;
          let closeError;
          let readySettled = false;
          let acceptedSettled = false;
          let closeSettled = false;
          connection.ready.then(
            value => {
              ready = value;
              readySettled = true;
            },
            error => {
              readyError = error;
              readySettled = true;
            },
          );
          asyncSQLiteConnectionExecForTesting(connection.id, "INSERT INTO gate VALUES (1)").then(
            value => {
              accepted = value;
              acceptedSettled = true;
            },
            error => {
              acceptedError = error;
              acceptedSettled = true;
            },
          );
          asyncSQLiteConnectionCloseForTesting(connection.id).then(
            value => {
              closed = value;
              closeSettled = true;
            },
            error => {
              closeError = error;
              closeSettled = true;
            },
          );
          let postCloseError;
          try {
            await asyncSQLiteConnectionExecForTesting(connection.id, "INSERT INTO gate VALUES (2)");
          } catch (error) {
            postCloseError = error;
          }
          blocker.exec("COMMIT");

          await Promise.all(blockers.map(task => task.result));
          await waitForCondition(
            () => readySettled && acceptedSettled && closeSettled,
            () =>
              "close during Opening did not settle accepted work: " +
              JSON.stringify({ ready, accepted, closed, readyError: readyError?.message, acceptedError: acceptedError?.message, closeError: closeError?.message, stats: asyncSQLiteConnectionStatsForTesting() }),
          );

          if (readyError || acceptedError || closeError)
            throw new Error(JSON.stringify({ readyError: readyError?.message, acceptedError: acceptedError?.message, closeError: closeError?.message }));
          if (!ready?.offThread || accepted !== true || closed !== true || postCloseError?.message !== "connection queue is full or closing")
            throw new Error(JSON.stringify({ ready, accepted, closed, postCloseError: postCloseError?.message }));
          if (await asyncSQLiteConnectionCloseForTesting(connection.id))
            throw new Error("repeated close must report false");
          if (blocker.query("SELECT value FROM gate").all().length !== 3)
            throw new Error("accepted operation did not run exactly once");

          await waitForCondition(
            () => {
              const stats = asyncSQLiteConnectionStatsForTesting();
              return (
                stats.liveConnections === baseline.liveConnections &&
                stats.liveJobs === baseline.liveJobs &&
                stats.liveResults === baseline.liveResults &&
                stats.liveRequests === baseline.liveRequests &&
                stats.activeConnectionOperations === baseline.activeConnectionOperations
              );
            },
            () => "close during Opening leaked native state: " + JSON.stringify(asyncSQLiteConnectionStatsForTesting()),
          );
          const final = asyncSQLiteConnectionStatsForTesting();
          if (final.closeJobsRun !== baseline.closeJobsRun + 1)
            throw new Error("expected exactly one close job: " + JSON.stringify({ baseline, final }));
          if (final.physicalCloses !== baseline.physicalCloses + 1)
            throw new Error("expected exactly one physical close: " + JSON.stringify({ baseline, final }));
          console.log(JSON.stringify({
            accepted,
            closed,
            postCloseRejected: !!postCloseError,
            closeJobsRun: final.closeJobsRun - baseline.closeJobsRun,
            physicalCloses: final.physicalCloses - baseline.physicalCloses,
          }));
        } finally {
          blocker.close();
        }
      `,
    });
    const file = path.join(dir, "gate-b.db");
    await using proc = Bun.spawn({
      cmd: [bunExe(), "main.js", file],
      cwd: dir,
      env: { ...bunEnv, UV_THREADPOOL_SIZE: "2" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout.trim(), stderr, exitCode }).toMatchObject({
      stdout: JSON.stringify({
        accepted: true,
        closed: true,
        postCloseRejected: true,
        closeJobsRun: 1,
        physicalCloses: 1,
      }),
      exitCode: 0,
    });
  });

  it("cleans up a failed open without leaking native state", async () => {
    const { asyncSQLiteConnectionOpenForTesting, asyncSQLiteConnectionStatsForTesting } = await import(
      "bun:internal-for-testing"
    );
    const baseline = asyncSQLiteConnectionStatsForTesting();
    const invalidPath = path.join(
      tempDirWithFiles("sqlite-async-gate-b-failure", { "directory": {} }),
      "missing",
      "db",
    );
    const connection = asyncSQLiteConnectionOpenForTesting(invalidPath, 2);
    await expect(connection.ready).rejects.toThrow("unable to open database file");
    await waitForAsyncSQLiteStats(
      asyncSQLiteConnectionStatsForTesting,
      current =>
        current.liveConnections === baseline.liveConnections &&
        current.liveJobs === baseline.liveJobs &&
        current.liveResults === baseline.liveResults &&
        current.liveRequests === baseline.liveRequests &&
        current.activeConnectionOperations === baseline.activeConnectionOperations,
      "failed Gate B open leaked native state",
    );
    expect(asyncSQLiteConnectionStatsForTesting().liveConnections).toBe(baseline.liveConnections);
  });

  it("rejects operations accepted while an invalid connection is Opening", async () => {
    const dir = tempDirWithFiles("sqlite-async-gate-b-failure-queued", {
      "main.js": `
        import { Database } from "bun:sqlite";
        import {
          asyncSQLiteConnectionExecForTesting,
          asyncSQLiteConnectionOpenForTesting,
          asyncSQLiteConnectionStatsForTesting,
          asyncSQLiteTaskForTesting,
        } from "bun:internal-for-testing";

        const waitForCondition = async (predicate, describeCurrent) => {
          const maxYields = 10_000;
          for (let i = 0; i < maxYields; i++) {
            if (predicate()) return;
            await new Promise(resolve => setImmediate(resolve));
          }
          throw new Error(describeCurrent());
        };

        const file = process.argv[2];
        const invalidPath = file + "/missing/gate.db";
        const baseline = asyncSQLiteConnectionStatsForTesting();
        const blocker = new Database(file);
        try {
          blocker.exec("CREATE TABLE gate (value INTEGER)");
          blocker.exec("BEGIN IMMEDIATE");
          const blockers = [asyncSQLiteTaskForTesting(file), asyncSQLiteTaskForTesting(file)];
          await Promise.all(blockers.map(task => task.started));

          const connection = asyncSQLiteConnectionOpenForTesting(invalidPath, 4);
          const accepted = [
            asyncSQLiteConnectionExecForTesting(connection.id, "INSERT INTO gate VALUES (1)"),
            asyncSQLiteConnectionExecForTesting(connection.id, "INSERT INTO gate VALUES (2)"),
          ];
          blocker.exec("COMMIT");

          const [ready, ...operations] = await Promise.allSettled([connection.ready, ...accepted]);
          await Promise.all(blockers.map(task => task.result));
          if (ready.status !== "rejected" || ready.reason?.message !== "unable to open database file")
            throw new Error("unexpected ready result: " + JSON.stringify(ready));
          if (
            operations.length !== accepted.length ||
            operations.some(result => result.status !== "rejected" || result.reason?.message !== "connection open failed")
          )
            throw new Error("unexpected queued operation results: " + JSON.stringify(operations));

          await waitForCondition(
            () => {
              const stats = asyncSQLiteConnectionStatsForTesting();
              return (
                stats.liveConnections === baseline.liveConnections &&
                stats.liveJobs === baseline.liveJobs &&
                stats.liveResults === baseline.liveResults &&
                stats.liveRequests === baseline.liveRequests &&
                stats.activeConnectionOperations === baseline.activeConnectionOperations
              );
            },
            () => "failed open with queued operations leaked native state: " + JSON.stringify(asyncSQLiteConnectionStatsForTesting()),
          );
          const final = asyncSQLiteConnectionStatsForTesting();
          if (final.closeJobsRun !== baseline.closeJobsRun || final.physicalCloses !== baseline.physicalCloses)
            throw new Error("failed open without close request scheduled a close: " + JSON.stringify({ baseline, final }));
          console.log(JSON.stringify({
            readyRejected: true,
            queuedRejected: operations.length,
            closeJobsRun: final.closeJobsRun - baseline.closeJobsRun,
            physicalCloses: final.physicalCloses - baseline.physicalCloses,
          }));
        } finally {
          blocker.close();
        }
      `,
    });
    const file = path.join(dir, "gate-b-failure.db");
    let proc;
    try {
      proc = Bun.spawn({
        cmd: [bunExe(), "main.js", file],
        cwd: dir,
        env: { ...bunEnv, UV_THREADPOOL_SIZE: "2" },
        stdout: "pipe",
        stderr: "pipe",
      });
      const stdoutPromise = proc.stdout.text();
      const stderrPromise = proc.stderr.text();
      const stdout = await stdoutPromise;
      expect(stdout.trim()).toBe(
        JSON.stringify({
          readyRejected: true,
          queuedRejected: 2,
          closeJobsRun: 0,
          physicalCloses: 0,
        }),
      );
      const [, exitCode] = await Promise.all([stderrPromise, proc.exited]);
      expect(exitCode).toBe(0);
    } finally {
      if (proc) await proc.exited;
    }
  });

  it("abandons an active and queued connection operation during Worker teardown", async () => {
    const { asyncSQLiteConnectionStatsForTesting } = await import("bun:internal-for-testing");
    const { Worker } = await import("node:worker_threads");
    const dir = tempDirWithFiles("sqlite-async-gate-b-worker", {
      "main.js": `
        import { parentPort, workerData } from "node:worker_threads";
        import {
          asyncSQLiteConnectionCloseForTesting,
          asyncSQLiteConnectionOpenForTesting,
          asyncSQLiteConnectionExecForTesting,
        } from "bun:internal-for-testing";
        const connection = asyncSQLiteConnectionOpenForTesting(workerData, 2, 60000);
        await connection.ready;
        const first = asyncSQLiteConnectionExecForTesting(connection.id, "INSERT INTO gate VALUES (1)");
        const second = asyncSQLiteConnectionExecForTesting(connection.id, "INSERT INTO gate VALUES (2)");
        const closing = asyncSQLiteConnectionCloseForTesting(connection.id);
        first.catch(() => {});
        second.catch(() => {});
        closing.catch(() => {});
        parentPort.postMessage("submitted");
        await new Promise(() => {});
      `,
    });
    const file = path.join(dir, "gate-b-worker.db");
    const blocker = new Database(file);
    let worker;
    try {
      blocker.exec("CREATE TABLE gate (value INTEGER)");
      blocker.exec("BEGIN IMMEDIATE");
      const baseline = asyncSQLiteConnectionStatsForTesting();
      worker = new Worker(path.join(dir, "main.js"), { type: "module", workerData: file });
      await new Promise((resolve, reject) => {
        worker.once("message", resolve);
        worker.once("error", reject);
        worker.once("exit", code => reject(new Error(`Worker exited before submitting work: ${code}`)));
      });
      await waitForAsyncSQLiteStats(
        asyncSQLiteConnectionStatsForTesting,
        current => current.activeConnectionOperations === baseline.activeConnectionOperations + 1,
        "Worker teardown did not publish an active Gate B connection operation",
      );
      await worker.terminate();
      worker = undefined;
      blocker.exec("COMMIT");
      await waitForAsyncSQLiteStats(
        asyncSQLiteConnectionStatsForTesting,
        current =>
          current.liveConnections === baseline.liveConnections &&
          current.liveJobs === baseline.liveJobs &&
          current.liveResults === baseline.liveResults &&
          current.liveRequests === baseline.liveRequests &&
          current.activeConnectionOperations === baseline.activeConnectionOperations,
        "Worker teardown leaked Gate B connection state",
      );
      const final = asyncSQLiteConnectionStatsForTesting();
      expect(final.liveConnections).toBe(baseline.liveConnections);
      expect(final.liveJobs).toBe(baseline.liveJobs);
      expect(final.liveResults).toBe(baseline.liveResults);
      expect(final.liveRequests).toBe(baseline.liveRequests);
      expect(final.activeConnectionOperations).toBe(baseline.activeConnectionOperations);
      expect(final.connectionInterrupts).toBe(baseline.connectionInterrupts + 1);
      expect(final.closeJobsRun).toBe(baseline.closeJobsRun + 1);
      expect(final.physicalCloses).toBe(baseline.physicalCloses + 1);
      expect(blocker.query("SELECT value FROM gate ORDER BY rowid").all()).toEqual([]);
    } finally {
      if (worker) await worker.terminate();
      blocker.close();
    }
  });
});

describe("async SQLite owned row results (Gate C prerequisite private)", () => {
  // Baseline restoration predicate shared by every Gate C test: all live native
  // ownership must return to the pre-test baseline. copiedRowValues is cumulative
  // and asserted separately, not here.
  const baselineRestored = baseline => current =>
    current.liveConnections === baseline.liveConnections &&
    current.liveJobs === baseline.liveJobs &&
    current.liveResults === baseline.liveResults &&
    current.liveRequests === baseline.liveRequests &&
    current.liveRows === baseline.liveRows &&
    current.liveErrors === baseline.liveErrors &&
    current.activeConnectionOperations === baseline.activeConnectionOperations;

  // Idempotent close registered immediately after open. `done` is set only after
  // a successful close so a rejected close can still be retried by finally,
  // avoiding double close and test poisoning.
  const makeClose = (closeForTesting, id) => {
    // Memoize the in-flight close so an unawaited getter close() and later cleanup
    // await the same operation; reset on rejection so a failed close can be retried.
    let pending = null;
    return () => {
      if (!pending) {
        pending = Promise.resolve(closeForTesting(id)).catch(err => {
          pending = null;
          throw err;
        });
      }
      return pending;
    };
  };

  it("returns owned column names and rows from a one-shot SELECT that survive finalization", async () => {
    const {
      asyncSQLiteConnectionOpenForTesting,
      asyncSQLiteConnectionQueryForTesting,
      asyncSQLiteConnectionCloseForTesting,
      asyncSQLiteConnectionStatsForTesting,
    } = await import("bun:internal-for-testing");
    expect(typeof asyncSQLiteConnectionQueryForTesting).toBe("function");

    const baseline = asyncSQLiteConnectionStatsForTesting();
    const dir = tempDirWithFiles("sqlite-async-gate-c", { "empty.txt": "" });
    const file = path.join(dir, "gate-c.db");
    const connection = asyncSQLiteConnectionOpenForTesting(file, 4);
    const close = makeClose(asyncSQLiteConnectionCloseForTesting, connection.id);
    try {
      expect((await connection.ready).offThread).toBe(true);

      // A literal one-shot SELECT covering every storage class the copy path must
      // own: NULL, INTEGER, REAL, non-ASCII TEXT, empty/embedded-NUL BLOB. A
      // second UNION ALL row exercises negatives, empty TEXT, single-byte BLOB.
      const result = await asyncSQLiteConnectionQueryForTesting(
        connection.id,
        "SELECT NULL AS a, 42 AS b, 3.5 AS c, 'héllo☃' AS d, x'' AS e, x'00ff00' AS f " +
          "UNION ALL SELECT NULL, -7, 0.0, '', x'01', x''",
      );

      expect(Array.isArray(result.columns)).toBe(true);
      expect(result.columns).toEqual(["a", "b", "c", "d", "e", "f"]);
      expect(Array.isArray(result.rows)).toBe(true);
      expect(result.rows.length).toBe(2);

      const [row0, row1] = result.rows;
      expect(row0[0]).toBeNull();
      expect(row0[1]).toBe(42);
      expect(row0[2]).toBe(3.5);
      expect(row0[3]).toBe("héllo☃");
      expect(row0[4]).toBeInstanceOf(Uint8Array);
      expect(row0[4].length).toBe(0);
      expect(row0[5]).toBeInstanceOf(Uint8Array);
      expect(Array.from(row0[5])).toEqual([0x00, 0xff, 0x00]);

      expect(row1[0]).toBeNull();
      expect(row1[1]).toBe(-7);
      expect(row1[2]).toBe(0);
      expect(row1[3]).toBe("");
      expect(row1[4]).toBeInstanceOf(Uint8Array);
      expect(Array.from(row1[4])).toEqual([0x01]);
      expect(row1[5]).toBeInstanceOf(Uint8Array);
      expect(row1[5].length).toBe(0);

      // The owned result was copied before sqlite3_finalize() and the worker-local
      // connection is now torn down; the JS values must remain intact afterwards.
      await close();
      expect(result.rows[0][3]).toBe("héllo☃");
      expect(Array.from(result.rows[0][5])).toEqual([0x00, 0xff, 0x00]);

      await waitForAsyncSQLiteStats(
        asyncSQLiteConnectionStatsForTesting,
        baselineRestored(baseline),
        "Gate C one-shot query leaked native state",
      );
    } finally {
      await close();
    }
  });

  it("snapshots the authoritative SQLite error diagnostics and keeps the connection usable", async () => {
    const {
      asyncSQLiteConnectionOpenForTesting,
      asyncSQLiteConnectionQueryForTesting,
      asyncSQLiteConnectionCloseForTesting,
      asyncSQLiteConnectionStatsForTesting,
    } = await import("bun:internal-for-testing");

    const baseline = asyncSQLiteConnectionStatsForTesting();
    const dir = tempDirWithFiles("sqlite-async-gate-c-err", { "empty.txt": "" });
    const file = path.join(dir, "gate-c-err.db");
    const connection = asyncSQLiteConnectionOpenForTesting(file, 4);
    const close = makeClose(asyncSQLiteConnectionCloseForTesting, connection.id);
    try {
      expect((await connection.ready).offThread).toBe(true);

      // A deterministic prepare-time syntax error. The worker must snapshot the
      // result code, extended code, byte offset, and owned message before
      // finalize/close or a later call can overwrite the error state.
      let error;
      try {
        await asyncSQLiteConnectionQueryForTesting(connection.id, "SELECT 1 FROM WHERE");
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe("SQLiteError");
      expect(error.code).toBe("SQLITE_ERROR");
      expect(error.errno).toBe(1);
      // byteOffset is 14 where the API is available; older/custom libs report -1.
      expect([14, -1]).toContain(error.byteOffset);
      expect(error.message).toContain("syntax error");

      // The failed operation must not poison the FIFO: a subsequent valid query
      // on the same connection must still run and return owned rows.
      const ok = await asyncSQLiteConnectionQueryForTesting(connection.id, "SELECT 7 AS n");
      expect(ok.columns).toEqual(["n"]);
      expect(ok.rows).toEqual([[7]]);

      await close();
      await waitForAsyncSQLiteStats(
        asyncSQLiteConnectionStatsForTesting,
        baselineRestored(baseline),
        "Gate C error-path query leaked native state",
      );
    } finally {
      await close();
    }
  });

  it("rejects with the preserved materialization exception and keeps the connection usable", async () => {
    const {
      asyncSQLiteConnectionOpenForTesting,
      asyncSQLiteConnectionQueryForTesting,
      asyncSQLiteConnectionCloseForTesting,
      asyncSQLiteConnectionStatsForTesting,
    } = await import("bun:internal-for-testing");

    const baseline = asyncSQLiteConnectionStatsForTesting();
    const dir = tempDirWithFiles("sqlite-async-gate-c-throw", { "empty.txt": "" });
    const file = path.join(dir, "gate-c-throw.db");
    const connection = asyncSQLiteConnectionOpenForTesting(file, 4);
    const close = makeClose(asyncSQLiteConnectionCloseForTesting, connection.id);
    try {
      expect((await connection.ready).offThread).toBe(true);

      // The private options flag forces a deterministic JS exception on the
      // JS-thread materialization path. The promise must reject with that exact
      // exception (preserved, not cleared and replaced by a synthesized error).
      let error;
      try {
        await asyncSQLiteConnectionQueryForTesting(connection.id, "SELECT 1 AS n", undefined, {
          forceMaterializeFailure: true,
        });
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe("TypeError");
      expect(error.message).toContain("forced async SQLite materialization failure");

      // The forced failure must not strand the FIFO: a normal query still works.
      const ok = await asyncSQLiteConnectionQueryForTesting(connection.id, "SELECT 5 AS n");
      expect(ok.rows).toEqual([[5]]);

      await close();
      await waitForAsyncSQLiteStats(
        asyncSQLiteConnectionStatsForTesting,
        baselineRestored(baseline),
        "Gate C forced materialization failure leaked native state",
      );
    } finally {
      await close();
    }
  });

  it("copies row values only for Query, never for Exec of row-producing SQL", async () => {
    const {
      asyncSQLiteConnectionOpenForTesting,
      asyncSQLiteConnectionExecForTesting,
      asyncSQLiteConnectionQueryForTesting,
      asyncSQLiteConnectionCloseForTesting,
      asyncSQLiteConnectionStatsForTesting,
    } = await import("bun:internal-for-testing");

    const baseline = asyncSQLiteConnectionStatsForTesting();
    const dir = tempDirWithFiles("sqlite-async-gate-c-copy", { "empty.txt": "" });
    const file = path.join(dir, "gate-c-copy.db");
    const connection = asyncSQLiteConnectionOpenForTesting(file, 4);
    const close = makeClose(asyncSQLiteConnectionCloseForTesting, connection.id);
    try {
      expect((await connection.ready).offThread).toBe(true);

      // Exec of row-producing SQL (including a multi-statement Gate B script)
      // must drain rows without copying any values.
      const beforeExec = asyncSQLiteConnectionStatsForTesting().copiedRowValues;
      expect(await asyncSQLiteConnectionExecForTesting(connection.id, "SELECT 1, 2, 3")).toBe(true);
      expect(
        await asyncSQLiteConnectionExecForTesting(
          connection.id,
          "CREATE TABLE t(x); INSERT INTO t VALUES (10); SELECT x FROM t",
        ),
      ).toBe(true);
      const afterExec = asyncSQLiteConnectionStatsForTesting().copiedRowValues;
      expect(afterExec - beforeExec).toBe(0);

      // Query copies each produced value; the counter is debug-gated, so the
      // delta is 3 in debug/assert builds and 0 in release.
      const beforeQuery = asyncSQLiteConnectionStatsForTesting().copiedRowValues;
      const result = await asyncSQLiteConnectionQueryForTesting(connection.id, "SELECT 1, 2, 3");
      expect(result.rows).toEqual([[1, 2, 3]]);
      const afterQuery = asyncSQLiteConnectionStatsForTesting().copiedRowValues;
      expect(afterQuery - beforeQuery).toBe(isDebug || isASAN ? 3 : 0);

      await close();
      await waitForAsyncSQLiteStats(
        asyncSQLiteConnectionStatsForTesting,
        baselineRestored(baseline),
        "Gate C exec/query copy accounting leaked native state",
      );
    } finally {
      await close();
    }
  });

  it("decodes non-UTF-8 column names leniently when copying owned rows", async () => {
    const {
      asyncSQLiteConnectionOpenForTesting,
      asyncSQLiteConnectionQueryForTesting,
      asyncSQLiteConnectionCloseForTesting,
      asyncSQLiteConnectionStatsForTesting,
    } = await import("bun:internal-for-testing");

    const baseline = asyncSQLiteConnectionStatsForTesting();
    const dir = tempDirWithFiles("sqlite-async-gate-c-badcols", { "empty.txt": "" });
    const file = path.join(dir, "gate-c-badcols.db");

    // Sync setup with distinctive same-length ASCII names, then binary-patch the
    // stored quoted names to same-length invalid UTF-8 (0xE9, 0xFF) so they must
    // decode to distinct U+FFFD strings and not collide, matching the sync test.
    const setup = new Database(file, { create: true });
    setup.run(`CREATE TABLE t ("Xaa" INTEGER, "Ybb" INTEGER)`);
    setup.run("INSERT INTO t VALUES (1, 2)");
    setup.close();
    const buf = readFileSync(file);
    const patch = (find, replacement) => {
      const at = buf.indexOf(Buffer.from(find, "latin1"));
      expect(at).toBeGreaterThanOrEqual(0);
      Buffer.from(replacement).copy(buf, at);
    };
    patch('"Xaa"', [0x22, 0x58, 0xe9, 0x61, 0x22]);
    patch('"Ybb"', [0x22, 0x59, 0xff, 0x62, 0x22]);
    writeFileSync(file, buf);

    const connection = asyncSQLiteConnectionOpenForTesting(file, 4);
    const close = makeClose(asyncSQLiteConnectionCloseForTesting, connection.id);
    try {
      expect((await connection.ready).offThread).toBe(true);

      // Both invalid names must survive as distinct leniently-decoded owned
      // columns; strict fromUTF8 would null/collide them and drop a column.
      const result = await asyncSQLiteConnectionQueryForTesting(connection.id, "SELECT * FROM t");
      expect(result.columns).toEqual(["X\uFFFDa", "Y\uFFFDb"]);
      expect(result.rows).toEqual([[1, 2]]);

      await close();
      await waitForAsyncSQLiteStats(
        asyncSQLiteConnectionStatsForTesting,
        baselineRestored(baseline),
        "Gate C non-UTF-8 column-name query leaked native state",
      );
    } finally {
      await close();
    }
  });

  it("stops instead of looping forever on an embedded NUL after a valid statement", async () => {
    const dir = tempDirWithFiles("sqlite-async-gate-c-nul", {
      "main.js": `
        import {
          asyncSQLiteConnectionCloseForTesting,
          asyncSQLiteConnectionOpenForTesting,
          asyncSQLiteConnectionQueryForTesting,
        } from "bun:internal-for-testing";

        const file = process.argv[2];
        const connection = asyncSQLiteConnectionOpenForTesting(file, 4);
        await connection.ready;
        // Embedded NUL after a valid statement: the worker must return the first
        // statement's rows and stop, matching the sync no-progress guard, not loop.
        const result = await asyncSQLiteConnectionQueryForTesting(connection.id, "SELECT 1 AS n\\0SELECT 2");
        await asyncSQLiteConnectionCloseForTesting(connection.id);
        console.log(JSON.stringify({ columns: result.columns, rows: result.rows }));
      `,
    });
    const file = path.join(dir, "gate-c-nul.db");
    await using proc = Bun.spawn({
      cmd: [bunExe(), "main.js", file],
      cwd: dir,
      env: { ...bunEnv, UV_THREADPOOL_SIZE: "2" },
      stdout: "pipe",
      stderr: "pipe",
    });

    // Drain output while bounded-yielding for exit. The no-progress bug spins the
    // worker forever so proc.exited never resolves; kill that child and let the
    // exit/output assertion fail rather than hang the suite.
    const stdoutPromise = proc.stdout.text();
    const stderrPromise = proc.stderr.text();
    let exited = false;
    let exitCode;
    proc.exited.then(code => {
      exited = true;
      exitCode = code;
    });
    const maxYields = 10_000;
    for (let i = 0; i < maxYields && !exited; i++) {
      await new Promise(resolve => setImmediate(resolve));
    }
    if (!exited) {
      proc.kill();
      await proc.exited;
    }
    const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise]);
    expect({ exited, exitCode, stdout: stdout.trim(), stderr }).toMatchObject({
      exited: true,
      exitCode: 0,
      stdout: JSON.stringify({ columns: ["n"], rows: [[1]] }),
    });
  });
});

describe("async SQLite binding snapshot (Gate C prerequisite private)", () => {
  // Every binding value is validated and copied on the JS thread before queue
  // admission; because that snapshot is synchronous inside the submit call,
  // mutating a source after the call returns is guaranteed to be post-snapshot.
  const baselineRestored = baseline => current =>
    current.liveConnections === baseline.liveConnections &&
    current.liveJobs === baseline.liveJobs &&
    current.liveResults === baseline.liveResults &&
    current.liveRequests === baseline.liveRequests &&
    current.liveRows === baseline.liveRows &&
    current.liveErrors === baseline.liveErrors &&
    current.activeConnectionOperations === baseline.activeConnectionOperations;

  const makeClose = (closeForTesting, id) => {
    // Memoize the in-flight close so an unawaited getter close() and later cleanup
    // await the same operation; reset on rejection so a failed close can be retried.
    let pending = null;
    return () => {
      if (!pending) {
        pending = Promise.resolve(closeForTesting(id)).catch(err => {
          pending = null;
          throw err;
        });
      }
      return pending;
    };
  };

  it("round-trips positional owned values and snapshots them before admission", async () => {
    const {
      asyncSQLiteConnectionOpenForTesting,
      asyncSQLiteConnectionQueryForTesting,
      asyncSQLiteConnectionCloseForTesting,
      asyncSQLiteConnectionStatsForTesting,
    } = await import("bun:internal-for-testing");

    const baseline = asyncSQLiteConnectionStatsForTesting();
    const dir = tempDirWithFiles("sqlite-async-bind-pos", { "empty.txt": "" });
    const file = path.join(dir, "bind-pos.db");
    const connection = asyncSQLiteConnectionOpenForTesting(file, 4);
    const close = makeClose(asyncSQLiteConnectionCloseForTesting, connection.id);
    try {
      expect((await connection.ready).offThread).toBe(true);

      const bytes = new Uint8Array([1, 2, 0, 3]);
      // A byte window (byteOffset 2, length 4) proves the offset is respected.
      const windowBuf = new ArrayBuffer(8);
      const view = new Uint8Array(windowBuf, 2, 4);
      view.set([9, 8, 7, 6]);
      // DataView byte window over the middle of its own buffer.
      const dvBuf = new ArrayBuffer(6);
      new Uint8Array(dvBuf).set([0, 0xaa, 0xbb, 0xcc, 0, 0]);
      const dv = new DataView(dvBuf, 1, 3);

      const args = [
        null,
        true,
        false,
        42,
        -7,
        3.5,
        9007199254740991,
        123n,
        "héllo☃",
        "a\0b",
        new Uint8Array(0),
        bytes,
        view,
        dv,
      ];
      const p = asyncSQLiteConnectionQueryForTesting(connection.id, "SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?", args);

      // Mutate every mutable source after the synchronous snapshot; the worker
      // must observe the pre-mutation snapshot, not these later writes.
      bytes.fill(0xff);
      view.fill(0xff);
      new Uint8Array(dvBuf).fill(0xff);
      args[3] = 999;

      const result = await p;
      const row = result.rows[0];
      expect(row[0]).toBeNull();
      expect(row[1]).toBe(1);
      expect(row[2]).toBe(0);
      expect(row[3]).toBe(42);
      expect(row[4]).toBe(-7);
      expect(row[5]).toBe(3.5);
      expect(row[6]).toBe(9007199254740991);
      expect(row[7]).toBe(123);
      expect(row[8]).toBe("héllo☃");
      expect(row[9]).toBe("a\0b");
      expect(row[10]).toBeInstanceOf(Uint8Array);
      expect(row[10].length).toBe(0);
      expect(Array.from(row[11])).toEqual([1, 2, 0, 3]);
      expect(Array.from(row[12])).toEqual([9, 8, 7, 6]);
      expect(Array.from(row[13])).toEqual([0xaa, 0xbb, 0xcc]);

      await close();
      await waitForAsyncSQLiteStats(
        asyncSQLiteConnectionStatsForTesting,
        baselineRestored(baseline),
        "positional binding query leaked native state",
      );
    } finally {
      await close();
    }
  });

  it("snapshots all own string-keyed named properties, runs extra getters, ignores inherited/symbol", async () => {
    const {
      asyncSQLiteConnectionOpenForTesting,
      asyncSQLiteConnectionQueryForTesting,
      asyncSQLiteConnectionCloseForTesting,
      asyncSQLiteConnectionStatsForTesting,
    } = await import("bun:internal-for-testing");

    const baseline = asyncSQLiteConnectionStatsForTesting();
    const dir = tempDirWithFiles("sqlite-async-bind-named", { "empty.txt": "" });
    const file = path.join(dir, "bind-named.db");
    const connection = asyncSQLiteConnectionOpenForTesting(file, 4);
    const close = makeClose(asyncSQLiteConnectionCloseForTesting, connection.id);
    try {
      expect((await connection.ready).offThread).toBe(true);

      let extraRan = 0;
      const proto = { $c: 99 };
      const obj = Object.create(proto);
      obj.$a = 1;
      // Own non-enumerable data property must still be snapshotted.
      Object.defineProperty(obj, "$b", { value: 2, enumerable: false });
      // Extra own getter with no matching SQL parameter must still run.
      Object.defineProperty(obj, "$z", {
        enumerable: true,
        get() {
          extraRan++;
          return 5;
        },
      });
      obj[Symbol("s")] = 7;

      // Default connection is non-strict: names keep their prefix; $c is inherited
      // (ignored, left NULL) and the symbol key is ignored.
      const result = await asyncSQLiteConnectionQueryForTesting(connection.id, "SELECT $a AS a, $b AS b, $c AS c", obj);
      expect(result.rows).toEqual([[1, 2, null]]);
      expect(extraRan).toBe(1);

      await close();
      await waitForAsyncSQLiteStats(
        asyncSQLiteConnectionStatsForTesting,
        baselineRestored(baseline),
        "named binding snapshot leaked native state",
      );
    } finally {
      await close();
    }
  });

  it("rejects when a named getter throws and neither admits nor poisons the connection", async () => {
    const {
      asyncSQLiteConnectionOpenForTesting,
      asyncSQLiteConnectionQueryForTesting,
      asyncSQLiteConnectionCloseForTesting,
      asyncSQLiteConnectionStatsForTesting,
    } = await import("bun:internal-for-testing");

    const baseline = asyncSQLiteConnectionStatsForTesting();
    const dir = tempDirWithFiles("sqlite-async-bind-throw", { "empty.txt": "" });
    const file = path.join(dir, "bind-throw.db");
    const connection = asyncSQLiteConnectionOpenForTesting(file, 4);
    const close = makeClose(asyncSQLiteConnectionCloseForTesting, connection.id);
    try {
      expect((await connection.ready).offThread).toBe(true);

      const obj = {
        get $a() {
          throw new Error("boom getter");
        },
      };
      let error;
      try {
        await asyncSQLiteConnectionQueryForTesting(connection.id, "SELECT $a AS a", obj);
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(Error);
      expect(error.message).toContain("boom getter");

      // The throwing snapshot must not have admitted anything; the connection is
      // still usable and no request/keepalive leaked.
      const ok = await asyncSQLiteConnectionQueryForTesting(connection.id, "SELECT 1 AS n");
      expect(ok.rows).toEqual([[1]]);

      await close();
      await waitForAsyncSQLiteStats(
        asyncSQLiteConnectionStatsForTesting,
        baselineRestored(baseline),
        "throwing named getter leaked native state",
      );
    } finally {
      await close();
    }
  });

  it("matches non-strict named binding: exact prefixed keys, extras ignored, missing left NULL", async () => {
    const {
      asyncSQLiteConnectionOpenForTesting,
      asyncSQLiteConnectionQueryForTesting,
      asyncSQLiteConnectionCloseForTesting,
      asyncSQLiteConnectionStatsForTesting,
    } = await import("bun:internal-for-testing");

    const baseline = asyncSQLiteConnectionStatsForTesting();
    const dir = tempDirWithFiles("sqlite-async-bind-nonstrict", { "empty.txt": "" });
    const file = path.join(dir, "bind-nonstrict.db");
    const connection = asyncSQLiteConnectionOpenForTesting(file, 4);
    const close = makeClose(asyncSQLiteConnectionCloseForTesting, connection.id);
    try {
      expect((await connection.ready).offThread).toBe(true);

      // All three prefixes bind by exact prefixed key; $d is missing -> NULL,
      // $extra is an unused extra own property.
      const result = await asyncSQLiteConnectionQueryForTesting(
        connection.id,
        "SELECT $a AS a, :b AS b, @c AS c, $d AS d",
        { $a: 1, ":b": 2, "@c": 3, $extra: 99 },
      );
      expect(result.rows).toEqual([[1, 2, 3, null]]);

      // Out-of-order positional array parameters bind by declared index.
      const ooo = await asyncSQLiteConnectionQueryForTesting(connection.id, "SELECT ?2 AS a, ?1 AS b", ["x", "y"]);
      expect(ooo.rows).toEqual([["y", "x"]]);

      await close();
      await waitForAsyncSQLiteStats(
        asyncSQLiteConnectionStatsForTesting,
        baselineRestored(baseline),
        "non-strict named binding leaked native state",
      );
    } finally {
      await close();
    }
  });

  it("strict named binding strips $ : @ prefixes and rejects missing values", async () => {
    const {
      asyncSQLiteConnectionOpenForTesting,
      asyncSQLiteConnectionQueryForTesting,
      asyncSQLiteConnectionCloseForTesting,
      asyncSQLiteConnectionStatsForTesting,
    } = await import("bun:internal-for-testing");

    const baseline = asyncSQLiteConnectionStatsForTesting();
    const dir = tempDirWithFiles("sqlite-async-bind-strict", { "empty.txt": "" });
    const file = path.join(dir, "bind-strict.db");
    const connection = asyncSQLiteConnectionOpenForTesting(file, 4, undefined, { strict: true });
    const close = makeClose(asyncSQLiteConnectionCloseForTesting, connection.id);
    try {
      expect((await connection.ready).offThread).toBe(true);

      const result = await asyncSQLiteConnectionQueryForTesting(connection.id, "SELECT $a AS a, :b AS b, @c AS c", {
        a: 1,
        b: 2,
        c: 3,
      });
      expect(result.rows).toEqual([[1, 2, 3]]);

      let error;
      try {
        await asyncSQLiteConnectionQueryForTesting(connection.id, "SELECT $a AS a, $missing AS m", {
          a: 1,
        });
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(Error);
      expect(error.message).toContain("Missing parameter");

      // A strict missing-value rejection must not poison the FIFO.
      const ok = await asyncSQLiteConnectionQueryForTesting(connection.id, "SELECT 9 AS n");
      expect(ok.rows).toEqual([[9]]);

      await close();
      await waitForAsyncSQLiteStats(
        asyncSQLiteConnectionStatsForTesting,
        baselineRestored(baseline),
        "strict named binding leaked native state",
      );
    } finally {
      await close();
    }
  });

  it("rejects binding validation failures with a plain Error matching sync, not SQLiteError", async () => {
    const {
      asyncSQLiteConnectionOpenForTesting,
      asyncSQLiteConnectionQueryForTesting,
      asyncSQLiteConnectionCloseForTesting,
      asyncSQLiteConnectionStatsForTesting,
    } = await import("bun:internal-for-testing");

    // Capture the authoritative sync bun:sqlite errors for the same inputs so the
    // async rejection must match their name/constructor/message and, crucially,
    // carry no SQLite .code/.errno (binding errors are plain Errors, not SQLiteError).
    const syncPlain = new Database(":memory:");
    let syncCount;
    try {
      syncPlain.query("SELECT ?, ?").all([1]);
    } catch (e) {
      syncCount = e;
    }
    syncPlain.close();
    const syncStrictDb = new Database(":memory:", { strict: true });
    let syncMissing;
    try {
      syncStrictDb.query("SELECT $a AS a, $missing AS m").all({ a: 1 });
    } catch (e) {
      syncMissing = e;
    }
    syncStrictDb.close();
    expect(syncCount).toBeInstanceOf(Error);
    expect(syncCount.constructor).toBe(Error);
    expect(syncCount.code).toBeUndefined();
    expect(syncMissing.constructor).toBe(Error);
    expect(syncMissing.code).toBeUndefined();

    const baseline = asyncSQLiteConnectionStatsForTesting();
    const dir = tempDirWithFiles("sqlite-async-bind-plainerr", { "empty.txt": "" });
    const file = path.join(dir, "bind-plainerr.db");
    const connection = asyncSQLiteConnectionOpenForTesting(file, 4, undefined, { strict: true });
    const close = makeClose(asyncSQLiteConnectionCloseForTesting, connection.id);
    try {
      expect((await connection.ready).offThread).toBe(true);

      let asyncCount;
      try {
        await asyncSQLiteConnectionQueryForTesting(connection.id, "SELECT ?, ?", [1]);
      } catch (e) {
        asyncCount = e;
      }
      expect(asyncCount).toBeDefined();
      expect(asyncCount.constructor).toBe(Error);
      expect(asyncCount).not.toBeInstanceOf(SQLiteError);
      expect(asyncCount.name).toBe(syncCount.name);
      expect(asyncCount.message).toBe(syncCount.message);
      expect(asyncCount.code).toBeUndefined();
      expect(asyncCount.errno).toBeUndefined();

      let asyncMissing;
      try {
        await asyncSQLiteConnectionQueryForTesting(connection.id, "SELECT $a AS a, $missing AS m", { a: 1 });
      } catch (e) {
        asyncMissing = e;
      }
      expect(asyncMissing).toBeDefined();
      expect(asyncMissing.constructor).toBe(Error);
      expect(asyncMissing).not.toBeInstanceOf(SQLiteError);
      expect(asyncMissing.name).toBe(syncMissing.name);
      expect(asyncMissing.message).toBe(syncMissing.message);
      expect(asyncMissing.code).toBeUndefined();
      expect(asyncMissing.errno).toBeUndefined();

      // A genuine execution (prepare/step) error must remain a SQLiteError with code/errno.
      let execErr;
      try {
        await asyncSQLiteConnectionQueryForTesting(connection.id, "SELECT * FROM no_such_table");
      } catch (e) {
        execErr = e;
      }
      expect(execErr).toBeInstanceOf(SQLiteError);
      expect(execErr.code).toBe("SQLITE_ERROR");
      expect(typeof execErr.errno).toBe("number");

      // None of the rejections poisoned the FIFO.
      const ok = await asyncSQLiteConnectionQueryForTesting(connection.id, "SELECT 7 AS n");
      expect(ok.rows).toEqual([[7]]);

      await close();
      await waitForAsyncSQLiteStats(
        asyncSQLiteConnectionStatsForTesting,
        baselineRestored(baseline),
        "binding error classification leaked native state",
      );
    } finally {
      await close();
    }
  });

  it("applies bindings only to the first executable statement, matching sync Database.run", async () => {
    const {
      asyncSQLiteConnectionOpenForTesting,
      asyncSQLiteConnectionQueryForTesting,
      asyncSQLiteConnectionExecForTesting,
      asyncSQLiteConnectionRunForTesting,
      asyncSQLiteConnectionCloseForTesting,
      asyncSQLiteConnectionStatsForTesting,
    } = await import("bun:internal-for-testing");

    const baseline = asyncSQLiteConnectionStatsForTesting();
    const dir = tempDirWithFiles("sqlite-async-bind-firststmt", { "empty.txt": "" });
    const file = path.join(dir, "bind-firststmt.db");
    const connection = asyncSQLiteConnectionOpenForTesting(file, 4);
    const close = makeClose(asyncSQLiteConnectionCloseForTesting, connection.id);
    try {
      expect((await connection.ready).offThread).toBe(true);

      await asyncSQLiteConnectionExecForTesting(connection.id, "CREATE TABLE t (id INTEGER, tag TEXT)");

      // Two-statement string: the first statement consumes the single binding; the
      // second has no parameters. Only the first statement may receive the binding,
      // and leading comments/whitespace must not consume the one binding application.
      const two = "/* lead */ INSERT INTO t (id) VALUES (?); INSERT INTO t (tag) VALUES ('done')";
      await asyncSQLiteConnectionRunForTesting(connection.id, two, [11]);

      const rows = await asyncSQLiteConnectionQueryForTesting(connection.id, "SELECT id, tag FROM t ORDER BY rowid");
      expect(rows.rows).toEqual([
        [11, null],
        [null, "done"],
      ]);

      await close();
      await waitForAsyncSQLiteStats(
        asyncSQLiteConnectionStatsForTesting,
        baselineRestored(baseline),
        "first-statement binding leaked native state",
      );
    } finally {
      await close();
    }
  });

  it("treats an empty positional array as no bindings, matching sync rebindStatement", async () => {
    const {
      asyncSQLiteConnectionOpenForTesting,
      asyncSQLiteConnectionQueryForTesting,
      asyncSQLiteConnectionCloseForTesting,
      asyncSQLiteConnectionStatsForTesting,
    } = await import("bun:internal-for-testing");

    // Sync bun:sqlite resolves an empty array to a NULL parameter, not a count error.
    const syncDb = new Database(":memory:");
    const syncRows = syncDb.query("SELECT ? AS a").all([]);
    syncDb.close();
    expect(syncRows).toEqual([{ a: null }]);

    const baseline = asyncSQLiteConnectionStatsForTesting();
    const dir = tempDirWithFiles("sqlite-async-bind-empty", { "empty.txt": "" });
    const file = path.join(dir, "bind-empty.db");
    const connection = asyncSQLiteConnectionOpenForTesting(file, 4);
    const close = makeClose(asyncSQLiteConnectionCloseForTesting, connection.id);
    try {
      expect((await connection.ready).offThread).toBe(true);

      const result = await asyncSQLiteConnectionQueryForTesting(connection.id, "SELECT ? AS a", []);
      expect(result.rows).toEqual([[null]]);

      // A nonempty array must still be exact-count validated.
      let mismatch;
      try {
        await asyncSQLiteConnectionQueryForTesting(connection.id, "SELECT ?, ?", [1]);
      } catch (e) {
        mismatch = e;
      }
      expect(mismatch).toBeDefined();
      expect(mismatch.message).toContain("expected 2 values, received 1");

      await close();
      await waitForAsyncSQLiteStats(
        asyncSQLiteConnectionStatsForTesting,
        baselineRestored(baseline),
        "empty-array binding leaked native state",
      );
    } finally {
      await close();
    }
  });

  it("orders a reentrant queued operation ahead of the operation whose getter queued it", async () => {
    const {
      asyncSQLiteConnectionOpenForTesting,
      asyncSQLiteConnectionExecForTesting,
      asyncSQLiteConnectionQueryForTesting,
      asyncSQLiteConnectionCloseForTesting,
      asyncSQLiteConnectionStatsForTesting,
    } = await import("bun:internal-for-testing");

    const baseline = asyncSQLiteConnectionStatsForTesting();
    const dir = tempDirWithFiles("sqlite-async-bind-reentrant", { "empty.txt": "" });
    const file = path.join(dir, "bind-reentrant.db");
    const connection = asyncSQLiteConnectionOpenForTesting(file, 4);
    const close = makeClose(asyncSQLiteConnectionCloseForTesting, connection.id);
    try {
      expect((await connection.ready).offThread).toBe(true);
      expect(await asyncSQLiteConnectionExecForTesting(connection.id, "CREATE TABLE log(n INTEGER)")).toBe(true);

      let innerPromise;
      const obj = {
        get $x() {
          // Queue a reentrant op during the outer snapshot. Because the outer op
          // admits only after its snapshot completes, this inner op admits first.
          innerPromise = asyncSQLiteConnectionExecForTesting(connection.id, "INSERT INTO log VALUES (1)");
          return 2;
        },
      };
      const outerPromise = asyncSQLiteConnectionQueryForTesting(
        connection.id,
        "INSERT INTO log VALUES ($x) RETURNING n",
        obj,
      );
      const [, outer] = await Promise.all([innerPromise, outerPromise]);
      expect(outer.rows).toEqual([[2]]);

      const ordered = await asyncSQLiteConnectionQueryForTesting(connection.id, "SELECT n FROM log ORDER BY rowid");
      expect(ordered.rows.flat()).toEqual([1, 2]);

      await close();
      await waitForAsyncSQLiteStats(
        asyncSQLiteConnectionStatsForTesting,
        baselineRestored(baseline),
        "reentrant admission ordering leaked native state",
      );
    } finally {
      await close();
    }
  });

  it("rejects after snapshot when a getter closes the connection, never entering SQLite", async () => {
    const {
      asyncSQLiteConnectionOpenForTesting,
      asyncSQLiteConnectionQueryForTesting,
      asyncSQLiteConnectionCloseForTesting,
      asyncSQLiteConnectionStatsForTesting,
    } = await import("bun:internal-for-testing");

    const baseline = asyncSQLiteConnectionStatsForTesting();
    const dir = tempDirWithFiles("sqlite-async-bind-close", { "empty.txt": "" });
    const file = path.join(dir, "bind-close.db");
    const connection = asyncSQLiteConnectionOpenForTesting(file, 4);
    const close = makeClose(asyncSQLiteConnectionCloseForTesting, connection.id);
    try {
      expect((await connection.ready).offThread).toBe(true);

      const obj = {
        get $x() {
          // Start close during the snapshot; admission must then be refused.
          close();
          return 1;
        },
      };
      let error;
      try {
        await asyncSQLiteConnectionQueryForTesting(connection.id, "SELECT $x AS v", obj);
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(Error);

      // The connection is closing/closed; a follow-up query must also reject.
      const after = await asyncSQLiteConnectionQueryForTesting(connection.id, "SELECT 1 AS n").catch(e => e);
      expect(after).toBeInstanceOf(Error);

      await close();
      await waitForAsyncSQLiteStats(
        asyncSQLiteConnectionStatsForTesting,
        baselineRestored(baseline),
        "close-during-getter leaked native state",
      );
    } finally {
      await close();
    }
  });

  it("rejects detached views before admission and ignores post-return detachment", async () => {
    const {
      asyncSQLiteConnectionOpenForTesting,
      asyncSQLiteConnectionQueryForTesting,
      asyncSQLiteConnectionCloseForTesting,
      asyncSQLiteConnectionStatsForTesting,
    } = await import("bun:internal-for-testing");

    const baseline = asyncSQLiteConnectionStatsForTesting();
    const dir = tempDirWithFiles("sqlite-async-bind-detach", { "empty.txt": "" });
    const file = path.join(dir, "bind-detach.db");
    const connection = asyncSQLiteConnectionOpenForTesting(file, 4);
    const close = makeClose(asyncSQLiteConnectionCloseForTesting, connection.id);
    try {
      expect((await connection.ready).offThread).toBe(true);

      const ab = new ArrayBuffer(4);
      const detachedView = new Uint8Array(ab);
      structuredClone(ab, { transfer: [ab] });
      expect(detachedView.byteLength).toBe(0);
      let error;
      try {
        await asyncSQLiteConnectionQueryForTesting(connection.id, "SELECT ? AS b", [detachedView]);
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(Error);
      expect(error.message).toContain("detached");

      // Detaching after the synchronous snapshot cannot change execution.
      const liveBuf = new ArrayBuffer(3);
      const liveView = new Uint8Array(liveBuf);
      liveView.set([1, 2, 3]);
      const p = asyncSQLiteConnectionQueryForTesting(connection.id, "SELECT ? AS b", [liveView]);
      structuredClone(liveBuf, { transfer: [liveBuf] });
      const result = await p;
      expect(Array.from(result.rows[0][0])).toEqual([1, 2, 3]);

      await close();
      await waitForAsyncSQLiteStats(
        asyncSQLiteConnectionStatsForTesting,
        baselineRestored(baseline),
        "detached-buffer binding leaked native state",
      );
    } finally {
      await close();
    }
  });

  it("binds bigint per safeIntegers mode: default wraps out-of-range, safeIntegers rejects", async () => {
    const {
      asyncSQLiteConnectionOpenForTesting,
      asyncSQLiteConnectionQueryForTesting,
      asyncSQLiteConnectionCloseForTesting,
      asyncSQLiteConnectionStatsForTesting,
    } = await import("bun:internal-for-testing");

    const MIN = -9223372036854775808n;
    const MAX = 9223372036854775807n;
    const OVER = 9223372036854775808n; // MAX + 1
    const UNDER = -9223372036854775809n; // MIN - 1
    const castOne = "SELECT CAST(? AS TEXT) AS a";
    const castTwo = "SELECT CAST(? AS TEXT) AS a, CAST(? AS TEXT) AS b";

    // Authoritative sync references. safeIntegers off wraps out-of-i64 input via
    // sqlite3_bind_int64(toBigInt64); safeIntegers on throws a RangeError.
    const syncDefault = new Database(":memory:");
    const syncSafe = new Database(":memory:", { safeIntegers: true });
    const syncMinMax = syncDefault.query(castTwo).all([MIN, MAX])[0];
    const syncWrapOver = syncDefault.query(castOne).all([OVER])[0].a;
    const syncWrapUnder = syncDefault.query(castOne).all([UNDER])[0].a;
    let syncSafeErr;
    try {
      syncSafe.query(castOne).all([OVER]);
    } catch (e) {
      syncSafeErr = e;
    }
    syncDefault.close();
    syncSafe.close();
    expect(syncSafeErr).toBeInstanceOf(RangeError);

    const baseline = asyncSQLiteConnectionStatsForTesting();
    const dir = tempDirWithFiles("sqlite-async-bind-bigint", { "empty.txt": "" });
    const fileDefault = path.join(dir, "bind-bigint-default.db");
    const fileSafe = path.join(dir, "bind-bigint-safe.db");
    const connDefault = asyncSQLiteConnectionOpenForTesting(fileDefault, 4);
    const connSafe = asyncSQLiteConnectionOpenForTesting(fileSafe, 4, undefined, { safeIntegers: true });
    const closeDefault = makeClose(asyncSQLiteConnectionCloseForTesting, connDefault.id);
    const closeSafe = makeClose(asyncSQLiteConnectionCloseForTesting, connSafe.id);
    try {
      expect((await connDefault.ready).offThread).toBe(true);
      expect((await connSafe.ready).offThread).toBe(true);

      // Default mode: i64 extremes round-trip and out-of-range wraps like sync.
      const dmm = await asyncSQLiteConnectionQueryForTesting(connDefault.id, castTwo, [MIN, MAX]);
      expect(dmm.rows).toEqual([[syncMinMax.a, syncMinMax.b]]);
      const dover = await asyncSQLiteConnectionQueryForTesting(connDefault.id, castOne, [OVER]);
      expect(dover.rows).toEqual([[syncWrapOver]]);
      const dunder = await asyncSQLiteConnectionQueryForTesting(connDefault.id, castOne, [UNDER]);
      expect(dunder.rows).toEqual([[syncWrapUnder]]);

      // Default mode materializes integer columns as Numbers, including the sync
      // precision loss beyond 2^53 (9007199254740993 -> 9007199254740992).
      const dnum = await asyncSQLiteConnectionQueryForTesting(connDefault.id, "SELECT ? AS n, 1 AS small", [
        9007199254740993n,
      ]);
      expect(dnum.rows).toEqual([[9007199254740992, 1]]);
      expect(typeof dnum.rows[0][0]).toBe("number");
      expect(typeof dnum.rows[0][1]).toBe("number");

      // safeIntegers mode materializes integer columns as lossless BigInts on the
      // owner thread, end to end, matching sync jsBigIntFromSQLite.
      const snum = await asyncSQLiteConnectionQueryForTesting(connSafe.id, "SELECT ? AS n, 1 AS small", [
        9007199254740993n,
      ]);
      expect(snum.rows).toEqual([[9007199254740993n, 1n]]);

      // safeIntegers mode: extremes still bind; one-past boundary rejects with the
      // same RangeError name/message as sync, on the JS thread before admission.
      const smm = await asyncSQLiteConnectionQueryForTesting(connSafe.id, castTwo, [MIN, MAX]);
      expect(smm.rows).toEqual([[MIN.toString(), MAX.toString()]]);
      let overErr;
      try {
        await asyncSQLiteConnectionQueryForTesting(connSafe.id, castOne, [OVER]);
      } catch (e) {
        overErr = e;
      }
      expect(overErr).toBeInstanceOf(RangeError);
      expect(overErr.name).toBe(syncSafeErr.name);
      expect(overErr.message).toBe(syncSafeErr.message);
      let underErr;
      try {
        await asyncSQLiteConnectionQueryForTesting(connSafe.id, castOne, [UNDER]);
      } catch (e) {
        underErr = e;
      }
      expect(underErr).toBeInstanceOf(RangeError);
      expect(underErr.message).toContain("out of range");

      // Neither rejection poisoned the FIFO (safe mode returns a BigInt).
      const ok = await asyncSQLiteConnectionQueryForTesting(connSafe.id, "SELECT 3 AS n");
      expect(ok.rows).toEqual([[3n]]);

      await closeDefault();
      await closeSafe();
      await waitForAsyncSQLiteStats(
        asyncSQLiteConnectionStatsForTesting,
        baselineRestored(baseline),
        "bigint binding leaked native state",
      );
    } finally {
      await closeDefault();
      await closeSafe();
    }
  });

  it("caps a too-large positional array with a RangeError before admission", async () => {
    const {
      asyncSQLiteConnectionOpenForTesting,
      asyncSQLiteConnectionQueryForTesting,
      asyncSQLiteConnectionCloseForTesting,
      asyncSQLiteConnectionStatsForTesting,
    } = await import("bun:internal-for-testing");

    const MAX_VARS = 32766;
    const baseline = asyncSQLiteConnectionStatsForTesting();
    const dir = tempDirWithFiles("sqlite-async-bind-cap", { "empty.txt": "" });
    const file = path.join(dir, "bind-cap.db");
    const connection = asyncSQLiteConnectionOpenForTesting(file, 4);
    const close = makeClose(asyncSQLiteConnectionCloseForTesting, connection.id);
    try {
      expect((await connection.ready).offThread).toBe(true);

      // One past the max: rejected on the JS thread by the snapshot cap, before any
      // admission or large allocation. A sparse array avoids materializing values.
      let capErr;
      try {
        await asyncSQLiteConnectionQueryForTesting(connection.id, "SELECT 1", new Array(MAX_VARS + 1));
      } catch (e) {
        capErr = e;
      }
      expect(capErr).toBeInstanceOf(RangeError);
      expect(capErr.message).toContain("32766");

      // At the boundary the snapshot cap must not fire: the request reaches the
      // worker and fails there with the plain count-mismatch Error instead.
      let boundaryErr;
      try {
        await asyncSQLiteConnectionQueryForTesting(connection.id, "SELECT 1", new Array(MAX_VARS));
      } catch (e) {
        boundaryErr = e;
      }
      expect(boundaryErr).toBeDefined();
      expect(boundaryErr).not.toBeInstanceOf(RangeError);
      expect(boundaryErr.message).toContain("expected 0 values, received 32766");

      // The connection remains usable after both rejections.
      const ok = await asyncSQLiteConnectionQueryForTesting(connection.id, "SELECT 5 AS n");
      expect(ok.rows).toEqual([[5]]);

      await close();
      await waitForAsyncSQLiteStats(
        asyncSQLiteConnectionStatsForTesting,
        baselineRestored(baseline),
        "positional cap leaked native state",
      );
    } finally {
      await close();
    }
  });
});
