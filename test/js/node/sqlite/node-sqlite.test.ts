import { heapStats } from "bun:jsc";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { existsSync, statSync } from "node:fs";
import { builtinModules, isBuiltin } from "node:module";
import path from "node:path";
import { DatabaseSync, Session, StatementSync, backup, constants } from "node:sqlite";
import { pathToFileURL } from "node:url";

// On macOS bun dlopens the system libsqlite3.dylib, which Apple builds
// without SQLITE_ENABLE_SESSION. createSession()/applyChangeset() throw
// with a hint to use Database.setCustomSQLite(); tests that need the
// session extension skip on such a library.
const sqliteHasSession = (() => {
  try {
    new DatabaseSync(":memory:").createSession();
    return true;
  } catch {
    return false;
  }
})();
// Apple's system libsqlite3 is built with SQLITE_OMIT_LOAD_EXTENSION.
const sqliteHasLoadExtension = (() => {
  try {
    new DatabaseSync(":memory:", { allowExtension: true }).close();
    return true;
  } catch {
    return false;
  }
})();

test("node:sqlite is a built-in module", () => {
  expect(isBuiltin("node:sqlite")).toBe(true);
  // Like node:test, node:sqlite is only available with the node: prefix.
  expect(isBuiltin("sqlite")).toBe(false);
  expect(builtinModules).toContain("node:sqlite");
});

test("process.versions.sqlite is set", () => {
  expect(typeof process.versions.sqlite).toBe("string");
  expect(process.versions.sqlite).toMatch(/^3\.\d+\.\d+$/);
});

