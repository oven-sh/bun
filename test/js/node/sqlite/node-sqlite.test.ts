import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { isBuiltin } from "node:module";
import path from "node:path";
import { DatabaseSync, StatementSync, backup, constants } from "node:sqlite";

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

  test("prepare() rejects empty / comment-only SQL", () => {
    const db = new DatabaseSync(":memory:");
    for (const sql of ["", "   ", "-- a comment"]) {
      expect(() => db.prepare(sql)).toThrow(
        expect.objectContaining({
          code: "ERR_INVALID_STATE",
          message: expect.stringMatching(/contains no statements/),
        }),
      );
    }
    db.close();
  });

  test("constructor rejects non-int32 timeout values", () => {
    for (const timeout of [Infinity, -Infinity, 2 ** 32, 1.5, NaN, "100"]) {
      expect(() => new DatabaseSync(":memory:", { timeout })).toThrow(
        expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" }),
      );
    }
    // int32-range integers are accepted.
    const db = new DatabaseSync(":memory:", { timeout: 1000 });
    expect(db.isOpen).toBe(true);
    db.close();
  });

  test("constructor rejects non-Uint8Array TypedArray paths", () => {
    expect(() => new DatabaseSync(new Float64Array([1.5]))).toThrow(
      expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" }),
    );
    expect(() => new DatabaseSync(new Int32Array([65, 66]))).toThrow(
      expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" }),
    );
    // Buffer (which extends Uint8Array) is accepted.
    const db = new DatabaseSync(Buffer.from(":memory:"));
    expect(db.isOpen).toBe(true);
    db.close();
  });

  test("constructor rejects non-UTF-8 Uint8Array paths instead of opening a temp db", () => {
    // 0xff 0xfe is not valid UTF-8. Previously this would fall through to
    // sqlite3_open_v2("") which opens an anonymous temporary database —
    // silently swallowing the user's path.
    expect(() => new DatabaseSync(Buffer.from([0x3a, 0xff, 0xfe]))).toThrow(
      expect.objectContaining({ code: "ERR_INVALID_ARG_VALUE" }),
    );
  });

  test("statements from a prior connection are finalized across close()/open()", () => {
    const db = new DatabaseSync(":memory:", { open: false });
    db.open();
    const stmt = db.prepare("SELECT 1 AS v");
    expect(stmt.get().v).toBe(1);
    db.close();
    db.open();
    // Statement was prepared on the *previous* (now-zombie) connection.
    // Using it must report ERR_INVALID_STATE, not step against the
    // zombie and then read a bogus "not an error" from the new handle.
    expect(() => stmt.get()).toThrow(
      expect.objectContaining({
        code: "ERR_INVALID_STATE",
        message: expect.stringMatching(/statement has been finalized/),
      }),
    );
    db.close();
  });

  test("exposes changeset constants", () => {
    expect(constants.SQLITE_CHANGESET_OMIT).toBe(0);
    expect(constants.SQLITE_CHANGESET_REPLACE).toBe(1);
    expect(constants.SQLITE_CHANGESET_ABORT).toBe(2);
  });

  test("database-level defaults flow to prepared statements", () => {
    const db = new DatabaseSync(":memory:", { readBigInts: true, returnArrays: true });
    const row = db.prepare("SELECT 42 AS v").get();
    expect(row).toEqual([42n]);
    // per-statement override beats the db default
    const stmt = db.prepare("SELECT 42 AS v", { readBigInts: false, returnArrays: false });
    expect(stmt.get()).toEqual({ __proto__: null, v: 42 });
    db.close();
  });
});