test("process.versions.sqlite read before the first open matches the library that runs", async () => {
  // On the dlopen path, reading process.versions before any database is
  // opened must still report the version of the library that WOULD be
  // loaded (via a throwaway dlopen probe), not a bundled constant that
  // isn't linked into the binary. The versions object is cached on first
  // access, so this must run in a fresh process.
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        const v = process.versions.sqlite;
        const { DatabaseSync } = require("node:sqlite");
        const db = new DatabaseSync(":memory:");
        const actual = db.prepare("SELECT sqlite_version() AS v").get().v;
        db.close();
        console.log(JSON.stringify({ reported: v, actual }));
      `,
    ],
    env: bunEnv,
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const { reported, actual } = JSON.parse(stdout.trim());
  expect({ reported, actual, stderr, exitCode }).toEqual({
    reported: actual,
    actual,
    stderr: expect.any(String),
    exitCode: 0,
  });
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

  test("binds JS numbers as REAL (matches Node) and is representation-independent", () => {
    // Node v26.3.0 unconditionally uses sqlite3_bind_double for JS numbers —
    // no IsInt32 fast path — so typeof(?) on a bare parameter (no column
    // affinity) is 'real' and expandedSQL shows 42.0. Branching on JSC's
    // tag-bit isInt32() would also give literal 42 vs Float64Array[0]=42
    // different storage classes.
    const db = new DatabaseSync(":memory:");
    expect(db.prepare("SELECT typeof(?) AS t").get(42).t).toBe("real");
    expect(db.prepare("SELECT typeof(?) AS t").get(new Float64Array([42])[0]).t).toBe("real");
    expect(db.prepare("SELECT typeof(?) AS t").get(1.5).t).toBe("real");
    // BigInt is the way to bind an INTEGER.
    expect(db.prepare("SELECT typeof(?) AS t").get(42n).t).toBe("integer");
    // UDF results follow the same rule.
    db.function("f", () => 42);
    expect(db.prepare("SELECT typeof(f()) AS t").get().t).toBe("real");
    // expandedSQL reflects the bound storage class.
    const stmt = db.prepare("SELECT ?");
    stmt.get(42);
    expect(stmt.expandedSQL).toBe("SELECT 42.0");
    db.close();
  });

  test("binds a detached ArrayBufferView as a zero-length BLOB, not NULL", () => {
    // Matches Node (whose ArrayBufferViewContents falls back to non-null
    // stack storage). NULL vs X'' is observable via a NOT NULL column and
    // via typeof(?).
    const db = new DatabaseSync(":memory:");
    db.exec("CREATE TABLE t (b BLOB NOT NULL)");
    const buf = new Uint8Array(4);
    // Detach by transferring the underlying ArrayBuffer to a MessageChannel port.
    structuredClone(buf.buffer, { transfer: [buf.buffer] });
    expect(buf.byteLength).toBe(0);
    expect(db.prepare("SELECT typeof(?) AS t").get(buf).t).toBe("blob");
    expect(() => db.prepare("INSERT INTO t VALUES (?)").run(buf)).not.toThrow();
    expect(db.prepare("SELECT length(b) AS n FROM t").get().n).toBe(0);
    db.close();
  });

  test("decodes non-UTF-8 TEXT with replacement characters, not empty strings", () => {
    // Regression: WTF::String::fromUTF8 returns null on invalid bytes and
    // jsString(null) becomes "". Matches bun:sqlite (#31514) and Node.
    const db = new DatabaseSync(":memory:");
    expect(db.prepare("SELECT CAST(x'4A6F73E9' AS TEXT) AS v").get().v).toBe("Jos�");
    // >64-byte variant to ensure the slow decode path is covered.
    const long = db.prepare("SELECT CAST((? || x'E9') AS TEXT) AS v").get("x".repeat(80)).v;
    expect(long).toBe("x".repeat(80) + "�");
    // UDF argv path (sqliteValueToJS) hits the same replacement decode.
    let seen: string | undefined;
    db.function("cap", v => void (seen = v));
    db.prepare("SELECT cap(CAST(x'4A6F73E9' AS TEXT))").get();
    expect(seen).toBe("Jos�");
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

  test("DatabaseSync can be subclassed", () => {
    class X extends DatabaseSync {
      myMethod() {
        return this.isOpen;
      }
    }
    const x = new X(":memory:");
    expect(x instanceof X).toBe(true);
    expect(x instanceof DatabaseSync).toBe(true);
    expect(Object.getPrototypeOf(x)).toBe(X.prototype);
    expect(x.myMethod()).toBe(true);
    x.exec("CREATE TABLE t (x)");
    expect(x.prepare("SELECT 1 AS v").get()).toEqual({ v: 1 });
    x.close();
  });

  test("isOpen/isTransaction/limits/sourceSQL/expandedSQL are own accessor properties", () => {
    // Node installs these via InstanceTemplate()->SetAccessorProperty
    // (DontDelete), so Object.keys() lists them and {...obj} copies them.
    const db = new DatabaseSync(":memory:");
    db.exec("CREATE TABLE t (x)");
    const stmt = db.prepare("SELECT 1");
    const tag = db.createTagStore();
    expect(Object.keys(db)).toEqual(["isOpen", "isTransaction", "limits"]);
    expect(Object.keys(stmt)).toEqual(["sourceSQL", "expandedSQL"]);
    expect(Object.keys(tag)).toEqual(["capacity", "db", "size"]);
    const desc = Object.getOwnPropertyDescriptor(db, "isOpen")!;
    expect({
      hasGet: typeof desc.get,
      set: desc.set,
      enumerable: desc.enumerable,
      configurable: desc.configurable,
    }).toEqual({
      hasGet: "function",
      set: undefined,
      enumerable: true,
      configurable: false,
    });
    expect(Object.getOwnPropertyDescriptor(Object.getPrototypeOf(db), "isOpen")).toBeUndefined();
    expect(Object.keys({ ...db })).toEqual(["isOpen", "isTransaction", "limits"]);
    db.close();
  });

  test("an Array first argument is treated as a named-parameter object", () => {
    // Node's test is IsObject() && !IsArrayBufferView(); Arrays are not
    // special-cased. Their own-enumerable keys ("0", "1", …) go through the
    // named-parameter path, so the default behaviour is ERR_INVALID_STATE
    // for the unknown name, and allowUnknownNamedParameters makes it a no-op.
    const db = new DatabaseSync(":memory:");
    db.exec("CREATE TABLE t (x)");
    const s1 = db.prepare("INSERT INTO t VALUES (?)");
    expect(() => s1.run([99])).toThrow(
      expect.objectContaining({ code: "ERR_INVALID_STATE", message: "Unknown named parameter '0'" }),
    );
    const s2 = db.prepare("INSERT INTO t VALUES (?)");
    s2.setAllowUnknownNamedParameters(true);
    expect(s2.run([99])).toEqual({ changes: 1, lastInsertRowid: 1 });
    expect(db.prepare("SELECT x FROM t").all()).toEqual([{ x: null }]);
    db.close();
  });

  test("prepare() with empty / comment-only SQL returns a finalized StatementSync", () => {
    const db = new DatabaseSync(":memory:");
    for (const sql of ["", "   ", "-- a comment", "/* block */"]) {
      const stmt = db.prepare(sql);
      expect(stmt).toBeInstanceOf(StatementSync);
      for (const fn of [() => stmt.run(), () => stmt.get(), () => stmt.all(), () => stmt.iterate()]) {
        expect(fn).toThrow(
          expect.objectContaining({
            code: "ERR_INVALID_STATE",
            message: "statement has been finalized",
          }),
        );
      }
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
    // 0xff 0xfe is not valid UTF-8. Intentional divergence from Node (which
    // hands the raw bytes to sqlite3_open_v2 with no UTF-8 check); Bun
    // stores the path as WTF::String, so accepting arbitrary bytes would
    // fall through to sqlite3_open_v2("") — an anonymous temporary
    // database, silently swallowing the user's path. Documented in
    // docs/runtime/nodejs-compat.mdx.
    expect(() => new DatabaseSync(Buffer.from([0x3a, 0xff, 0xfe]))).toThrow(
      expect.objectContaining({ code: "ERR_INVALID_ARG_VALUE" }),
    );
  });

  test("explicit undefined options argument is rejected where Node validates on arity", () => {
    // Node's constructor/createSession/function/backup gate on args.Length(),
    // so an explicitly-passed `undefined` is rejected even though an omitted
    // argument is accepted. prepare/applyChangeset/etc gate on IsUndefined()
    // and accept explicit undefined; this test pins the arity-gated set.
    const invalidOptions = expect.objectContaining({
      code: "ERR_INVALID_ARG_TYPE",
      message: 'The "options" argument must be an object.',
    });

    expect(() => new DatabaseSync(":memory:", undefined)).toThrow(invalidOptions);
    expect(() => new DatabaseSync(":memory:", null)).toThrow(invalidOptions);
    new DatabaseSync(":memory:").close();

    const db = new DatabaseSync(":memory:");
    try {
      expect(() => db.function("f", undefined, () => 1)).toThrow(invalidOptions);
      expect(() => db.function("f", null, () => 1)).toThrow(invalidOptions);
      db.function("f", () => 1);

      if (sqliteHasSession) {
        expect(() => db.createSession(undefined)).toThrow(invalidOptions);
        expect(() => db.createSession(null)).toThrow(invalidOptions);
        db.createSession();
      }

      expect(() => backup(db, ":memory:", undefined)).toThrow(invalidOptions);
      expect(() => backup(db, ":memory:", null)).toThrow(invalidOptions);

      // Controls: these are value-gated in Node (explicit undefined is the
      // same as omission) and must NOT throw.
      db.prepare("SELECT 1", undefined);
      expect(db.location(undefined)).toBeNull();
    } finally {
      db.close();
    }
  });

  test("file: URL objects pass query parameters to SQLite", () => {
    // Node hands the raw href (including ?query) to sqlite3_open_v2
    // with SQLITE_OPEN_URI set, so ?mode=ro / ?cache=shared are
    // honoured. A URL object must NOT be reduced to a bare
    // filesystem path first (doing so would drop the query and,
    // on Windows, misinterpret drive-letter handling).
    using dir = tempDir("node-sqlite-uri", {});
    const dbFile = path.join(String(dir), "ro.db");
    const seed = new DatabaseSync(dbFile);
    seed.exec("CREATE TABLE t(a INTEGER PRIMARY KEY)");
    seed.exec("INSERT INTO t VALUES (1)");
    seed.close();

    const url = new URL(pathToFileURL(dbFile).href + "?mode=ro");
    const db = new DatabaseSync(url);
    expect(db.prepare("SELECT a FROM t").get()).toEqual({ a: 1 });
    // Read-only came from the URI query, not from {readOnly: true} —
    // if the query were stripped this insert would succeed.
    expect(() => db.exec("INSERT INTO t VALUES (2)")).toThrow(expect.objectContaining({ code: "ERR_SQLITE_ERROR" }));
    db.close();
    // The temporary statement above is not yet GC'd, so sqlite3_close_v2
    // left the connection in zombie mode with ro.db still open. On Windows
    // that blocks tempDir's rm with EBUSY; force the finalizer.
    Bun.gc(true);
  });

  test("close() re-entered from a bind-parameter getter succeeds; the outer run() fails", () => {
    // Node lets close() succeed even when re-entered mid-operation (bind
    // getters, option getters, UDFs). sqlite3_close_v2 zombifies the
    // connection while any stmt is outstanding, so the in-flight bind sees
    // a valid handle; the subsequent step() fails on the zombie and Node
    // reports errcode 7 (sqlite3_errmsg(NULL) → "out of memory").
    const db = new DatabaseSync(":memory:");
    db.exec("CREATE TABLE t (a)");
    const stmt = db.prepare("INSERT INTO t VALUES (:a)");
    let closeErr: unknown;
    let runErr: unknown;
    try {
      stmt.run({
        get a() {
          try {
            db.close();
          } catch (e) {
            closeErr = e;
          }
          return 1;
        },
      });
    } catch (e) {
      runErr = e;
    }
    expect(closeErr).toBeUndefined();
    expect(db.isOpen).toBe(false);
    expect(runErr).toMatchObject({ code: "ERR_SQLITE_ERROR" });
  });

  test("close() re-entered from an options getter closes; the outer call throws 'not open'", () => {
    // Node segfaults on this pattern (function()/aggregate()/createSession()/
    // deserialize() all pass connection() straight to sqlite after option
    // reading with no re-check). Bun re-checks and throws instead.
    const db = new DatabaseSync(":memory:");
    expect(() =>
      db.function(
        "f",
        {
          get varargs() {
            db.close();
            return true;
          },
        },
        () => 0,
      ),
    ).toThrow(expect.objectContaining({ code: "ERR_INVALID_STATE", message: "database is not open" }));
    expect(db.isOpen).toBe(false);
  });

  test("deserialize() re-checks the connection after a hostile opts.dbName getter closes it", () => {
    // A hostile opts.dbName getter can db.close() before
    // sqlite3_deserialize is called. Without a re-check the null
    // connection would segfault (the bundled amalgamation lacks
    // SQLITE_ENABLE_API_ARMOR); Node segfaults on this pattern.
    const src = new DatabaseSync(":memory:");
    src.exec("CREATE TABLE t(x INTEGER)");
    const buf = src.serialize();
    src.close();

    const db = new DatabaseSync(":memory:");
    let closeErr: unknown;
    expect(() =>
      db.deserialize(buf, {
        get dbName() {
          try {
            db.close();
          } catch (e) {
            closeErr = e;
          }
          return "main";
        },
      }),
    ).toThrow(expect.objectContaining({ code: "ERR_INVALID_STATE", message: "database is not open" }));
    expect(closeErr).toBeUndefined();
    expect(db.isOpen).toBe(false);
  });

  test("deserialize() rejects a buffer detached by the options getter", () => {
    // The BusyScope added above blocks db.close() re-entry, but does
    // nothing about the *input buffer*: if the span is captured
    // before opts.dbName is read, a hostile getter can
    //   buf.buffer.transfer(); Bun.gc(true);
    // freeing the backing store, and the later memcpy() reads freed
    // memory — the deserialize() analogue of the applyChangeset
    // buffer-detach UAF. The span must be (re-)captured only after
    // option parsing has run.
    const src = new DatabaseSync(":memory:");
    src.exec("CREATE TABLE t(x INTEGER)");
    const buf = src.serialize();
    src.close();

    const db = new DatabaseSync(":memory:");
    expect(() =>
      db.deserialize(buf, {
        get dbName() {
          buf.buffer.transfer();
          Bun.gc(true);
          return "main";
        },
      }),
    ).toThrow(expect.objectContaining({ code: "ERR_INVALID_ARG_VALUE" }));
    expect(db.isOpen).toBe(true);
    db.close();
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

  test("prepare() reads options before compiling the SQL (Node error precedence)", () => {
    // Node's DatabaseSync::Prepare validates the options object first, so a
    // bad option beats a syntax error and the authorizer never fires. Also
    // means no compensating sqlite3_finalize() on the option-error path.
    const db = new DatabaseSync(":memory:");
    let authorized = false;
    db.setAuthorizer(() => ((authorized = true), 0));
    expect(() => db.prepare("NOT SQL", { readBigInts: "x" as any })).toThrow(
      expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" }),
    );
    expect(authorized).toBe(false);
    db.setAuthorizer(null);
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

  test("registration failure does not double-free the UDF context", () => {
    // sqlite3_create_function_v2 calls xDestroy(p) on the failure path
    // (name >255 bytes → SQLITE_MISUSE); a second manual delete on our
    // side would crash under ASAN. These should throw cleanly.
    const db = new DatabaseSync(":memory:");
    const longName = "a".repeat(300);
    expect(() => db.function(longName, () => 0)).toThrow(expect.objectContaining({ code: "ERR_SQLITE_ERROR" }));
    expect(() => db.aggregate(longName, { start: 0, step: (a, n) => a + n })).toThrow(
      expect.objectContaining({ code: "ERR_SQLITE_ERROR" }),
    );
    db.close();
  });

  test("re-entering a statement from its own UDF throws instead of crashing", () => {
    // sqlite3_reset on a VDBE that is mid-sqlite3_step corrupts the running
    // state; Node v26.3.0 segfaults on this shape. Bun refuses with
    // ERR_INVALID_STATE via isStepping() before touching the handle.
    const db = new DatabaseSync(":memory:");
    db.exec("CREATE TABLE t (x)");
    let stmt: StatementSync;
    db.function("reenter", () => {
      try {
        stmt.run();
        return "ran";
      } catch (e: any) {
        return e.code;
      }
    });
    stmt = db.prepare("INSERT INTO t VALUES (reenter())");
    stmt.run();
    expect(db.prepare("SELECT x FROM t").all()).toEqual([{ x: "ERR_INVALID_STATE" }]);
    // get()/all()/iterate() on the same statement are guarded the same way.
    let caught: string[] = [];
    db.function("reenter2", () => {
      for (const fn of ["run", "get", "all", "iterate"] as const) {
        try {
          (stmt2[fn] as () => void)();
          caught.push("ran");
        } catch (e: any) {
          caught.push(e.code);
        }
      }
      return null;
    });
    const stmt2 = db.prepare("SELECT reenter2()");
    stmt2.get();
    expect(caught).toEqual(["ERR_INVALID_STATE", "ERR_INVALID_STATE", "ERR_INVALID_STATE", "ERR_INVALID_STATE"]);
    // Iterator next() on a statement whose step() is on the stack is the
    // same re-entry path without a reset.
    db.exec("INSERT INTO t VALUES ('a'),('b')");
    let iterCaught;
    db.function("reenter3", () => {
      try {
        it.next();
        return "stepped";
      } catch (e: any) {
        iterCaught = e.code;
        return e.code;
      }
    });
    const it = db.prepare("SELECT reenter3() AS r FROM t").iterate();
    expect(it.next().value).toEqual({ r: "ERR_INVALID_STATE" });
    expect(iterCaught).toBe("ERR_INVALID_STATE");
    it.return();
    // Iterator return() while stepping skips the sqlite3_reset (tolerant)
    // and just marks done; the outer next() still yields the in-flight row.
    db.function("reenter4", () => {
      it2.return();
      return "r";
    });
    const it2 = db.prepare("SELECT reenter4() AS r FROM t").iterate();
    expect(it2.next()).toEqual({ done: false, value: { r: "r" } });
    expect(it2.next()).toEqual({ done: true, value: null });
    db.close();
  });

  test("re-entering a statement from a bind-parameter getter is not guarded (Node parity)", () => {
    // The isStepping() guard only covers the mid-VDBE case above. bindParams
    // runs BEFORE SteppingScope, so a getter that re-enters the same
    // statement passes the guard: it clears the outer's bindings, binds and
    // steps its own, then the outer resumes binding. Node has no guard at
    // all here; assert Bun matches Node's observable behavior (the inner
    // call's bindings win for keys it binds; the outer's later keys
    // overwrite).
    const db = new DatabaseSync(":memory:");
    const stmt = db.prepare("SELECT :a AS a, :b AS b");
    let inner;
    const params = {
      a: 1,
      get b() {
        inner = stmt.get({ a: 10, b: 20 });
        return 2;
      },
    };
    // Inner call clears+rebinds+steps+resets while :a=1 was already bound;
    // outer resumes binding only :b, so :a keeps the inner's value.
    expect(stmt.get(params)).toEqual({ __proto__: null, a: 10, b: 2 });
    expect(inner).toEqual({ __proto__: null, a: 10, b: 20 });
    db.close();
  });

  test("closing the database from a UDF keeps the callbacks rooted until the scan completes", async () => {
    // closeInternal() clears m_registeredCallbacks; with close() no longer
    // refusing while busy, doing so mid-step would unroot every UDF callback
    // while the zombified connection still invokes them. Force system malloc
    // so ASAN surfaces the use-after-free if the guard regresses.
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const { DatabaseSync } = require("node:sqlite");
          const db = new DatabaseSync(":memory:");
          db.exec("CREATE TABLE t (x)");
          for (let i = 0; i < 30; i++) db.prepare("INSERT INTO t VALUES (?)").run(i);
          let n = 0;
          db.function("gcer", v => { Bun.gc(true); return v; });
          db.function("target", v => { if (++n === 3) db.close(); return v; });
          const rows = db.prepare("SELECT target(x) AS t, gcer(x) AS g FROM t").all();
          console.log(JSON.stringify({ rows: rows.length, calls: n, isOpen: db.isOpen }));
        `,
      ],
      // Malloc=1 forces bmalloc's SystemHeap so ASAN catches a regression.
      // WebKit stubs that heap out on Windows (RELEASE_BASSERT_NOT_REACHED),
      // so the child would trap at JSC init before running any test code.
      env: isWindows ? bunEnv : { ...bunEnv, Malloc: "1" },
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    // On regression ASAN aborts the process, so stdout/exitCode are the
    // fail condition; stderr is captured so the diff is informative.
    expect({ stdout: stdout.trim(), stderr, exitCode }).toEqual({
      stdout: JSON.stringify({ rows: 30, calls: 30, isOpen: false }),
      stderr: expect.any(String),
      exitCode: 0,
    });
  });

  test("closing the database from an authorizer during the first prepare() defers sqlite3_close_v2", async () => {
    // Authorizer fires from inside sqlite3_prepare_v2 before a Vdbe exists,
    // so sqlite3_close_v2 would free (not zombify) the handle under the
    // parser's feet. The close is deferred until the BusyScope unwinds; on
    // regression ASAN reports heap-use-after-free in sqlite3AuthCheck and
    // the process aborts.
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const { DatabaseSync } = require("node:sqlite");
          const db = new DatabaseSync(":memory:");
          let err;
          db.setAuthorizer(() => { try { db.close(); } catch (e) { err = e.code; } return 0; });
          const stmt = db.prepare("CREATE TABLE t(x)");
          console.log(JSON.stringify({ isOpen: db.isOpen, err, haveStmt: !!stmt }));
        `,
      ],
      // Malloc=1 forces bmalloc's SystemHeap so ASAN catches a regression.
      // WebKit stubs that heap out on Windows (RELEASE_BASSERT_NOT_REACHED),
      // so the child would trap at JSC init before running any test code.
      env: isWindows ? bunEnv : { ...bunEnv, Malloc: "1" },
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout.trim(), stderr, exitCode }).toEqual({
      stdout: JSON.stringify({ isOpen: false, err: "ERR_INVALID_STATE", haveStmt: true }),
      stderr: expect.any(String),
      exitCode: 0,
    });
  });

  test("open() refuses while a deferred close is pending", () => {
    // m_deferredClose is a single slot; close(); open(); close() from a UDF
    // would overwrite it and leak the first handle, and a session on the
    // reopened connection would be swept by finishDeferredClose(). Refusing
    // the open() avoids both.
    const db = new DatabaseSync(":memory:");
    db.exec("CREATE TABLE t (x)");
    let openErr;
    db.function("g", () => {
      db.close();
      try {
        db.open();
        openErr = "opened";
      } catch (e: any) {
        openErr = e.code;
      }
      return null;
    });
    db.prepare("SELECT g()").run();
    expect(openErr).toBe("ERR_INVALID_STATE");
    expect(db.isOpen).toBe(false);
    // Deferred close has completed on BusyScope unwind; a fresh open() works.
    db.open();
    expect(db.isOpen).toBe(true);
    db.close();
  });

  test("step error after a UDF closes the database reports the real error", () => {
    // The wrapper's m_db is nulled by the deferred close; reading the error
    // from it would surface sqlite3_errmsg(NULL) = "out of memory". The
    // statement's own back-pointer (sqlite3_db_handle) still points at the
    // deferred handle until the BusyScope unwinds.
    for (const fn of ["run", "get", "all"] as const) {
      const db = new DatabaseSync(":memory:");
      db.function("f", () => {
        db.close();
        return {};
      });
      expect(() => (db.prepare("SELECT f()")[fn] as () => void)()).toThrow(
        expect.objectContaining({
          code: "ERR_SQLITE_ERROR",
          errcode: 1,
          message: "Returned JavaScript value cannot be converted to a SQLite value",
        }),
      );
    }
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
    expect(() => iter.next()).toThrow(/iterator was invalidated/);
    db.close();
  });

  test("a failed step exhausts the iterator instead of rewinding it", () => {
    const db = setup();
    db.function("boom", x => {
      if (x === 2) throw new Error("boom at row 2");
      return x;
    });
    // No ORDER BY: a sorter would evaluate boom() for every row during the
    // first step; a plain scan evaluates it per next() so the error lands
    // mid-iteration.
    const stmt = db.prepare("SELECT boom(n) AS v FROM t");
    const iter = stmt.iterate();
    expect(iter.next().value.v).toBe(1);
    expect(() => iter.next()).toThrow(/boom at row 2/);
    // Catching the error and continuing must not silently restart from row 1.
    expect(iter.next()).toEqual({ done: true, value: null });
    db.close();
  });

  test("a stale iterator's return() does not rewind a newer iterator", () => {
    const db = setup();
    const stmt = db.prepare("SELECT n FROM t ORDER BY n");
    let newer: ReturnType<typeof stmt.iterate>;
    for (const _row of stmt.iterate()) {
      // Starting a second iterator invalidates the one driving this loop;
      // the implicit return() from `break` (IteratorClose) on the stale
      // iterator must not reset the statement under the newer one.
      newer = stmt.iterate();
      expect(newer.next().value.n).toBe(1);
      break;
    }
    expect(newer!.next().value.n).toBe(2);
    expect(newer!.next().value.n).toBe(3);
    db.close();
  });

  test("return() is tolerant of a finalized statement (IteratorClose on break)", () => {
    // Diverges from Node v26.3.0, which throws ERR_INVALID_STATE here.
    const db = setup();
    const stmt = db.prepare("SELECT n FROM t ORDER BY n");
    const iter = stmt.iterate();
    // Closing the db inside the loop body finalizes the statement; the
    // implicit return() from `break` (IteratorClose) must not turn that
    // into an exception — cleanup should just report done.
    expect(() => {
      for (const _row of iter) {
        db.close();
        break;
      }
    }).not.toThrow();
    // Explicit return() on the now-finalized iterator likewise succeeds.
    expect(iter.return()).toEqual({ __proto__: null, done: true, value: null });
  });
});

test.skipIf(sqliteHasSession)(
  "createSession() throws with a setCustomSQLite hint when the session extension is unavailable",
  () => {
    const db = new DatabaseSync(":memory:");
    expect(() => db.createSession()).toThrow(
      expect.objectContaining({ code: "ERR_SQLITE_ERROR", message: expect.stringMatching(/SQLITE_ENABLE_SESSION/) }),
    );
    expect(() => db.applyChangeset(new Uint8Array())).toThrow(
      expect.objectContaining({ code: "ERR_SQLITE_ERROR", message: expect.stringMatching(/setCustomSQLite/) }),
    );
    db.close();
  },
);

describe.skipIf(!sqliteHasSession)("Session / changeset", () => {
  test("captures changes and applies them to another database", () => {
    const src = new DatabaseSync(":memory:");
    src.exec("CREATE TABLE s (id INTEGER PRIMARY KEY, v TEXT)");
    const session = src.createSession();
    expect(Object.prototype.toString.call(session)).toBe("[object Object]");
    expect(session[Symbol.toStringTag]).toBeUndefined();
    expect(session.constructor.name).toBe("Session");
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

  test("applyChangeset copies the input so callbacks can't detach it mid-iteration", () => {
    // sqlite3changeset_apply stores the raw pointer and streams from it
    // between xFilter calls; detaching the backing ArrayBuffer there
    // would free the memory sqlite is still reading. applyChangeset
    // copies into an owned buffer first, so this must not crash (and the
    // changes are still applied correctly).
    const src = new DatabaseSync(":memory:");
    const dst = new DatabaseSync(":memory:");
    for (const db of [src, dst]) {
      db.exec("CREATE TABLE a (id INTEGER PRIMARY KEY, v TEXT)");
      db.exec("CREATE TABLE b (id INTEGER PRIMARY KEY, v TEXT)");
    }
    const session = src.createSession();
    src.exec("INSERT INTO a VALUES (1, 'x')");
    src.exec("INSERT INTO b VALUES (1, 'y')");
    const changeset = session.changeset();
    let detached = false;
    dst.applyChangeset(changeset, {
      filter: () => {
        if (!detached) {
          // Move the backing store to an unreferenced temp → GC-eligible.
          changeset.buffer.transfer();
          detached = true;
        }
        Bun.gc(true);
        return true;
      },
    });
    expect(dst.prepare("SELECT count(*) AS c FROM a").get().c).toBe(1);
    expect(dst.prepare("SELECT count(*) AS c FROM b").get().c).toBe(1);
    src.close();
    dst.close();
  });

  test("applyChangeset rejects a changeset detached by an options getter", () => {
    // The option getters run before the owned-buffer copy is made; a getter
    // that detaches the input must produce an error, not a silent no-op
    // "successful" apply of an empty changeset.
    const src = new DatabaseSync(":memory:");
    const dst = new DatabaseSync(":memory:");
    for (const db of [src, dst]) db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY)");
    const session = src.createSession();
    src.exec("INSERT INTO t VALUES (1)");
    const changeset = session.changeset();
    expect(() =>
      dst.applyChangeset(changeset, {
        get filter() {
          changeset.buffer.transfer();
          return undefined;
        },
      }),
    ).toThrow(expect.objectContaining({ code: "ERR_INVALID_ARG_VALUE" }));
    expect(dst.prepare("SELECT count(*) AS c FROM t").get().c).toBe(0);
    src.close();
    dst.close();
  });

  test.skipIf(!sqliteHasSession)(
    "re-entering close() from the authorizer during changeset()/patchset() does not free the session mid-generate",
    async () => {
      // sqlite3session_changeset runs SAVEPOINT + prepared SELECTs on the
      // connection, which fires the authorizer. A BusyScope defers
      // db.close()'s session sweep; record->inUse refuses session.close() so
      // sessionGenerateChangeset never reads a freed sqlite3_session*.
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          `
            const { DatabaseSync } = require("node:sqlite");
            for (const what of ["db", "sess", "dispose"]) {
              const db = new DatabaseSync(":memory:");
              db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, x)");
              const sess = db.createSession();
              db.prepare("INSERT INTO t VALUES (1, 'a')").run();
              let caught;
              db.setAuthorizer(() => {
                try {
                  if (what === "db") db.close();
                  else if (what === "sess") sess.close();
                  else sess[Symbol.dispose]();
                } catch (e) { caught = e.code; }
                return 0;
              });
              const cs = sess.changeset();
              console.log(JSON.stringify({ what, len: cs.length, caught: caught ?? null, dbOpen: db.isOpen }));
              try { db.close(); } catch {}
            }
          `,
        ],
        env: isWindows ? bunEnv : { ...bunEnv, Malloc: "1" },
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      const lines = stdout
        .trim()
        .split("\n")
        .map(l => JSON.parse(l));
      // On regression ASAN aborts the process before any line is printed.
      // db.close(): deferred on the first authorizer call (catches nothing),
      //   throws ERR_INVALID_STATE on the second (db already marked closed).
      // sess.close(): record->inUse → ERR_INVALID_STATE.
      // Symbol.dispose: inUse → silent no-op (tolerant).
      expect({ lines, stderr, exitCode }).toEqual({
        lines: [
          { what: "db", len: 20, caught: "ERR_INVALID_STATE", dbOpen: false },
          { what: "sess", len: 20, caught: "ERR_INVALID_STATE", dbOpen: true },
          { what: "dispose", len: 20, caught: null, dbOpen: true },
        ],
        stderr: expect.any(String),
        exitCode: 0,
      });
    },
  );

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

  test("stale session after close()+open() is rejected, not UAF'd", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY)");
    const session = db.createSession();
    db.close();
    db.open();
    // closeInternal() freed the sqlite3_session* but left the wrapper's
    // pointer intact; after re-open the db is "open" again, so without the
    // origin-connection check changeset()/close() would dereference freed
    // memory (heap-use-after-free / double-free under ASAN).
    expect(() => session.changeset()).toThrow(/database is not open/);
    expect(() => session.patchset()).toThrow(/database is not open/);
    expect(() => session.close()).toThrow(/database is not open/);
    // Symbol.dispose swallows.
    expect(() => session[Symbol.dispose]()).not.toThrow();
    db.close();
  });
});

// Each backup_step with rate=1 fsyncs the destination once per page; keep
// the page count tiny so the test stays fast on slow-fsync CI filesystems.
describe("backup()", () => {
  test("backing up a database to its own file rejects promptly", async () => {
    // sqlite3_backup_init only compares sqlite3* pointers, so opening the
    // source path a second time as the destination succeeds — but the
    // source's SHARED lock blocks the destination's EXCLUSIVE upgrade and
    // every sqlite3_backup_step() returns SQLITE_BUSY with remaining == 0.
    // Node only reschedules when remaining != 0, so it rejects on the first
    // step. A regression (unconditional BUSY retry on the JS thread) wedges
    // the process, so run in a subprocess under a bounded timeout.
    using dir = tempDir("node-sqlite-backup-self", {});
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const { DatabaseSync, backup } = require("node:sqlite");
         const db = new DatabaseSync(process.argv[1]);
         db.exec("CREATE TABLE t (a); INSERT INTO t VALUES (1)");
         backup(db, String(db.location())).then(
           v => { console.log("resolved:" + v); process.exit(1); },
           e => { console.log("rejected:" + e.code + ":" + e.errcode); process.exit(0); },
         );`,
        path.join(String(dir), "self.db"),
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      Promise.race([proc.exited, Bun.sleep(4_000).then(() => (proc.kill(), "timeout"))]),
    ]);
    expect({ stdout: stdout.trim(), stderr, exitCode }).toEqual({
      stdout: "rejected:ERR_SQLITE_ERROR:0",
      stderr: expect.any(String),
      exitCode: 0,
    });
  });

  test("rejects promptly when the destination is write-locked", async () => {
    // Same remaining == 0 gate as the self-backup case: the destination
    // connection can't take its write lock, so the first step returns BUSY
    // without ever advancing and Node rejects rather than retrying. Run in
    // a subprocess so a regression is a bounded kill, not a wedged test.
    using dir = tempDir("node-sqlite-backup-locked", {});
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const { DatabaseSync, backup } = require("node:sqlite");
         const path = require("node:path");
         const dest = path.join(process.argv[1], "locked.db");
         const holder = new DatabaseSync(dest);
         holder.exec("BEGIN IMMEDIATE");
         const src = new DatabaseSync(":memory:");
         src.exec("CREATE TABLE t (x); INSERT INTO t VALUES (1)");
         let calls = 0;
         backup(src, dest, { progress: () => calls++ }).then(
           v => { console.log("resolved:" + v); process.exit(1); },
           e => { console.log("rejected:" + e.code + ":" + calls); process.exit(0); },
         );`,
        String(dir),
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      Promise.race([proc.exited, Bun.sleep(4_000).then(() => (proc.kill(), "timeout"))]),
    ]);
    // Node gates progress on remaining != 0, which is never true here, so
    // calls stays 0.
    expect({ stdout: stdout.trim(), stderr, exitCode }).toEqual({
      stdout: "rejected:ERR_SQLITE_ERROR:0",
      stderr: expect.any(String),
      exitCode: 0,
    });
  });

  test("re-checks the source is open after reading options", () => {
    // sqlite3_backup_init dereferences pSrcDb->mutex with no API-armor
    // guard; a hostile getter that closes the source would hand it a
    // nullptr. Matches the post-option-parse REQUIRE_DB_OPEN on
    // function()/aggregate()/createSession()/applyChangeset()/deserialize().
    using dir = tempDir("node-sqlite-backup-recheck", {});
    const src = new DatabaseSync(":memory:");
    src.exec("CREATE TABLE t (x)");
    expect(() =>
      backup(src, path.join(String(dir), "dst.db"), {
        get rate() {
          src.close();
          return 1;
        },
      }),
    ).toThrow(expect.objectContaining({ code: "ERR_INVALID_STATE", message: "database is not open" }));
    expect(src.isOpen).toBe(false);
  });

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
    // The temporary statement above is not yet GC'd, so sqlite3_close_v2
    // left dst's connection in zombie mode with the file still open. On
    // Windows that blocks tempDir's rm with EBUSY; force the finalizer.
    Bun.gc(true);
  });

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
  });

  test("progress does not fire on the final step (SQLITE_DONE)", async () => {
    // Node fires progress only while sqlite3_backup_remaining() != 0, which
    // is never true on the step that returns SQLITE_DONE. With rate: -1 the
    // whole database copies in one step, so progress never fires at all.
    using dir = tempDir("node-sqlite-backup-done", {});
    const src = new DatabaseSync(":memory:");
    src.exec("CREATE TABLE t (x); INSERT INTO t VALUES (1), (2), (3)");
    let progressCalls = 0;
    const pages = await backup(src, path.join(String(dir), "dst.db"), {
      rate: -1,
      progress: () => progressCalls++,
    });
    expect(typeof pages).toBe("number");
    expect(progressCalls).toBe(0);
    src.close();
  });
});

describe("DatabaseSync.prototype.setAuthorizer()", () => {
  test("callback receives action code + parameters and gates prepare()", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("CREATE TABLE users (id INTEGER, name TEXT)");
    const calls: unknown[][] = [];
    db.setAuthorizer((action, p1, p2, p3, p4) => {
      calls.push([action, p1, p2, p3, p4]);
      return constants.SQLITE_OK;
    });
    db.prepare("SELECT id FROM users").get();
    // One SELECT, one READ(users.id, main). Exact shape is what
    // sqlite hands to the authorizer; Node surfaces it verbatim.
    expect(calls).toEqual([
      [constants.SQLITE_SELECT, null, null, null, null],
      [constants.SQLITE_READ, "users", "id", "main", null],
    ]);

    db.setAuthorizer(() => constants.SQLITE_DENY);
    expect(() => db.prepare("SELECT * FROM users")).toThrow(
      expect.objectContaining({ code: "ERR_SQLITE_ERROR", message: expect.stringMatching(/not authorized/) }),
    );

    db.setAuthorizer(null);
    // Cleared — same prepare now succeeds.
    expect(db.prepare("SELECT * FROM users").all()).toEqual([]);
    expect(() => db.setAuthorizer(42 as any)).toThrow(expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" }));
    db.close();
  });

  test("non-integer return is surfaced as a TypeError, out-of-range as RangeError", () => {
    const db = new DatabaseSync(":memory:");
    db.setAuthorizer(() => "nope" as any);
    expect(() => db.prepare("SELECT 1")).toThrow(TypeError);
    db.setAuthorizer(() => 12345);
    expect(() => db.prepare("SELECT 1")).toThrow(RangeError);
    db.close();
  });
});

describe("db.limits", () => {
  test("named limits read/write through to sqlite3_limit and are enumerable", () => {
    const db = new DatabaseSync(":memory:");
    const original = db.limits.column;
    expect(typeof original).toBe("number");
    expect(original).toBeGreaterThan(0);

    db.limits.column = 10;
    expect(db.limits.column).toBe(10);
    db.exec("CREATE TABLE t1 (a,b,c,d,e,f,g,h,i,j)");
    expect(() => db.exec("CREATE TABLE t2 (a,b,c,d,e,f,g,h,i,j,k)")).toThrow(
      expect.objectContaining({ code: "ERR_SQLITE_ERROR" }),
    );

    db.limits.column = Infinity;
    expect(db.limits.column).toBe(original);
    expect(Object.keys(db.limits)).toContain("sqlLength");
    expect(() => (db.limits.column = -1)).toThrow(RangeError);
    expect(() => (db.limits.column = "no" as any)).toThrow(TypeError);
    db.close();
    expect(() => db.limits.column).toThrow(expect.objectContaining({ code: "ERR_INVALID_STATE" }));
  });

  test("`in`/Reflect.has on a closed database report presence without touching sqlite3_limit", () => {
    // Node's LimitsQuery never checks IsOpen — only LimitsGetter does. A
    // getOwnPropertySlot that throws-and-returns-true also violates JSC's
    // `!scope.exception() || !result` contract (debug ASSERT).
    const db = new DatabaseSync(":memory:");
    const l = db.limits;
    db.close();
    expect("sqlLength" in l).toBe(true);
    expect(Reflect.has(l, "sqlLength")).toBe(true);
    expect("nope" in l).toBe(false);
    expect(() => Object.getOwnPropertyDescriptor(l, "sqlLength")).toThrow(
      expect.objectContaining({ code: "ERR_INVALID_STATE" }),
    );
    expect(() => l.sqlLength).toThrow(expect.objectContaining({ code: "ERR_INVALID_STATE" }));
  });

  test("constructor {limits} option seeds sqlite3_limit on open", () => {
    const db = new DatabaseSync(":memory:", { limits: { variableNumber: 3 } });
    expect(db.limits.variableNumber).toBe(3);
    expect(() => db.prepare("SELECT ?, ?, ?, ?")).toThrow(expect.objectContaining({ code: "ERR_SQLITE_ERROR" }));
    db.close();
    expect(() => new DatabaseSync(":memory:", { limits: { column: -1 } })).toThrow(RangeError);
  });
});

describe("serialize() / deserialize()", () => {
  test("round-trips schema and data, and invalidates prior statements", () => {
    const src = new DatabaseSync(":memory:");
    src.exec("CREATE TABLE t(a INTEGER PRIMARY KEY, b TEXT)");
    src.exec("INSERT INTO t VALUES (1,'hi'),(2,'there')");
    const buf = src.serialize();
    src.close();
    expect(buf).toBeInstanceOf(Uint8Array);
    expect(new TextDecoder().decode(buf.slice(0, 15))).toBe("SQLite format 3");

    const dst = new DatabaseSync(":memory:");
    dst.exec("CREATE TABLE old(x)");
    const stale = dst.prepare("SELECT x FROM old");
    dst.deserialize(buf);
    // deserialize bumps the open-generation so the wrapper reports
    // finalized rather than stepping into a vanished schema. The
    // underlying sqlite3_stmt* is still owned by the wrapper — GC
    // finalizes it, no double-free.
    expect(() => stale.get()).toThrow(/statement has been finalized/);
    expect(dst.prepare("SELECT a, b FROM t ORDER BY a").all()).toEqual([
      { a: 1, b: "hi" },
      { a: 2, b: "there" },
    ]);
    dst.close();
    Bun.gc(true);
  });

  test("succeeds while an iterate() cursor is open (resets outstanding statements like Node)", () => {
    // Node calls FinalizeStatements() before sqlite3_deserialize(), so an
    // un-reset cursor never holds a read transaction through the swap. Bun
    // can't finalize (wrappers own the stmt*) but must reset, otherwise the
    // internal ATTACH returns SQLITE_BUSY and the generation bump leaves
    // every statement dead against the OLD database content.
    const donor = new DatabaseSync(":memory:");
    donor.exec("CREATE TABLE q(z); INSERT INTO q VALUES (9)");
    const img = donor.serialize();
    donor.close();

    const db = new DatabaseSync(":memory:");
    db.exec("CREATE TABLE t(a); INSERT INTO t VALUES (1),(2)");
    const idle = db.prepare("SELECT a FROM t");
    const it = db.prepare("SELECT a FROM t").iterate();
    expect(it.next().value).toEqual({ a: 1 }); // cursor now mid-iteration: open read txn

    db.deserialize(img);

    expect(() => idle.get()).toThrow(expect.objectContaining({ code: "ERR_INVALID_STATE" }));
    expect(db.prepare("SELECT z FROM q").get()).toEqual({ z: 9 });
    expect(() => db.prepare("SELECT count(*) c FROM t").get()).toThrow(/no such table: t/);
    db.close();
  });
});

describe("createTagStore()", () => {
  test("reusing the same SQL while a tag.iterate() iterator is live invalidates the iterator", () => {
    // Deliberate divergence: Node's SQLTagStore resets the cached statement
    // without bumping reset_generation_, so the iterator silently re-yields
    // from row 1 (wrong data) instead of throwing. Bun throws
    // ERR_INVALID_STATE. A tag call with DIFFERENT SQL is a cache miss and
    // leaves the iterator alone.
    const db = new DatabaseSync(":memory:");
    db.exec("CREATE TABLE t (n INTEGER); INSERT INTO t VALUES (1),(2),(3)");
    const sql = db.createTagStore();

    const it = sql.iterate`SELECT n FROM t ORDER BY n`;
    expect(it.next().value).toEqual({ n: 1 });
    expect(sql.get`SELECT n FROM t ORDER BY n`).toEqual({ n: 1 });
    expect(() => it.next()).toThrow(expect.objectContaining({ code: "ERR_INVALID_STATE" }));

    const it2 = sql.iterate`SELECT n FROM t WHERE n > 0 ORDER BY n`;
    expect(it2.next().value).toEqual({ n: 1 });
    sql.get`SELECT n FROM t WHERE n > 1`;
    expect(it2.next().value).toEqual({ n: 2 });
    it2.return();
    db.close();
  });

  test("caches prepared statements by template-literal shape", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)");
    const sql = db.createTagStore(4);
    expect(sql.capacity).toBe(4);
    expect(sql.db).toBe(db);
    expect(sql.size).toBe(0);

    expect(sql.run`INSERT INTO t (v) VALUES (${"a"})`.changes).toBe(1);
    expect(sql.size).toBe(1);
    // Same template, different interpolation → cache hit.
    expect(sql.run`INSERT INTO t (v) VALUES (${"b"})`.changes).toBe(1);
    expect(sql.size).toBe(1);

    expect(sql.get`SELECT v FROM t WHERE id = ${2}`).toEqual({ v: "b" });
    expect(sql.all`SELECT v FROM t ORDER BY id`.map(r => r.v)).toEqual(["a", "b"]);
    expect([...sql.iterate`SELECT v FROM t ORDER BY id`].map(r => r.v)).toEqual(["a", "b"]);

    sql.clear();
    expect(sql.size).toBe(0);
    db.close();
  });

  test("surfaces a thrown authorizer over SQLite's 'not authorized'", () => {
    // SQLTagStore's prepare() runs sqlite3_prepare_v2() which fires the
    // authorizer. If the authorizer throws, the pending JS exception
    // must win over the generic ERR_SQLITE_ERROR — same as
    // DatabaseSync.prototype.prepare()'s CHECK_UDF_EXCEPTION path.
    const db = new DatabaseSync(":memory:");
    db.exec("CREATE TABLE t(x)");
    const sql = db.createTagStore();
    db.setAuthorizer(() => {
      throw new TypeError("nope from authorizer");
    });
    expect(() => sql.get`SELECT x FROM t`).toThrow(
      expect.objectContaining({
        name: "TypeError",
        message: "nope from authorizer",
      }),
    );
    db.setAuthorizer(null);
    db.close();
  });

  test("re-entering a cached tag from its own UDF throws instead of segfaulting", () => {
    // TagStore::prepare's isStepping() guard — sibling of the StatementSync
    // guard covered above; without it a UDF re-entering the same cached
    // statement is a mid-VDBE reset segfault.
    const db = new DatabaseSync(":memory:");
    const sql = db.createTagStore();
    db.function("reenterTag", () => {
      try {
        sql.get`SELECT reenterTag() AS r`;
        return "ran";
      } catch (e: any) {
        return e.code;
      }
    });
    expect(sql.get`SELECT reenterTag() AS r`).toEqual({ __proto__: null, r: "ERR_INVALID_STATE" });
    db.close();
  });

  test("cached tags survive close()/open() and deserialize() via the isFinalized() eviction", () => {
    // TagStore caches JSStatementSync wrappers keyed by template shape.
    // close()/open() and deserialize() bump the connection's open-generation,
    // which flips isFinalized() on every cached wrapper; TagStore::prepare
    // must evict the stale entry and re-prepare on the new connection.
    const db = new DatabaseSync(":memory:");
    const sql = db.createTagStore();
    expect(sql.get`SELECT 1 AS v`.v).toBe(1);
    expect(sql.size).toBe(1);
    db.close();
    db.open();
    expect(sql.get`SELECT 1 AS v`.v).toBe(1);
    expect(sql.size).toBe(1);
    // deserialize() bumps the generation without a close()/open() cycle.
    db.exec("CREATE TABLE t (x INTEGER)");
    db.exec("INSERT INTO t VALUES (7)");
    expect(sql.get`SELECT x FROM t`.x).toBe(7);
    const buf = db.serialize();
    db.deserialize(buf);
    expect(sql.get`SELECT x FROM t`.x).toBe(7);
    db.close();
  });
});

test.skipIf(!sqliteHasSession)("deserialize() frees open sessions instead of orphaning their preupdate hook", () => {
  // deserialize() bumps the open-generation to invalidate existing
  // wrappers. Sessions become stale — but deleteSession() (and the
  // destructor) assume "stale ⇒ closeInternal() already freed", so
  // they skip sqlite3session_delete. That's only true for close()+
  // open(); deserialize() must free the tracked handles itself or
  // the preupdate hook stays live on the unchanged sqlite3* and
  // keeps recording writes into an unreachable change buffer.
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY)");
  const session = db.createSession();
  const buf = db.serialize();
  db.deserialize(buf);
  // Wrapper reports closed — the handle was freed above, not leaked.
  expect(() => session.changeset()).toThrow(expect.objectContaining({ code: "ERR_INVALID_STATE" }));
  // Symbol.dispose on a stale session is a silent no-op (no
  // double-free of the already-deleted handle).
  expect(() => session[Symbol.dispose]()).not.toThrow();
  // DB is still usable and a fresh session works.
  expect(db.isOpen).toBe(true);
  db.exec("INSERT INTO t VALUES (1)");
  const fresh = db.createSession();
  db.exec("INSERT INTO t VALUES (2)");
  expect(fresh.changeset().length).toBeGreaterThan(0);
  fresh.close();
  db.close();
  Bun.gc(true);
});

describe("enableDefensive()", () => {
  test("defaults on; {defensive:false} and enableDefensive() toggle it", () => {
    // Defensive mode blocks PRAGMA journal_mode=OFF (among other
    // things). That's the observable Node's own test uses.
    const pragma = (db: any) => db.prepare("PRAGMA journal_mode").get().journal_mode;
    const on = new DatabaseSync(":memory:");
    expect(pragma(on)).toBe("memory");
    on.exec("PRAGMA journal_mode=OFF");
    expect(pragma(on)).toBe("memory"); // unchanged → defensive on
    on.close();

    const off = new DatabaseSync(":memory:", { defensive: false });
    off.exec("PRAGMA journal_mode=OFF");
    expect(pragma(off)).toBe("off");
    off.enableDefensive(true);
    // Can't reopen journal mode once off, so just check the call
    // reaches sqlite without throwing.
    off.enableDefensive(false);
    off.close();
    expect(() => new DatabaseSync(":memory:").enableDefensive("nope" as any)).toThrow(
      expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" }),
    );
  });
});

describe("row-shape structure caching", () => {
  test("all() results share a null-prototype structure and handle duplicate columns", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("CREATE TABLE t (a INTEGER, b TEXT)");
    for (let i = 0; i < 5; i++) db.prepare("INSERT INTO t VALUES (?,?)").run(i, `v${i}`);
    const stmt = db.prepare("SELECT a, b FROM t ORDER BY a");
    const rows = stmt.all();
    expect(rows).toHaveLength(5);
    for (const r of rows) {
      expect(Object.getPrototypeOf(r)).toBe(null);
      expect(Object.keys(r)).toEqual(["a", "b"]);
    }
    expect(rows[0]).toEqual({ a: 0, b: "v0" });
    expect(rows[4]).toEqual({ a: 4, b: "v4" });
    // Duplicate-name column collapses to a single property with
    // *last*-wins semantics — Node's row builder iterates columns and
    // calls V8 Object::Set()/CreateDataProperty() each time, which
    // overwrites on a repeat key. The cached-offset path must agree
    // with the generic putDirect() fallback, so both yield {x: 2}.
    const dup = db.prepare("SELECT 1 AS x, 2 AS x").get();
    expect(Object.keys(dup)).toEqual(["x"]);
    expect(dup.x).toBe(2);
    db.close();
  });

  test("picks up column renames across ALTER TABLE (structure rebuilt per reset)", () => {
    // sqlite3_prepare_v2 transparently re-prepares on SQLITE_SCHEMA,
    // so after ALTER TABLE … RENAME COLUMN the same `SELECT *`
    // statement returns the SAME column count with DIFFERENT names.
    // Keying the row-structure cache on count alone would serve the
    // stale names forever; it must be rebuilt on each reset.
    const db = new DatabaseSync(":memory:");
    db.exec("CREATE TABLE t (a INTEGER, b INTEGER); INSERT INTO t VALUES (1, 2)");
    const stmt = db.prepare("SELECT * FROM t");
    expect(stmt.get()).toEqual({ a: 1, b: 2 });
    db.exec("ALTER TABLE t RENAME COLUMN a TO x");
    expect(stmt.get()).toEqual({ x: 1, b: 2 });
    db.close();
  });

  test("all() reads the column count after step() re-prepares the statement", () => {
    // The count variant of the rename case: DROP COLUMN between
    // prepare() and .all() makes the first sqlite3_step()
    // transparently re-prepare `SELECT *` with *fewer* columns.
    // A pre-step column_count() would be stale; ensureRowStructure()
    // rebuilds m_columnOffsets with the fresh (smaller) count, so
    // looping to the stale count would index that Vector OOB and
    // putDirectOffset() into a bogus slot. all() must read the
    // count per row, same as get() / iterate().
    const db = new DatabaseSync(":memory:");
    db.exec("CREATE TABLE t (a, b, c); INSERT INTO t VALUES (1,2,3),(4,5,6)");
    const stmt = db.prepare("SELECT * FROM t ORDER BY a");
    db.exec("ALTER TABLE t DROP COLUMN c");
    expect(stmt.all()).toEqual([
      { a: 1, b: 2 },
      { a: 4, b: 5 },
    ]);
    // Growing the count between calls must also work.
    db.exec("ALTER TABLE t ADD COLUMN d INTEGER DEFAULT 9");
    expect(stmt.all()).toEqual([
      { a: 1, b: 2, d: 9 },
      { a: 4, b: 5, d: 9 },
    ]);
    db.close();
  });

  test("index-string column names go through indexed storage", () => {
    // `SELECT 1 AS "0"` produces a column whose name is a canonical
    // array-index string. Structure::addPropertyTransition and
    // putDirect both assert !parseIndex(), so the fast path must
    // bail and the fallback must use putDirectMayBeIndex().
    const db = new DatabaseSync(":memory:");
    const row = db.prepare('SELECT 7 AS "0", 8 AS one').get();
    expect(row["0"]).toBe(7);
    expect(row[0]).toBe(7);
    expect(row.one).toBe(8);
    expect(Object.getPrototypeOf(row)).toBe(null);
    db.close();
  });
});

test("SQLTagStore binds via the same JS→SQLite bridge as StatementSync", () => {
  // The tag store previously hand-rolled its own bind logic and
  // drifted: it accepted undefined and silently wrapped oversized
  // BigInts (2n**64n → 0) where stmt.run(...) throws. Both paths now
  // share JSStatementSync::bindValue().
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE t(n INTEGER)");
  const sql = db.createTagStore();
  expect(() => sql.run`INSERT INTO t VALUES (${2n ** 64n})`).toThrow(
    expect.objectContaining({ code: "ERR_INVALID_ARG_VALUE" }),
  );
  expect(() => sql.run`INSERT INTO t VALUES (${undefined as any})`).toThrow(
    expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" }),
  );
  expect(db.prepare("SELECT COUNT(*) AS c FROM t").get().c).toBe(0);
  db.close();
});

test("authorizer constants are exposed on constants", () => {
  expect(constants.SQLITE_OK).toBe(0);
  expect(constants.SQLITE_DENY).toBe(1);
  expect(constants.SQLITE_IGNORE).toBe(2);
  expect(typeof constants.SQLITE_SELECT).toBe("number");
  expect(typeof constants.SQLITE_CREATE_TABLE).toBe("number");
});

test("Symbol.for('sqlite-type') identifies a node:sqlite DatabaseSync", () => {
  const db = new DatabaseSync(":memory:");
  expect(db[Symbol.for("sqlite-type")]).toBe("node:sqlite");
  db.close();
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
  // Don't assert stderr is exactly empty: ASAN/debug builds emit benign
  // teardown noise. The invariant is no ASAN report and a clean exit.
  expect(stderr).not.toContain("heap-use-after-free");
  expect(stdout).toBe("");
  expect(exitCode).toBe(0);
});

// process.exit() inside a UDF reaches ~JSDatabaseSync with a BusyScope still
// on the stack; that path must still flag its session records as dbGone or
// ~JSNodeSqliteSession writes to the already-swept database cell.
test.skipIf(!sqliteHasSession)(
  "teardown with a busy connection and an unclosed session does not use-after-free",
  async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const { DatabaseSync } = require('node:sqlite');
       const db = new DatabaseSync(':memory:');
       db.exec('CREATE TABLE t(x INTEGER PRIMARY KEY)');
       db.createSession();
       db.function('die', () => process.exit(0));
       db.exec('SELECT die()');`,
      ],
      env: { ...bunEnv, BUN_DESTRUCT_VM_ON_EXIT: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).not.toContain("heap-use-after-free");
    expect(stdout).toBe("");
    expect(exitCode).toBe(0);
  },
);

// Sibling of the above for ~JSStatementSync: process.exit() inside an
// aggregate step reaches the destructor with a SteppingScope on the stack;
// sqlite3_finalize on the running VDBE would fire xFinal into the swept heap.
test("teardown with a stepping statement and a running aggregate does not use-after-free", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const { DatabaseSync } = require('node:sqlite');
       const db = new DatabaseSync(':memory:');
       db.exec('CREATE TABLE t(x); INSERT INTO t VALUES (1),(2)');
       db.aggregate('agg', {
         start: 0,
         step: (acc, x) => { if (x === 2) process.exit(0); return acc + x; },
         result: acc => acc,
       });
       db.prepare('SELECT agg(x) FROM t').get();`,
    ],
    env: { ...bunEnv, BUN_DESTRUCT_VM_ON_EXIT: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).not.toContain("heap-use-after-free");
  expect(stdout).toBe("");
  expect(exitCode).toBe(0);
});

// The process-exit handler must close (or at least WAL-checkpoint) unclosed
// file-backed databases the way Node and bun:sqlite do; see
// Bun__closeAllNodeSqliteDatabasesForTermination in NodeSqlite.cpp.
test("unclosed file-backed database is closed on process exit (no WAL sidecars left)", async () => {
  using dir = tempDir("node-sqlite-exit-close", {});
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      // The printed existsSync proves the -wal the parent asserts on really
      // existed while the never-closed connection was still open.
      `const { DatabaseSync } = require('node:sqlite');
       const db = new DatabaseSync('exit.db');
       db.exec('PRAGMA journal_mode = WAL');
       db.exec('CREATE TABLE t (x INTEGER)');
       db.exec('INSERT INTO t VALUES (42)');
       console.log(require('node:fs').existsSync('exit.db-wal'));
       // intentionally not closed`,
    ],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  // stderr is drained but not asserted: ASAN/debug builds emit benign noise.
  const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stdout).toBe("true\n");
  // The exit handler ran sqlite3_close_v2(): the last WAL connection
  // checkpoints and unlinks both sidecars on its way out.
  expect(existsSync(path.join(String(dir), "exit.db-wal"))).toBe(false);
  expect(existsSync(path.join(String(dir), "exit.db-shm"))).toBe(false);
  // And the checkpoint persisted the row into the main database file.
  using verify = new DatabaseSync(path.join(String(dir), "exit.db"));
  expect(verify.prepare("SELECT x FROM t").get()).toEqual({ x: 42 });
  expect(exitCode).toBe(0);
  // The temporary statement above is not yet GC'd, so sqlite3_close_v2
  // left verify's connection in zombie mode with exit.db still open. On
  // Windows that blocks tempDir's rm with EBUSY; force the finalizer.
  Bun.gc(true);
});