describe("DatabaseSync.prototype.function()", () => {
  test("registers scalar UDFs and propagates JS exceptions", () => {
    const db = new DatabaseSync(":memory:");
    db.function("double_it", x => x * 2);
    expect(db.prepare("SELECT double_it(21) AS v").get().v).toBe(42);

    db.function("join_args", { varargs: true }, (...a) => a.join("-"));
    expect(db.prepare("SELECT join_args('a','b','c') AS v").get().v).toBe("a-b-c");

    // An exception thrown inside the UDF surfaces as-is, not wrapped
    // in ERR_SQLITE_ERROR.
    db.function("boom", () => {
      throw new TypeError("kaboom");
    });
    expect(() => db.prepare("SELECT boom()").get()).toThrow(
      expect.objectContaining({ name: "TypeError", message: "kaboom" }),
    );
    db.close();
  });

  test("deterministic flag permits use in generated columns", () => {
    const db = new DatabaseSync(":memory:");
    db.function("square", { deterministic: true }, (x: number) => x * x);
    // Deterministic UDFs are allowed in generated-column expressions.
    db.exec("CREATE TABLE t (n INTEGER, sq INTEGER GENERATED ALWAYS AS (square(n)))");
    db.prepare("INSERT INTO t (n) VALUES (?)").run(7);
    expect(db.prepare("SELECT sq FROM t").get().sq).toBe(49);

    db.function("rnd", { deterministic: false }, () => Math.random());
    expect(() => db.exec("CREATE TABLE u (n INTEGER, r REAL GENERATED ALWAYS AS (rnd()))")).toThrow(
      /non-deterministic/,
    );
    db.close();
  });

  test("unsupported return types produce ERR_SQLITE_ERROR", () => {
    const db = new DatabaseSync(":memory:");
    db.function("bad", () => ({ nope: true }));
    expect(() => db.prepare("SELECT bad()").get()).toThrow(
      expect.objectContaining({
        code: "ERR_SQLITE_ERROR",
        message: expect.stringMatching(/cannot be converted to a SQLite value/),
      }),
    );
    db.function("async_bad", () => Promise.resolve(1));
    expect(() => db.prepare("SELECT async_bad()").get()).toThrow(
      /Asynchronous user-defined functions are not supported/,
    );
    db.close();
  });
});

describe("DatabaseSync.prototype.aggregate()", () => {
  function setup() {
    const db = new DatabaseSync(":memory:");
    db.exec("CREATE TABLE t (n INTEGER); INSERT INTO t VALUES (1),(2),(3),(4)");
    return db;
  }

  test("basic sum aggregate", () => {
    const db = setup();
    db.aggregate("my_sum", { start: 0, step: (acc: number, n: number) => acc + n });
    expect(db.prepare("SELECT my_sum(n) AS s FROM t").get().s).toBe(10);
    db.close();
  });

  test("start as a factory function and result transform", () => {
    const db = setup();
    db.aggregate("my_avg", {
      start: () => [0, 0] as [number, number],
      step: (acc, n: number) => [acc[0] + n, acc[1] + 1] as [number, number],
      result: acc => acc[0] / acc[1],
    });
    expect(db.prepare("SELECT my_avg(n) AS s FROM t").get().s).toBe(2.5);
    db.close();
  });

  test("window aggregates via inverse", () => {
    const db = setup();
    db.aggregate("win_sum", {
      start: 0,
      step: (acc: number, n: number) => acc + n,
      inverse: (acc: number, n: number) => acc - n,
    });
    const rows = db.prepare("SELECT win_sum(n) OVER (ROWS BETWEEN 1 PRECEDING AND 1 FOLLOWING) AS s FROM t").all();
    expect(rows.map(r => r.s)).toEqual([3, 6, 9, 7]);
    db.close();
  });

  test("errors in step/start/result propagate to the caller", () => {
    const db = setup();
    db.aggregate("step_throw", {
      start: 0,
      step: (_acc: number, _n: number) => {
        throw new Error("step failed");
      },
    });
    expect(() => db.prepare("SELECT step_throw(n) FROM t").get()).toThrow("step failed");

    db.aggregate("start_throw", {
      start: () => {
        throw new Error("start failed");
      },
      step: (_acc: number, _n: number) => 0,
    });
    expect(() => db.prepare("SELECT start_throw(n) FROM t").get()).toThrow("start failed");
    db.close();
  });
});