// A statement that is never finalized makes sqlite3_close_v2 defer the real
// close, so the exit handler checkpoints the WAL explicitly: the data must be
// in the main database file even though the (now empty) sidecars remain.
test("exit-time WAL checkpoint runs even with a never-finalized prepared statement", async () => {
  using dir = tempDir("node-sqlite-exit-zombie", {});
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      // The printed size proves the WAL really held un-checkpointed frames
      // while the statement (and connection) were still alive.
      `const { DatabaseSync } = require('node:sqlite');
       const db = new DatabaseSync('exit.db');
       db.exec('PRAGMA journal_mode = WAL');
       db.exec('CREATE TABLE t (x INTEGER)');
       const stmt = db.prepare('INSERT INTO t VALUES (?)');
       stmt.run(42);
       // stmt stays referenced and is never finalized; db is never closed.
       console.log(require('node:fs').statSync('exit.db-wal').size > 0);`,
    ],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stdout).toBe("true\n");
  // SQLITE_CHECKPOINT_TRUNCATE moved every frame into exit.db. The empty
  // -wal file outlives the zombified connection today, but the invariant is
  // only that no un-checkpointed data is stranded in one.
  const wal = path.join(String(dir), "exit.db-wal");
  expect(existsSync(wal) ? statSync(wal).size : 0).toBe(0);
  using verify = new DatabaseSync(path.join(String(dir), "exit.db"));
  expect(verify.prepare("SELECT x FROM t").get()).toEqual({ x: 42 });
  expect(exitCode).toBe(0);
  // The temporary statement above is not yet GC'd, so sqlite3_close_v2
  // left verify's connection in zombie mode with exit.db still open. On
  // Windows that blocks tempDir's rm with EBUSY; force the finalizer.
  Bun.gc(true);
});

describe("GC lifetime", () => {
  test("function()/aggregate() callbacks that capture the database do not pin it forever", () => {
    // The registered callbacks are rooted on the DatabaseSync cell (not by a
    // C-side Strong<>), so a db → closure → db cycle must stay collectable
    // even when the database is never close()d.
    const countCells = () => {
      Bun.gc(true);
      return heapStats().objectTypeCounts.DatabaseSync ?? 0;
    };
    const before = countCells();
    for (let i = 0; i < 50; i++) {
      const db = new DatabaseSync(":memory:");
      db.exec("CREATE TABLE t (x INTEGER)");
      db.exec("INSERT INTO t VALUES (1), (2)");
      db.function("lookup", id => db.prepare("SELECT 1 AS v").get()!.v + id);
      db.aggregate("agg", { start: 0, step: (acc, x) => acc + (db ? x : 0) });
      expect(db.prepare("SELECT lookup(1) AS v").get()!.v).toBe(2);
      expect(db.prepare("SELECT agg(x) AS v FROM t").get()!.v).toBe(3);
    }
    // GC a few times; conservative stack scanning may keep a couple of
    // stragglers alive, but with the cycle bug all 50 survive.
    let delta = Infinity;
    for (let i = 0; i < 10 && delta > 10; i++) {
      delta = countCells() - before;
    }
    expect(delta).toBeLessThanOrEqual(10);
  });

  test("re-registering a function/aggregate name replaces the previous registration", () => {
    // Each re-registration releases the superseded callback's roots at the
    // registration site (releaseSupersededRegistration) and reuses the slots;
    // the latest callback is the one SQLite invokes.
    const db = new DatabaseSync(":memory:");
    db.exec("CREATE TABLE t (x INTEGER)");
    db.exec("INSERT INTO t VALUES (1), (2)");
    for (let i = 0; i < 500; i++) {
      db.function("f", () => i);
      db.aggregate("agg", { start: 0, step: (acc, _x) => acc + i });
    }
    expect(db.prepare("SELECT f() AS v").get()!.v).toBe(499);
    expect(db.prepare("SELECT agg(x) AS v FROM t").get()!.v).toBe(998);
    // SQLite function names are case-insensitive, so a differently-cased
    // re-registration replaces the same function.
    db.function("Mixed", () => "old");
    db.function("MIXED", () => "new");
    expect(db.prepare("SELECT mixed() AS v").get()!.v).toBe("new");
    db.close();
  });

  test("deferred function teardown on a zombified connection cannot unroot later registrations", () => {
    // Closing with an unfinalized statement zombifies the connection, so the
    // old registration's xDestroy only runs when the statement is finalized
    // by GC — possibly after the database was reopened and new callbacks
    // were registered. That deferred teardown must not touch the cell.
    const db = new DatabaseSync(":memory:");
    db.function("f", () => 1);
    let stmt: InstanceType<typeof StatementSync> | null = db.prepare("SELECT 1 AS v");
    expect(stmt.get()!.v).toBe(1);
    db.close(); // zombie: stmt is still unfinalized
    db.open();
    db.function("g", () => 42);
    stmt = null;
    Bun.gc(true); // finalizes the old statement → deferred xDestroy of "f"
    expect(db.prepare("SELECT g() AS v").get()!.v).toBe(42);
    db.close();
  });

  test.skipIf(!sqliteHasSession)(
    "sessions dropped without close() are reclaimed once the database is used again",
    () => {
      const db = new DatabaseSync(":memory:");
      db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)");
      for (let i = 0; i < 100; i++) {
        db.createSession();
      }
      Bun.gc(true);
      // The next entry point sweeps the orphaned native sessions; the
      // connection keeps working and a fresh session records normally.
      db.exec("INSERT INTO t VALUES (1, 'x')");
      const fresh = db.createSession();
      db.exec("INSERT INTO t VALUES (2, 'y')");
      expect(fresh.changeset().length).toBeGreaterThan(0);
      fresh.close();
      db.close();
    },
  );

  test.skipIf(!sqliteHasSession)("a failed deserialize() leaves existing sessions and the database untouched", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)");
    const session = db.createSession();
    const stmt = db.prepare("SELECT COUNT(*) AS n FROM t");
    db.exec("INSERT INTO t VALUES (1, 'a')");

    const other = new DatabaseSync(":memory:");
    other.exec("CREATE TABLE o (x INTEGER)");
    const buf = other.serialize();
    other.close();

    // Targeting a schema that doesn't exist fails inside sqlite3_deserialize()
    // before anything about the connection changes.
    expect(() => db.deserialize(buf, { dbName: "nosuchschema" })).toThrow(
      expect.objectContaining({ code: "ERR_SQLITE_ERROR" }),
    );

    // Statements are finalized even on the failure path (Node finalizes its
    // statements before deserializing), but the session keeps its recorded
    // history because the connection was never touched.
    expect(() => stmt.get()).toThrow(expect.objectContaining({ code: "ERR_INVALID_STATE" }));
    expect(session.changeset().length).toBeGreaterThan(0);
    expect(db.prepare("SELECT COUNT(*) AS n FROM t").get()!.n).toBe(1);
    session.close();
    db.close();
  });
});