describe("StatementSync.prototype.iterate()", () => {
  function setup() {
    const db = new DatabaseSync(":memory:");
    db.exec("CREATE TABLE t (n INTEGER); INSERT INTO t VALUES (1),(2),(3),(4)");
    return db;
  }

  test("yields rows lazily and is for-of iterable", () => {
    const db = setup();
    const iter = db.prepare("SELECT n FROM t ORDER BY n").iterate();
    // Inherits from %IteratorPrototype% so @@iterator returns itself.
    expect(iter[Symbol.iterator]()).toBe(iter);
    expect([...iter].map(r => r.n)).toEqual([1, 2, 3, 4]);
    // Exhausted iterator keeps returning done.
    expect(iter.next()).toEqual({ __proto__: null, done: true, value: null });
    db.close();
  });

  test("early break resets the underlying statement", () => {
    const db = setup();
    const stmt = db.prepare("SELECT n FROM t ORDER BY n");
    const seen: number[] = [];
    for (const row of stmt.iterate()) {
      seen.push(row.n);
      if (seen.length === 2) break;
    }
    expect(seen).toEqual([1, 2]);
    // After break, the statement is reusable from the start.
    expect(stmt.all().map(r => r.n)).toEqual([1, 2, 3, 4]);
    db.close();
  });

  test("detects statement reuse while iterating", () => {
    const db = setup();
    const stmt = db.prepare("SELECT n FROM t ORDER BY n");
    const iter = stmt.iterate();
    expect(iter.next().value.n).toBe(1);
    // Calling run()/all()/get() on the same statement resets it, so the
    // iterator's cursor position is no longer meaningful.
    stmt.all();
    expect(() => iter.next()).toThrow(/statement has been reset/);
    db.close();
  });
});

describe("Session / changeset", () => {
  test("captures changes and applies them to another database", () => {
    const src = new DatabaseSync(":memory:");
    src.exec("CREATE TABLE s (id INTEGER PRIMARY KEY, v TEXT)");
    const session = src.createSession();
    expect(Object.prototype.toString.call(session)).toBe("[object Session]");
    src.exec("INSERT INTO s VALUES (1, 'hello'), (2, 'world')");

    const changeset = session.changeset();
    expect(changeset).toBeInstanceOf(Uint8Array);
    expect(changeset.length).toBeGreaterThan(0);
    const patchset = session.patchset();
    expect(patchset).toBeInstanceOf(Uint8Array);
    session.close();
    expect(() => session.changeset()).toThrow(/session is not open/);

    const dst = new DatabaseSync(":memory:");
    dst.exec("CREATE TABLE s (id INTEGER PRIMARY KEY, v TEXT)");
    expect(dst.applyChangeset(changeset)).toBe(true);
    expect(
      dst
        .prepare("SELECT v FROM s ORDER BY id")
        .all()
        .map(r => r.v),
    ).toEqual(["hello", "world"]);

    src.close();
    dst.close();
  });

  test("conflict handler receives the conflict type", () => {
    const src = new DatabaseSync(":memory:");
    const dst = new DatabaseSync(":memory:");
    for (const db of [src, dst]) db.exec("CREATE TABLE s (id INTEGER PRIMARY KEY, v TEXT)");
    dst.exec("INSERT INTO s VALUES (1, 'already there')");

    const session = src.createSession({ table: "s" });
    src.exec("INSERT INTO s VALUES (1, 'incoming')");
    const changeset = session.changeset();

    let observed: number | undefined;
    const ok = dst.applyChangeset(changeset, {
      onConflict: type => {
        observed = type;
        return constants.SQLITE_CHANGESET_OMIT;
      },
    });
    expect(ok).toBe(true);
    expect(observed).toBe(constants.SQLITE_CHANGESET_CONFLICT);
    // Row was omitted, original preserved.
    expect(dst.prepare("SELECT v FROM s WHERE id = 1").get().v).toBe("already there");
    src.close();
    dst.close();
  });

  test("filter callback skips tables", () => {
    const src = new DatabaseSync(":memory:");
    const dst = new DatabaseSync(":memory:");
    for (const db of [src, dst]) {
      db.exec("CREATE TABLE a (id INTEGER PRIMARY KEY, v TEXT)");
      db.exec("CREATE TABLE b (id INTEGER PRIMARY KEY, v TEXT)");
    }
    const session = src.createSession();
    src.exec("INSERT INTO a VALUES (1, 'keep')");
    src.exec("INSERT INTO b VALUES (1, 'drop')");

    dst.applyChangeset(session.changeset(), {
      filter: table => table === "a",
    });
    expect(dst.prepare("SELECT count(*) AS c FROM a").get().c).toBe(1);
    expect(dst.prepare("SELECT count(*) AS c FROM b").get().c).toBe(0);
    src.close();
    dst.close();
  });

  test("default onConflict aborts and returns false", () => {
    const src = new DatabaseSync(":memory:");
    const dst = new DatabaseSync(":memory:");
    for (const db of [src, dst]) db.exec("CREATE TABLE s (id INTEGER PRIMARY KEY, v TEXT)");
    dst.exec("INSERT INTO s VALUES (1, 'x')");
    const session = src.createSession();
    src.exec("INSERT INTO s VALUES (1, 'y')");
    expect(dst.applyChangeset(session.changeset())).toBe(false);
    src.close();
    dst.close();
  });

  test("unclosed session is cleaned up on db.close()", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY)");
    const session = db.createSession();
    db.exec("INSERT INTO t VALUES (1)");
    db.close();
    // Session handle was freed by close(); using it now is an error but not a crash.
    expect(() => session.changeset()).toThrow(/database is not open/);
  });
});