describe("module exports", () => {
  test("Session is exported and instanceof works; SQLTagStore is not exported", () => {
    expect(typeof Session).toBe("function");
    expect(() => new Session()).toThrow(expect.objectContaining({ code: "ERR_ILLEGAL_CONSTRUCTOR" }));
    // SQLTagStore is Bun-internal (createTagStore()) — not a Node export.
    expect(Object.keys(require("node:sqlite")).sort()).toEqual([
      "DatabaseSync",
      "Session",
      "StatementSync",
      "backup",
      "constants",
    ]);
    const db = new DatabaseSync(":memory:");
    db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY)");
    if (sqliteHasSession) expect(db.createSession()).toBeInstanceOf(Session);
    expect(db.createTagStore().constructor.name).toBe("SQLTagStore");
    db.close();
  });

  test("named ESM import of Session links (spawned subprocess)", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", `import { Session } from "node:sqlite"; console.log(typeof Session);`],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, exitCode }).toEqual({ stdout: "function\n", exitCode: 0 });
    void stderr;
  });
});

describe("loadExtension() / enableLoadExtension()", () => {
  test.skipIf(sqliteHasLoadExtension)(
    "{allowExtension: true} throws with a setCustomSQLite hint when the library was built with OMIT_LOAD_EXTENSION",
    () => {
      expect(() => new DatabaseSync(":memory:", { allowExtension: true })).toThrow(
        expect.objectContaining({
          code: "ERR_LOAD_SQLITE_EXTENSION",
          message: expect.stringMatching(/SQLITE_OMIT_LOAD_EXTENSION/),
        }),
      );
    },
  );

  test("loadExtension() on {allowExtension: false} throws ERR_INVALID_STATE", () => {
    const db = new DatabaseSync(":memory:");
    expect(() => db.loadExtension("/nonexistent")).toThrow(
      expect.objectContaining({
        code: "ERR_INVALID_STATE",
        message: expect.stringMatching(/extension loading is not allowed/),
      }),
    );
    db.close();
  });

  test("enableLoadExtension(true) on {allowExtension: false} throws Node's exact message", () => {
    const db = new DatabaseSync(":memory:");
    expect(() => db.enableLoadExtension(true)).toThrow(
      expect.objectContaining({
        code: "ERR_INVALID_STATE",
        message: expect.stringMatching(/Cannot enable extension loading because it was disabled at database creation/),
      }),
    );
    // enableLoadExtension(false) is always permitted.
    expect(() => db.enableLoadExtension(false)).not.toThrow();
    db.close();
  });

  test.skipIf(!sqliteHasLoadExtension)("enableLoadExtension() with no argument throws ERR_INVALID_ARG_TYPE", () => {
    const db = new DatabaseSync(":memory:", { allowExtension: true });
    expect(() => db.enableLoadExtension()).toThrow(expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" }));
    db.close();
  });

  test.skipIf(!sqliteHasLoadExtension)("loadExtension() after enableLoadExtension(false) throws", () => {
    const db = new DatabaseSync(":memory:", { allowExtension: true });
    db.enableLoadExtension(false);
    expect(() => db.loadExtension("/nonexistent")).toThrow(expect.objectContaining({ code: "ERR_INVALID_STATE" }));
    db.close();
  });

  test.skipIf(!sqliteHasLoadExtension)("loadExtension() on a nonexistent path throws ERR_LOAD_SQLITE_EXTENSION", () => {
    // Exercises the sqlite3_free(errmsg) path.
    const db = new DatabaseSync(":memory:", { allowExtension: true });
    db.enableLoadExtension(true);
    expect(() => db.loadExtension("/bun-nonexistent-extension-path")).toThrow(
      expect.objectContaining({ code: "ERR_LOAD_SQLITE_EXTENSION" }),
    );
    db.close();
  });
});

// bun:sqlite and node:sqlite share ONE sqlite3 library (dlopen'd on macOS,
// linked on Linux/Windows) — two libraries in one process is a POSIX-lock
// corruption vector (howtocorrupt.html §2.2.1). Assert both modules report
// the same sqlite_version() and that closing one module's handle does not
// drop the other's fcntl locks.
test("bun:sqlite and node:sqlite share one SQLite library", async () => {
  using dir = tempDir("node-sqlite-cross-module", {});
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const { Database } = require('bun:sqlite');
       const { DatabaseSync } = require('node:sqlite');
       const bunDb = new Database('shared.db');
       bunDb.exec('PRAGMA journal_mode = WAL');
       bunDb.exec('CREATE TABLE t (x INTEGER)');
       bunDb.exec('INSERT INTO t VALUES (1)');
       const nodeDb = new DatabaseSync('shared.db');
       const bv = bunDb.query('SELECT sqlite_version() v').get().v;
       const nv = nodeDb.prepare('SELECT sqlite_version() v').get().v;
       console.log('same=' + (bv === nv && bv === process.versions.sqlite));
       // node:sqlite sees bun:sqlite's committed row.
       console.log('n1=' + nodeDb.prepare('SELECT x FROM t').get().x);
       // Write via node:sqlite; bun:sqlite sees it.
       nodeDb.exec('INSERT INTO t VALUES (2)');
       console.log('b1=' + bunDb.query('SELECT COUNT(*) c FROM t').get().c);
       // Closing the bun:sqlite handle must not drop the process's fcntl locks
       // out from under node:sqlite (the two-library corruption vector).
       bunDb.close();
       nodeDb.exec('INSERT INTO t VALUES (3)');
       console.log('ok=' + nodeDb.prepare('PRAGMA integrity_check').get().integrity_check);
       nodeDb.close();`,
    ],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stdout).toBe("same=true\nn1=1\nb1=2\nok=ok\n");
  void stderr;
  expect(exitCode).toBe(0);
});

// The reverse ordering of the test above: node:sqlite opening FIRST used to
// leave sqlite3 initialized before bun:sqlite's sqlite3_config() calls ran,
// which is SQLITE_MISUSE (a hard debug assertion). See Bun__initializeSQLite.
test("bun:sqlite still initializes correctly when node:sqlite opens a database first", async () => {
  using dir = tempDir("node-sqlite-init-order", {});
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const { DatabaseSync } = require('node:sqlite');
       const nodeDb = new DatabaseSync('order.db');
       nodeDb.exec('CREATE TABLE t (x INTEGER)');
       nodeDb.exec('INSERT INTO t VALUES (1)');
       const { Database } = require('bun:sqlite');
       const bunDb = new Database('order.db');
       bunDb.run('INSERT INTO t VALUES (2)');
       console.log('n=' + nodeDb.prepare('SELECT COUNT(*) c FROM t').get().c);
       bunDb.close();
       nodeDb.close();`,
    ],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  // stderr is drained but not pinned: ASAN/debug builds emit benign noise.
  expect({ stdout, exitCode }).toEqual({ stdout: "n=2\n", exitCode: 0 });
  void stderr;
});

// Worker-owned databases are closed via ~VM → lastChanceToFinalize →
// ~JSDatabaseSync — a completely different path than the main-thread exit
// sweep. Sibling of "unclosed file-backed database is closed on process exit".
test("worker-owned unclosed database is checkpointed on worker exit", async () => {
  using dir = tempDir("node-sqlite-worker-exit", {
    "worker.mjs": `import { DatabaseSync } from 'node:sqlite';
      const db = new DatabaseSync('exit.db');
      db.exec('PRAGMA journal_mode = WAL');
      db.exec('CREATE TABLE t (x INTEGER)');
      const stmt = db.prepare('INSERT INTO t VALUES (?)');
      stmt.run(99);
      // stmt and db intentionally not closed; worker exits naturally.
      postMessage('done');`,
    "main.mjs": `import { Worker } from 'node:worker_threads';
      import { existsSync, statSync } from 'node:fs';
      const w = new Worker('./worker.mjs');
      await new Promise((res, rej) => {
        w.on('message', () => {}); // drain
        w.on('error', rej);
        w.on('exit', code => (code === 0 ? res() : rej(new Error('exit ' + code))));
      });
      // ~JSDatabaseSync on lastChanceToFinalize checkpointed: the -wal is
      // gone or empty. Checked before the reopen below touches the sidecars.
      console.log(existsSync('exit.db-wal') ? statSync('exit.db-wal').size : 0);
      const { DatabaseSync } = await import('node:sqlite');
      const db = new DatabaseSync('exit.db');
      console.log(db.prepare('SELECT x FROM t').get().x);
      db.close();`,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "main.mjs"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stdout).toBe("0\n99\n");
  void stderr;
  expect(exitCode).toBe(0);
});

describe("GC stress", () => {
  // Interleave Bun.gc(true) with the mutations that race visitChildren, so
  // a marker-vs-mutator lock miss is loud under ASAN rather than flaky.
  // Debug+ASAN builds run 10-100x slower — sized for that budget.
  test("re-registering db.function() while GC runs concurrently", () => {
    const db = new DatabaseSync(":memory:");
    db.function("f", () => -1);
    const stmt = db.prepare("SELECT f() AS v");
    for (let i = 0; i < 500; i++) {
      db.function("f", () => i);
      Bun.gc(true);
      expect(stmt.get().v).toBe(i);
    }
    db.close();
  }, 30_000);

  test("TagStore LRU churn under GC pressure", () => {
    const db = new DatabaseSync(":memory:");
    const sql = db.createTagStore(4);
    for (let i = 0; i < 500; i++) {
      // Rotate the SQL text so the LRU inserts/evicts every iteration.
      const j = i % 8;
      const v = sql.get(["SELECT ", ` + ${j} AS v`], i).v;
      Bun.gc(true);
      expect(v).toBe(i + j);
    }
    db.close();
  }, 30_000);

  test("aggregate step callback triggering GC between rows", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("CREATE TABLE t (x INTEGER)");
    db.exec(`WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM c LIMIT 100) INSERT INTO t SELECT x FROM c`);
    db.aggregate("gcsum", {
      start: 0,
      step: (acc, x) => {
        Bun.gc(true);
        return acc + x;
      },
    });
    // The Strong<> in sqlite3_aggregate_context must survive GC between xStep calls.
    expect(db.prepare("SELECT gcsum(x) AS s FROM t").get().s).toBe(5050);
    db.close();
  });

  test.skipIf(!sqliteHasSession)(
    "session churn under GC pressure (finalizer ordering)",
    () => {
      const db = new DatabaseSync(":memory:");
      db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY)");
      for (let i = 0; i < 500; i++) {
        const s = db.createSession();
        Bun.gc(true);
        s.changeset();
        // Half explicitly close, half drop — races wrapperGone/dbGone.
        if (i & 1) s.close();
      }
      db.close();
    },
    30_000,
  );
});