// Each backup_step with rate=1 fsyncs the destination once per page; on slow
// CI filesystems that can take a couple of seconds per call, so give these
// tests generous timeouts and keep the page count tiny.
describe("backup()", () => {
  test("copies an in-memory database to a file", async () => {
    using dir = tempDir("node-sqlite-backup", {});
    const src = new DatabaseSync(":memory:");
    src.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, data TEXT)");
    src.exec("INSERT INTO t (data) VALUES ('a'), ('b'), ('c')");

    const destPath = path.join(String(dir), "dst.db");
    let progressCalls = 0;
    const pages = await backup(src, destPath, {
      rate: 1,
      progress: ({ totalPages, remainingPages }) => {
        expect(typeof totalPages).toBe("number");
        expect(typeof remainingPages).toBe("number");
        progressCalls++;
      },
    });
    expect(typeof pages).toBe("number");
    expect(progressCalls).toBeGreaterThan(0);

    const dst = new DatabaseSync(destPath);
    expect(dst.prepare("SELECT count(*) AS c FROM t").get().c).toBe(3);
    src.close();
    dst.close();
  }, 30_000);

  test("rejects with ERR_SQLITE_ERROR when the destination is unwritable", async () => {
    using dir = tempDir("node-sqlite-backup-badpath", {});
    const src = new DatabaseSync(":memory:");
    src.exec("CREATE TABLE t (x)");
    // A file inside a directory that doesn't exist — sqlite3_open_v2 will
    // fail with SQLITE_CANTOPEN on every platform. Using tempDir keeps the
    // path shape correct on Windows.
    const bad = path.join(String(dir), "no-such-subdir", "x.db");
    await expect(backup(src, bad)).rejects.toMatchObject({
      code: "ERR_SQLITE_ERROR",
    });
    src.close();
  });

  test("progress callback exceptions reject the promise", async () => {
    using dir = tempDir("node-sqlite-backup-err", {});
    const src = new DatabaseSync(":memory:");
    // Enough rows to span >1 page so the progress callback fires at least
    // once before SQLITE_DONE.
    src.exec("CREATE TABLE t (id INTEGER PRIMARY KEY)");
    src.exec("BEGIN");
    for (let i = 0; i < 1000; i++) src.prepare("INSERT INTO t DEFAULT VALUES").run();
    src.exec("COMMIT");
    await expect(
      backup(src, path.join(String(dir), "dst.db"), {
        rate: 1,
        progress: () => {
          throw new Error("nope");
        },
      }),
    ).rejects.toThrow("nope");
    src.close();
  }, 30_000);
});

describe("StatementSync.prototype.columns()", () => {
  test("exposes origin table/column/database metadata", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)");
    const cols = db.prepare("SELECT id, name AS display FROM t").columns();
    expect(cols).toEqual([
      { __proto__: null, column: "id", database: "main", name: "id", table: "t", type: "INTEGER" },
      { __proto__: null, column: "name", database: "main", name: "display", table: "t", type: "TEXT" },
    ]);
    // Computed expressions have no origin column/table.
    const exprCols = db.prepare("SELECT 1 + 1 AS two").columns();
    expect(exprCols[0]).toEqual({
      __proto__: null,
      column: null,
      database: null,
      name: "two",
      table: null,
      type: null,
    });
    db.close();
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