// bun:sqlite's setCustomSQLite() and node:sqlite share a single process-global
// dlopen handle (lazy_sqlite3.h uses `inline` state, not `static`). Assert the
// sharing via the "already loaded" guard in reverse: opening a node:sqlite
// database populates the handle, so a subsequent setCustomSQLite() must
// refuse. If `inline` regresses to `static` the two TUs get separate handles,
// setCustomSQLite() succeeds, and this test fails.
test.skipIf(process.platform !== "darwin")("setCustomSQLite() sees a library node:sqlite already loaded", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `new (require("node:sqlite").DatabaseSync)(":memory:").close();
         let threw;
         try {
           require("bun:sqlite").Database.setCustomSQLite("/usr/lib/libsqlite3.dylib");
         } catch (e) { threw = e.message; }
         if (!/already loaded/.test(String(threw))) throw new Error("expected already-loaded, got: " + threw);
         // Reverse ordering — the doc'd remedy: setCustomSQLite BEFORE the
         // first open governs node:sqlite too.
         console.log("shared");`,
    ],
    env: bunEnv,
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout: stdout.trim(), exitCode }).toEqual({ stdout: "shared", exitCode: 0 });
  void stderr;
});

// process.versions.sqlite must not force-dlopen the system SQLite: that
// would defeat setCustomSQLite() for anyone whose imports read
// process.versions before opening a database.
test.skipIf(process.platform !== "darwin")("reading process.versions does not defeat setCustomSQLite", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const _ = process.versions.sqlite;
      const { Database } = require("bun:sqlite");
      Database.setCustomSQLite("/usr/lib/libsqlite3.dylib");
      console.log("ok");
    `,
    ],
    env: bunEnv,
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).not.toContain("already loaded");
  expect(stdout.trim()).toBe("ok");
  expect(exitCode).toBe(0);
});
