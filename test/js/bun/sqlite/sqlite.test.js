import { spawnSync } from "bun";
import * as internalForTesting from "bun:internal-for-testing";
import { heapStats } from "bun:jsc";
import { constants, Database, SQLiteError } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { existsSync, readdirSync, readFileSync, readlinkSync, realpathSync, rmSync, statSync, writeFileSync } from "fs";
import {
  bunEnv,
  bunExe,
  expectRssDeltaBelow,
  isASAN,
  isDebug,
  isLinux,
  isMacOS,
  isMacOSVersionAtLeast,
  isWindows,
  tempDir,
} from "harness";
import { tmpdir } from "os";
import path from "path";
import vm from "vm";
import { Worker } from "worker_threads";

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

  describe.each([false, true])("safeIntegers: %p and a BigInt parameter", safeIntegers => {
    // CAST(... AS TEXT) reads the value back without the precision loss of a number.
    const stored = {
      "Statement#get": (db, value) => db.query("SELECT CAST(? AS TEXT) AS t").get(value).t,
      "Database#prepare": (db, value) => db.prepare("SELECT CAST(? AS TEXT) AS t", [value]).get().t,
      "Database#run": (db, value) => {
        db.run("CREATE TABLE t (a)");
        db.run("INSERT INTO t VALUES (?)", [value]);
        return db.query("SELECT CAST(a AS TEXT) AS t FROM t").get().t;
      },
    };

    it.each(Object.keys(stored))("%s: in the signed 64-bit range it is stored as it is", how => {
      for (const value of [0n, 2n ** 62n, 2n ** 63n - 1n, -(2n ** 63n)]) {
        using db = new Database(":memory:", { safeIntegers });
        expect(stored[how](db, value)).toBe(String(value));
      }
    });

    // Bun.hash() returns an unsigned 64-bit integer.
    const hash = Bun.hash("b");
    const outside = [hash, 2n ** 63n, 2n ** 64n - 1n, -(2n ** 63n) - 1n, 2n ** 64n + 5n, -(2n ** 64n) - 5n];

    it.each(Object.keys(stored))(
      safeIntegers ? "%s: outside of it, it is a RangeError" : "%s: outside of it, it keeps its low 64 bits",
      how => {
        expect(hash).toBeGreaterThanOrEqual(2n ** 63n);
        for (const value of outside) {
          using db = new Database(":memory:", { safeIntegers });
          if (safeIntegers) {
            expect(() => stored[how](db, value)).toThrow(new RangeError(`BigInt value '${value}' is out of range`));
          } else {
            expect(stored[how](db, value)).toBe(String(BigInt.asIntN(64, value)));
          }
        }
      },
    );
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

        it("gap in ?N numbering reports the missing parameter instead of crashing", () => {
          const db = Database.open(":memory:", { strict: true });

          // "select ?2" makes sqlite implicitly allocate parameter 1, which has no name.
          expect(() => db.query("select ?2 as x").all({})).toThrow('Missing parameter "?1"');
          expect(() => db.query("select ?2 as x").all({ 1: "a", 2: "b" })).toThrow('Missing parameter "?1"');
          expect(() => db.query("select ?1, ?3 as x").all({ 0: "a" })).toThrow('Missing parameter "?2"');
          expect(db.query("select ?2 as x").all({ 0: "a", 1: "b" })).toEqual([{ x: "b" }]);
        });
      }
    });
  }
}

describe("bind parameters object mutated by a getter during bind", () => {
  // A getter that runs while binding can add/delete properties, changing the
  // object's layout mid-bind. Lookups for later parameters must see the
  // current layout; reading through the old one binds whatever property now
  // occupies the stale slot, or crashes on an empty slot.

  it("strict mode: throws missing parameter instead of binding a foreign value", () => {
    const db = new Database(":memory:", { strict: true });
    const q = db.query("select ?1 as a, $b as b, $c as c");
    const t = {};
    t[0] = "i";
    Object.defineProperty(t, "b", {
      enumerable: true,
      get() {
        delete t.c;
        t.secret = "SECRET-NOT-A-PARAM";
        return "two";
      },
    });
    t.c = "three";
    expect(() => q.all(t)).toThrow('Missing parameter "$c"');
  });

  it("strict mode: binds the value the parameter holds at bind time", () => {
    const db = new Database(":memory:", { strict: true });
    const q = db.query("select ?1 as a, $b as b, $c as c");
    const t = {};
    t[0] = "i";
    Object.defineProperty(t, "b", {
      enumerable: true,
      get() {
        delete t.c;
        t.filler = "FILLER";
        t.c = "three-new";
        return "two";
      },
    });
    t.c = "three-old";
    expect(q.all(t)).toEqual([{ a: "i", b: "two", c: "three-new" }]);
  });

  it("strict mode: positional + named, index getter deletes a later parameter", () => {
    const db = new Database(":memory:", { strict: true });
    const q = db.query("select ? as a, $c as c");
    const u = { c: "three" };
    Object.defineProperty(u, 0, {
      enumerable: true,
      get() {
        delete u.c;
        u.secret = "SECRET-NOT-A-PARAM";
        return 0;
      },
    });
    expect(() => q.all(u)).toThrow('Missing parameter "c"');
  });

  it("default mode: treats a parameter deleted by an index getter as missing", () => {
    const db = new Database(":memory:");
    const q = db.query("select ? as a, $c as c");
    const u = { $c: "three" };
    Object.defineProperty(u, 0, {
      enumerable: true,
      get() {
        delete u.$c;
        u.secret = "S";
        return 0;
      },
    });
    expect(q.all(u)).toEqual([{ a: 0, c: null }]);
  });

  it("default mode: calls a getter installed for a later parameter mid-bind", () => {
    const db = new Database(":memory:");
    const q = db.query("select ? as a, $c as c");
    const u = {};
    Object.defineProperty(u, 0, {
      enumerable: true,
      get() {
        delete u.$c;
        Object.defineProperty(u, "$c", { enumerable: true, get: () => "via-getter" });
        return 0;
      },
    });
    u.$c = "three";
    expect(q.all(u)).toEqual([{ a: 0, c: "via-getter" }]);
  });

  it("does not crash when a getter deletes a later parameter", async () => {
    // Crashed before the fix: the stale layout said $c was present, and the
    // bind read an empty slot.
    const code = `
      import { Database } from "bun:sqlite";
      const db = new Database(":memory:", { strict: true });
      const q = db.query("select ?1 as a, $b as b, $c as c");
      const t = {};
      t[0] = "i";
      Object.defineProperty(t, "b", {
        enumerable: true,
        get() {
          delete t.c;
          return "two";
        },
      });
      t.c = "three";
      try {
        q.all(t);
        console.log("no-error");
      } catch (e) {
        console.log("error: " + e.message);
      }
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", code],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout.trim()).toBe('error: Missing parameter "$c"');
    expect(exitCode).toBe(0);
  });
});

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

describe("Database open mode from an options object", () => {
  // What each open mode does to a missing file, an existing file and ":memory:".
  const readWriteCreate = { missing: "opened, file created", existing: "writable", memory: "opened" };
  const readWrite = { missing: "SQLITE_CANTOPEN, no file", existing: "writable", memory: "opened" };
  const readOnly = {
    missing: "SQLITE_CANTOPEN, no file",
    existing: "SQLITE_READONLY",
    memory: "Cannot open an anonymous database in read-only mode.",
  };
  const message =
    'A read-only database ("readonly: true" or "readwrite: false") cannot have "create: true" or "readwrite: true"';
  const contradiction = { missing: message + ", no file", existing: message, memory: message };

  const _ = undefined;
  const F = false;
  const T = true;
  // [readonly, create, readwrite]
  const cells = [
    [_, _, _, readWriteCreate],
    [_, _, F, readOnly],
    [_, _, T, readWrite],
    [_, F, _, readWrite],
    [_, F, F, readOnly],
    [_, F, T, readWrite],
    [_, T, _, readWriteCreate],
    [_, T, F, contradiction],
    [_, T, T, readWriteCreate],
    [F, _, _, readWriteCreate],
    [F, _, F, readOnly],
    [F, _, T, readWrite],
    [F, F, _, readWrite],
    [F, F, F, readOnly],
    [F, F, T, readWrite],
    [F, T, _, readWriteCreate],
    [F, T, F, contradiction],
    [F, T, T, readWriteCreate],
    [T, _, _, readOnly],
    [T, _, F, readOnly],
    [T, _, T, contradiction],
    [T, F, _, readOnly],
    [T, F, F, readOnly],
    [T, F, T, contradiction],
    [T, T, _, contradiction],
    [T, T, F, contradiction],
    [T, T, T, contradiction],
  ].map(([readonly, create, readwrite, mode]) => {
    const options = {};
    if (readonly !== undefined) options.readonly = readonly;
    if (create !== undefined) options.create = create;
    if (readwrite !== undefined) options.readwrite = readwrite;
    return [options, mode];
  });

  const cross = (modes, others) =>
    modes.flatMap(([options, mode]) => others.map(other => [{ ...options, ...other }, mode]));
  const rows = [
    // A `strict` key does not change the mode.
    ...cross(cells, [{}, { strict: true }]),
    // `undefined` is an absent option. Any other falsy value turns the option off.
    ...cross(
      [
        [{ create: undefined, readwrite: undefined }, readWriteCreate],
        [{ create: null }, readWrite],
        [{ create: 0 }, readWrite],
        [{ readwrite: null }, readOnly],
        [{ readwrite: 0 }, readOnly],
        [{ readwrite: null, create: true }, contradiction],
      ],
      [{}, { strict: true }],
    ),
    // The value of `strict` and a `safeIntegers` key do not change the mode.
    ...cross(
      [
        [{}, readWriteCreate],
        [{ create: false }, readWrite],
        [{ readwrite: false }, readOnly],
      ],
      [{ strict: false }, { safeIntegers: true }, { safeIntegers: false }, { strict: true, safeIntegers: true }],
    ),
  ];

  let dir;
  let existing;
  let files = 0;
  beforeAll(() => {
    dir = tempDir("sqlite-open-mode", {});
    existing = path.join(String(dir), "existing.sqlite");
    using db = new Database(existing);
    db.run("CREATE TABLE t (a)");
  });
  afterAll(() => dir?.[Symbol.dispose]());

  function observe(options) {
    const missing = path.join(String(dir), `missing-${files++}.sqlite`);
    let onMissing = "opened";
    try {
      new Database(missing, options).close();
    } catch (e) {
      onMissing = e.code ?? e.message;
    }
    onMissing += existsSync(missing) ? ", file created" : ", no file";

    let onExisting, strict, safeIntegers;
    try {
      using db = new Database(existing, options);
      safeIntegers = typeof db.query("SELECT 1 AS b").get().b === "bigint";
      // Only strict mode throws for a parameter that is missing.
      try {
        db.query("SELECT $a").get({});
        strict = false;
      } catch {
        strict = true;
      }
      // Rolled back, because a commit for each row makes these tests slow.
      db.run("BEGIN");
      db.run("INSERT INTO t VALUES (1)");
      db.run("ROLLBACK");
      onExisting = "writable";
    } catch (e) {
      onExisting = e.code ?? e.message;
    }

    let onMemory = "opened";
    try {
      new Database(":memory:", options).close();
    } catch (e) {
      onMemory = e.code ?? e.message;
    }
    return { missing: onMissing, existing: onExisting, memory: onMemory, strict, safeIntegers };
  }

  const title = options => {
    const entries = Object.entries(options).map(([key, value]) => `${key}: ${value}`);
    return entries.length ? `{ ${entries.join(", ")} }` : "{}";
  };

  it.each(rows.map(([options, mode]) => [title(options), options, mode]))("%s", (_title, options, mode) => {
    expect(observe(options)).toEqual({
      ...mode,
      ...(mode !== contradiction && { strict: options.strict === true, safeIntegers: options.safeIntegers === true }),
    });
  });

  it("a contradiction is a TypeError", () => {
    expect(() => new Database(existing, { readonly: true, create: true })).toThrow(TypeError);
  });

  it.each([[undefined], [null], [true], [false], ["readonly"], [""], [1n], [() => {}], [Symbol()]])(
    "options that are not an object or a number are the default: %p",
    options => {
      for (const open of [(...args) => new Database(...args), Database.open]) {
        const missing = path.join(String(dir), `missing-${files++}.sqlite`);
        using db = open(missing, options);
        db.run("CREATE TABLE t (a)");
        expect(existsSync(missing)).toBe(true);
      }
    },
  );
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

// Coercing the schema-name argument to serialize() can re-enter JavaScript
// via toString(). If that JS closes the database, sqlite3_serialize must not
// be called on the freed handle. Run in a subprocess because the unsafe
// variant operates on freed memory.
it("serialize(name) rejects a db closed during name toString()", async () => {
  const src = `
    const { Database } = require("bun:sqlite");
    const out = {};

    const db = new Database(":memory:");
    db.run("CREATE TABLE t(a)");

    let message = "did not throw";
    try {
      db.serialize({
        toString() {
          db.close();
          return "main";
        },
      });
    } catch (e) {
      message = e.message;
    }
    out.closeDuringToString = message;

    const db2 = new Database(":memory:");
    db2.run("CREATE TABLE t(a)");
    out.plain = Buffer.isBuffer(db2.serialize("main"));
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

  expect({ stdout: stdout.trim(), stderr, exitCode }).toEqual({
    stdout: JSON.stringify({
      closeDuringToString: "Can't do this on a closed database",
      plain: true,
    }),
    stderr: "",
    exitCode: 0,
  });
});

it("Statement#run works before any Database has been opened", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        const { Statement } = require("bun:sqlite");
        let ran = 0;
        const withoutParams = new Statement({ paramsCount: 0, run() { ran++; } });
        const withParams = new Statement({ paramsCount: 1, run() { ran++; } });
        console.log(JSON.stringify([Object.keys(withoutParams.run()), Object.keys(withParams.run(1)), ran]));
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect({ stdout: stdout.trim(), stderr, exitCode }).toEqual({
    stdout: JSON.stringify([["changes", "lastInsertRowid"], ["changes", "lastInsertRowid"], 2]),
    stderr: "",
    exitCode: 0,
  });
});

it("Database.deserialize accepts an ArrayBuffer", () => {
  const db = Database.open(":memory:");
  db.exec("CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)");
  db.exec('INSERT INTO test (name) VALUES ("Hello")');
  const serialized = db.serialize();
  const arrayBuffer = serialized.buffer.slice(serialized.byteOffset, serialized.byteOffset + serialized.byteLength);

  const db2 = Database.deserialize(arrayBuffer);
  expect(db2.prepare("SELECT * FROM test").all()).toEqual([{ id: 1, name: "Hello" }]);
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

it("Database.deserialize throws on a value that is not a TypedArray or an ArrayBuffer", () => {
  using dir = tempDir("sqlite-deserialize-type", {});
  const filename = path.join(String(dir), "db.sqlite");
  for (const options of [undefined, false, true, {}, { strict: true }, { readonly: true }]) {
    const call = () => Database.deserialize(filename, options);
    expect(call).toThrow(TypeError);
    expect(call).toThrow("Expected 'serialized' to be a TypedArray or ArrayBuffer, got 'string'");
  }
  expect(existsSync(filename)).toBe(false);
  expect(() => Database.deserialize(undefined, { strict: true })).toThrow(
    "Expected 'serialized' to be a TypedArray or ArrayBuffer, got 'undefined'",
  );
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

describe("db.transaction() with a callback that is not synchronous", () => {
  const open = () => {
    const db = new Database(":memory:");
    db.run("CREATE TABLE t (a)");
    return db;
  };
  const rows = db => db.query("SELECT a FROM t").values().flat();
  const stateOf = result => (result instanceof Promise ? Bun.peek.status(result) : "not a promise");

  // COMMIT goes out when the callback returns. `gate` is a promise that the test fulfills after that.
  // [callback, what it returns, what that settles to, the rows when it returns, the rows in the end]
  it.each([
    [
      "an async function without an await",
      insert => async () => (insert(1), insert(2), 7),
      "fulfilled",
      7,
      [1, 2],
      [1, 2],
    ],
    [
      "an async function with a statement after an await: it lands outside the transaction",
      (insert, gate) => async () => (insert(1), await gate, insert(2), 7),
      "pending",
      7,
      [1],
      [1, 2],
    ],
    [
      "an async function that awaits last",
      (insert, gate) => async () => (insert(1), insert(2), await gate, 7),
      "pending",
      7,
      [1, 2],
      [1, 2],
    ],
    [
      "an async function that throws before an await: rolled back",
      insert => async () => {
        insert(1);
        throw new Error("thrown");
      },
      "rejected",
      "thrown",
      [],
      [],
    ],
    [
      "an async function that throws after an await: nothing is rolled back",
      (insert, gate) => async () => {
        insert(1);
        await gate;
        insert(2);
        throw new Error("thrown");
      },
      "pending",
      "thrown",
      [1],
      [1, 2],
    ],
    [
      "a function that returns a fulfilled promise",
      insert => () => (insert(1), insert(2), Promise.resolve(7)),
      "fulfilled",
      7,
      [1, 2],
      [1, 2],
    ],
    [
      "a function that returns a pending promise",
      (insert, gate) => () => (insert(1), insert(2), gate.then(() => 7)),
      "pending",
      7,
      [1, 2],
      [1, 2],
    ],
    [
      "a function that returns a rejected promise: rolled back",
      insert => () => (insert(1), insert(2), Promise.reject(new Error("thrown"))),
      "rejected",
      "thrown",
      [],
      [],
    ],
    [
      "a function that returns a thenable",
      insert => () => (insert(1), insert(2), { then: resolve => resolve(7) }),
      "not a promise",
      7,
      [1, 2],
      [1, 2],
    ],
  ])("%s", async (_, make, state, outcome, atReturn, inTheEnd) => {
    for (const kind of ["default", "immediate"]) {
      using db = open();
      const gate = Promise.withResolvers();
      const result = db.transaction(make(a => db.run("INSERT INTO t VALUES (?)", [a]), gate.promise))[kind]();
      expect({ state: stateOf(result), rows: rows(db), inTransaction: db.inTransaction }).toEqual({
        state,
        rows: atReturn,
        inTransaction: false,
      });
      gate.resolve();
      expect(
        await Promise.resolve(result).then(
          value => value,
          error => error.message,
        ),
      ).toBe(outcome);
      expect({ rows: rows(db), inTransaction: db.inTransaction }).toEqual({ rows: inTheEnd, inTransaction: false });
    }
  });

  it("nested: a callback that is rejected when it returns undoes only its savepoint", async () => {
    using db = open();
    const insert = a => db.run("INSERT INTO t VALUES (?)", [a]);
    const inner = db.transaction(async () => {
      insert(2);
      throw new Error("thrown");
    });
    const result = db.transaction(() => {
      insert(1);
      const rejected = inner();
      expect({ rows: rows(db), inTransaction: db.inTransaction }).toEqual({ rows: [1], inTransaction: true });
      insert(3);
      return [rejected];
    })();
    expect({ rows: rows(db), inTransaction: db.inTransaction }).toEqual({ rows: [1, 3], inTransaction: false });
    await expect(result[0]).rejects.toThrow("thrown");
  });

  it("commits and returns every other result, and does not read its `then`", () => {
    using db = open();
    const insertAndReturn = db.transaction(result => {
      db.run("INSERT INTO t VALUES (1)");
      return result;
    });
    const unread = {
      get then() {
        throw new Error("read");
      },
    };
    const results = [unread, { then: "not a function" }, () => {}, {}, undefined, null, 0, "text", true, 1n];
    for (const result of results) expect(insertAndReturn(result)).toBe(result);
    expect(rows(db)).toHaveLength(results.length);
  });

  it("an async generator function gets its generator back, and the body has not started", () => {
    using db = open();
    const generator = db.transaction(async function* () {
      db.run("INSERT INTO t VALUES (1)");
    })();
    expect(Object.prototype.toString.call(generator)).toBe("[object AsyncGenerator]");
    expect({ rows: rows(db), inTransaction: db.inTransaction }).toEqual({ rows: [], inTransaction: false });
  });
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

describe("Database.prepare", () => {
  // sqlite3_prepare_v3 returns SQLITE_OK with a NULL statement when the input
  // has no SQL (only whitespace/comments). That must be rejected up front, not
  // wrapped in a Statement that later derefs the NULL (crashed when params were
  // passed, threw "Statement has finalized" otherwise).
  it.each([" ", "\n", ";", " ; ", "-- comment", "/* block */"])("throws on SQL with no statement: %p", sql => {
    const db = new Database(":memory:");
    for (const call of [
      () => db.prepare(sql),
      () => db.prepare(sql, {}),
      () => db.prepare(sql, []),
      () => db.query(sql),
    ]) {
      expect(call).toThrow(RangeError);
      expect(call).toThrow("Invalid SQL statement");
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

it("binds a detached TypedArray as a zero-length blob, not NULL", () => {
  // A detached view has no backing store. It must bind the same way a live
  // zero-length view does (and the same way node:sqlite binds it), not as NULL.
  const db = new Database(":memory:");
  db.run("CREATE TABLE foo (id INTEGER PRIMARY KEY, blob BLOB NOT NULL)");

  const u8 = new Uint8Array([1, 2, 3]);
  u8.buffer.transfer();
  expect(u8.byteLength).toBe(0);
  const view = new DataView(new ArrayBuffer(8));
  structuredClone(view.buffer, { transfer: [view.buffer] });
  expect(view.buffer.detached).toBe(true);

  expect(db.query("SELECT typeof(?) AS type").get(u8)).toEqual({ type: "blob" });

  const insert = db.prepare("INSERT INTO foo (id, blob) VALUES ($id, $blob)");
  insert.run({ $id: 1, $blob: new Uint8Array(0) });
  insert.run({ $id: 2, $blob: u8 });
  db.run("INSERT INTO foo (id, blob) VALUES (?, ?)", [3, view]);

  expect(db.query("SELECT id, typeof(blob) AS type, length(blob) AS length FROM foo ORDER BY id").all()).toEqual([
    { id: 1, type: "blob", length: 0 },
    { id: 2, type: "blob", length: 0 },
    { id: 3, type: "blob", length: 0 },
  ]);
  expect(db.query("SELECT blob FROM foo WHERE id = 2").get()).toEqual({ blob: new Uint8Array(0) });
  db.close();
});

it("rejects a 2 GiB blob, as a parameter and as the result of a function, instead of truncating it", async () => {
  // A 2^31 byte length overflowed sqlite3_bind_blob()'s int length and bound
  // an empty TEXT value. The subprocess keeps the 2 GiB reservation out of the
  // test runner. The buffer is never written, so RSS stays small.
  // Every build of SQLite refuses a length over INT_MAX, whatever its SQLITE_MAX_LENGTH is.
  const script = `
    import { Database } from "bun:sqlite";
    let big;
    try {
      big = new Uint8Array(2 ** 31);
    } catch {
      console.log(JSON.stringify("SKIP"));
      process.exit(0);
    }
    const db = new Database(":memory:");
    db.function("big", () => big);
    const attempt = (sql, ...values) => {
      try {
        return db.query(sql).get(...values);
      } catch (e) {
        return [e.name, e.code, e.message].join(": ");
      }
    };
    console.log(JSON.stringify([
      attempt("SELECT typeof(?1) AS type, length(?1) AS length", big),
      attempt("SELECT length(big()) AS length"),
    ]));
  `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: {
      ...bunEnv,
      ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "allocator_may_return_null=1"].filter(Boolean).join(":"),
    },
    stdout: "pipe",
    stderr: "inherit",
  });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  const tooBig = "SQLiteError: SQLITE_TOOBIG: string or blob too big";
  expect(["SKIP", [tooBig, tooBig]]).toContainEqual(JSON.parse(stdout.trim() || '"NO_OUTPUT"'));
  expect(exitCode).toBe(0);
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

describe("empty and duplicate column names", () => {
  it('an empty alias (AS "") keeps its column and all preceding columns', () => {
    using db = new Database(":memory:");
    using stmt = db.prepare('select 1 as a, 2 as "", 3 as b');
    expect(stmt.get()).toEqual({ a: 1, "": 2, b: 3 });
    expect(stmt.all()).toEqual([{ a: 1, "": 2, b: 3 }]);
    expect([...stmt.iterate()]).toEqual([{ a: 1, "": 2, b: 3 }]);
    expect(stmt.values()).toEqual([[1, 2, 3]]);
    expect(stmt.columnNames).toEqual(["a", "", "b"]);
  });

  it("a trailing empty alias does not wipe the whole row", () => {
    using db = new Database(":memory:");
    using stmt = db.prepare('select 10 as first_col, 20 as second_col, 30 as ""');
    expect(stmt.get()).toEqual({ first_col: 10, second_col: 20, "": 30 });
    expect(stmt.columnNames).toEqual(["first_col", "second_col", ""]);
  });

  it('a trailing AS "" SELECT is still row-returning (all/values/raw return arrays, not a number)', () => {
    using db = new Database(":memory:");
    db.run("create table t(v)");
    db.run("insert into t values ('r1'),('r2')");
    using stmt = db.prepare('select v as name, 1 as "" from t');

    // Previously: .all() returned the stale sqlite3_changes() count (a number),
    // .values()/.raw() returned the column count, and .get() returned {}.
    expect(stmt.all()).toEqual([
      { name: "r1", "": 1 },
      { name: "r2", "": 1 },
    ]);
    expect(stmt.values()).toEqual([
      ["r1", 1],
      ["r2", 1],
    ]);
    expect(Array.isArray(stmt.raw())).toBe(true);
    expect(stmt.get()).toEqual({ name: "r1", "": 1 });
    expect([...stmt.iterate()]).toEqual([
      { name: "r1", "": 1 },
      { name: "r2", "": 1 },
    ]);
    expect(stmt.columnNames).toEqual(["name", ""]);

    using lone = db.prepare('select 9 as ""');
    expect(lone.all()).toEqual([{ "": 9 }]);
    expect(lone.values()).toEqual([[9]]);
  });

  it('a trailing AS "" SELECT with zero rows returns [], not null', () => {
    using db = new Database(":memory:");
    db.run("create table t(v)");
    using stmt = db.prepare('select v as name, 1 as "" from t');
    expect(stmt.all()).toEqual([]);
    expect(stmt.values()).toEqual([]);
    expect(stmt.raw()).toEqual([]);
  });

  it("multiple empty aliases: last value wins on the row object, columnNames keeps all", () => {
    using db = new Database(":memory:");
    using stmt = db.prepare('select 1 as "", 2 as x, 3 as ""');
    expect(stmt.get()).toEqual({ "": 3, x: 2 });
    expect(stmt.columnNames).toEqual(["", "x", ""]);
    expect(stmt.values()).toEqual([[1, 2, 3]]);
  });

  it("columnNames preserves duplicates and order, matching columnTypes / declaredTypes / values()", () => {
    using db = new Database(":memory:");
    using stmt = db.prepare("select 1 as a, 2 as b, 3 as a");
    // row object: last duplicate wins (better-sqlite3/node:sqlite semantics)
    expect(stmt.get()).toEqual({ a: 3, b: 2 });
    expect(stmt.columnNames).toEqual(["a", "b", "a"]);
    expect(stmt.columnNames.length).toBe(stmt.columnTypes.length);
    expect(stmt.columnNames.length).toBe(stmt.declaredTypes.length);
    expect(stmt.columnNames.length).toBe(stmt.values()[0].length);
  });

  it("columnNames preserves all columns on the >64-column slow path with an empty alias", () => {
    using db = new Database(":memory:");
    const cols = Array.from({ length: 70 }, (_, i) => `${i} as c${i}`);
    cols[3] = `999 as ""`;
    using stmt = db.prepare(`select ${cols.join(", ")}`);
    const row = stmt.get();
    const names = stmt.columnNames;
    expect(names.length).toBe(70);
    expect(names[0]).toBe("c0");
    expect(names[3]).toBe("");
    expect(names[69]).toBe("c69");
    expect(row.c0).toBe(0);
    expect(row[""]).toBe(999);
    expect(row.c69).toBe(69);
    expect(Object.keys(row).length).toBe(70);
  });

  it("columnNames preserves duplicates on the >64-column slow path", () => {
    using db = new Database(":memory:");
    const cols = Array.from({ length: 70 }, (_, i) => `${i} as c${i}`);
    cols[50] = `777 as c0`;
    using stmt = db.prepare(`select ${cols.join(", ")}`);
    const names = stmt.columnNames;
    expect(names.length).toBe(70);
    expect(names[0]).toBe("c0");
    expect(names[50]).toBe("c0");
    const row = stmt.get();
    expect(row.c0).toBe(777);
    expect(row.c49).toBe(49);
    expect(row.c51).toBe(51);
  });
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
  using dir = tempDir("sqlite-wal-test", { "empty.txt": "" });
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

it("close(true) finalizes outstanding prepared statements instead of throwing", () => {
  const db = new Database(":memory:");
  db.exec("CREATE TABLE foo (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT)");
  db.exec("INSERT INTO foo (name) VALUES ('foo')");
  const prepared = db.prepare("SELECT * FROM foo");
  expect(() => db.close(true)).not.toThrow();
  expect(() => prepared.all()).toThrow("Database has closed");
});

it("close(false) leaves prepare() statements usable but finalizes query() statements", () => {
  const db = new Database(":memory:");
  db.exec("CREATE TABLE foo (a INTEGER)");
  db.exec("INSERT INTO foo VALUES (1), (2), (3)");
  const select = db.prepare("SELECT a FROM foo ORDER BY a");
  const insert = db.prepare("INSERT INTO foo VALUES (?)");
  const iter = select.iterate();
  expect(iter.next().value).toEqual({ a: 1 });
  const owned = [];
  for (let i = 0; i <= Database.MAX_QUERY_CACHE_SIZE + 2; i++) {
    owned.push(db.query(`SELECT a + ${i} AS v FROM foo`));
  }

  db.close(false);

  expect([...iter]).toEqual([{ a: 2 }, { a: 3 }]);
  expect(() => insert.run(4)).not.toThrow();
  expect(select.all()).toEqual([{ a: 1 }, { a: 2 }, { a: 3 }, { a: 4 }]);
  for (const stmt of owned) {
    expect(() => stmt.all()).toThrow("Database has closed");
  }
  expect(() => db.prepare("SELECT 1")).toThrow("Cannot use a closed database");
  expect(() => db.query("SELECT 1")).toThrow("Cannot use a closed database");
  select.finalize();
  insert.finalize();
});

it("prepare() statements kept past close(false) report changes and real errors, and survive schema changes", () => {
  using dir = tempDir("sqlite-close-deferred", {});
  const file = path.join(String(dir), "x.sqlite");
  const db = new Database(file);
  db.exec("CREATE TABLE t (b UNIQUE)");
  const insert = db.prepare("INSERT INTO t VALUES (?)");
  db.close(false);
  expect(insert.run(1)).toEqual({ changes: 1, lastInsertRowid: 1 });
  expect(() => insert.run(1)).toThrow("UNIQUE constraint failed: t.b");
  {
    using other = new Database(file);
    other.exec("CREATE TABLE u (x)");
  }
  expect(insert.run(2)).toEqual({ changes: 1, lastInsertRowid: 2 });
  // close(true) after close(false) force-finalizes what was kept and releases the file
  db.close(true);
  expect(() => insert.run(3)).toThrow("Database has closed");
  rmSync(file);
  expect(existsSync(file)).toBe(false);
});

it("close(false) releases the file once the last prepare() statement is finalized", () => {
  using dir = tempDir("sqlite-close-drain", {});
  const file = path.join(String(dir), "x.sqlite");
  const db = new Database(file);
  db.exec("CREATE TABLE t (a)");
  const a = db.prepare("SELECT a FROM t");
  const b = db.prepare("SELECT a + 1 FROM t");
  db.close(false);
  a.finalize();
  expect(b.all()).toEqual([]);
  b.finalize();
  rmSync(file);
  expect(existsSync(file)).toBe(false);
});

it("WAL is checkpointed at exit for a database closed with close(false) while a prepare() statement is live", async () => {
  using dir = tempDir("sqlite-close-wal", {});
  const file = path.join(String(dir), "x.sqlite");
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const { Database } = require("bun:sqlite");
       const db = new Database(process.argv[1]);
       db.exec("PRAGMA journal_mode=WAL; CREATE TABLE t (a); INSERT INTO t VALUES (1)");
       const sel = db.prepare("SELECT * FROM t");
       console.log(JSON.stringify(sel.get()));
       db.close();
       console.log(JSON.stringify(sel.get()));`,
      file,
    ],
    env: bunEnv,
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, stderr, exitCode }).toEqual({ stdout: '{"a":1}\n{"a":1}\n', stderr: "", exitCode: 0 });
  expect(existsSync(file + "-wal") ? statSync(file + "-wal").size : 0).toBe(0);
  {
    using db = new Database(file, { readonly: true });
    expect(db.query("SELECT * FROM t").all()).toEqual([{ a: 1 }]);
  }
});

it("Statement.isFinalized reflects native state, including statements finalized by close()", () => {
  const db = new Database(":memory:");
  const prev = Database.MAX_QUERY_CACHE_SIZE;
  Database.MAX_QUERY_CACHE_SIZE = 0;
  try {
    const uncached = db.query("SELECT 1");
    const prepared = db.prepare("SELECT 2");
    expect([uncached.isFinalized, prepared.isFinalized]).toEqual([false, false]);
    db.close();
    expect([uncached.isFinalized, prepared.isFinalized]).toEqual([true, false]);
    prepared.finalize();
    expect(prepared.isFinalized).toBe(true);
  } finally {
    Database.MAX_QUERY_CACHE_SIZE = prev;
  }
});

it("`using` releases the connection even after an explicit close(false) left a prepare() statement live", () => {
  using dir = tempDir("sqlite-using-after-close", {});
  const file = path.join(String(dir), "x.sqlite");
  let stmt;
  {
    using db = new Database(file);
    db.exec("CREATE TABLE t (a)");
    stmt = db.prepare("SELECT a FROM t");
    stmt.get();
    db.close();
    expect(stmt.all()).toEqual([]);
  }
  expect(() => stmt.all()).toThrow("Database has closed");
  rmSync(file);
  expect(existsSync(file)).toBe(false);
});

it("a statement the user finalized still reports 'Statement has finalized' after close()", () => {
  const db = new Database(":memory:");
  const a = db.prepare("SELECT 1");
  const b = db.prepare("SELECT 2");
  a.finalize();
  db.close();
  expect(() => a.get()).toThrow("Statement has finalized");
  b.finalize();
  expect(() => b.get()).toThrow("Statement has finalized");
});

it("query() cache evicts least-recently-used statements past MAX_QUERY_CACHE_SIZE", () => {
  const db = new Database(":memory:");
  db.exec("CREATE TABLE foo (a INTEGER)");
  const cachedCount = Symbol.for("Bun.Database.cache.count");
  const first = db.query("SELECT a + 0 FROM foo");
  const second = db.query("SELECT a + 1 FROM foo");
  for (let i = 2; i < Database.MAX_QUERY_CACHE_SIZE; i++) db.query(`SELECT a + ${i} FROM foo`);
  expect(db[cachedCount]).toBe(Database.MAX_QUERY_CACHE_SIZE);
  // touch `first` so `second` becomes the LRU entry
  expect(db.query("SELECT a + 0 FROM foo")).toBe(first);
  const overflow = db.query(`SELECT a + ${Database.MAX_QUERY_CACHE_SIZE} FROM foo`);
  expect(db[cachedCount]).toBe(Database.MAX_QUERY_CACHE_SIZE);
  expect(db.query("SELECT a + 0 FROM foo")).toBe(first);
  expect(db.query(`SELECT a + ${Database.MAX_QUERY_CACHE_SIZE} FROM foo`)).toBe(overflow);
  expect(db.query("SELECT a + 1 FROM foo")).not.toBe(second);
  // the evicted statement still works until close()
  expect(second.all()).toEqual([]);
  db.close();
  expect(() => second.all()).toThrow("Database has closed");
});

it("close(true) finalizes query() statements created after the cache filled up (#36572)", () => {
  const db = new Database(":memory:");
  db.exec("CREATE TABLE foo (a INTEGER)");
  // One more distinct query string than MAX_QUERY_CACHE_SIZE, so the last
  // statement does not fit in the query cache.
  for (let i = 0; i <= Database.MAX_QUERY_CACHE_SIZE; i++) {
    db.query(`SELECT a + ${i} AS v FROM foo`).all();
  }
  expect(() => db.close(true)).not.toThrow();
});

it("close(true) finalizes query() statements past the cache limit that are still referenced (#36572)", () => {
  const db = new Database(":memory:");
  db.exec("CREATE TABLE foo (a INTEGER)");
  const statements = [];
  for (let i = 0; i <= Database.MAX_QUERY_CACHE_SIZE; i++) {
    statements.push(db.query(`SELECT a + ${i} AS v FROM foo`));
  }
  expect(() => db.close(true)).not.toThrow();
  for (const stmt of statements) {
    expect(() => stmt.all()).toThrow("Database has closed");
  }
});

it("close(true) succeeds after unreferenced query() statements were GC'd (#36572)", () => {
  const db = new Database(":memory:");
  db.exec("CREATE TABLE foo (a INTEGER)");
  for (let i = 0; i <= Database.MAX_QUERY_CACHE_SIZE * 2; i++) {
    db.query(`SELECT a + ${i} AS v FROM foo`).all();
  }
  // Collects the statement wrappers; close(true) must not fail over
  // statements that are pending sweep.
  Bun.gc(true);
  expect(() => db.close(true)).not.toThrow();
});

it("close(true) works when query() statements past the cache limit were already finalized", () => {
  const db = new Database(":memory:");
  db.exec("CREATE TABLE foo (a INTEGER)");
  const statements = [];
  for (let i = 0; i <= Database.MAX_QUERY_CACHE_SIZE; i++) {
    statements.push(db.query(`SELECT a + ${i} AS v FROM foo`));
  }
  for (const stmt of statements) {
    stmt.finalize();
  }
  expect(() => db.close(true)).not.toThrow();
});

it("close() should NOT throw an error if the database is in use", () => {
  const db = new Database(":memory:");
  db.exec("CREATE TABLE foo (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT)");
  db.exec("INSERT INTO foo (name) VALUES ('foo')");
  const prepared = db.prepare("SELECT * FROM foo");
  expect(() => db.close()).not.toThrow("database is locked");
});

it("close(true) releases the database file so it can be deleted immediately (#36572)", () => {
  using dir = tempDir("sqlite-close-unlink", {});
  const file = path.join(String(dir), "x.sqlite");
  const db = new Database(file);
  db.exec("CREATE TABLE t (a INTEGER)");
  db.prepare("SELECT a FROM t").all();
  db.close(true);
  // On Windows rmSync throws EBUSY if the statement kept the file handle open past close(true).
  rmSync(file);
  expect(existsSync(file)).toBe(false);
});

it("close() releases the database file when only query() statements are outstanding (#36572)", () => {
  using dir = tempDir("sqlite-close-unlink-query", {});
  const file = path.join(String(dir), "x.sqlite");
  const db = new Database(file);
  db.exec("CREATE TABLE t (a INTEGER)");
  for (let i = 0; i <= Database.MAX_QUERY_CACHE_SIZE; i++) db.query(`SELECT a + ${i} FROM t`).all();
  db.close();
  rmSync(file);
  expect(existsSync(file)).toBe(false);
});

it("close() does not crash with FTS5 virtual tables (#37044)", async () => {
  // close() must not finalize FTS5's internal prepared statements behind the
  // vtab's back; doing so use-after-frees in sqlite3_close's vtab disconnect.
  const src = `
    import { Database } from "bun:sqlite";
    for (let i = 0; i < 10; i++) {
      const db = new Database(":memory:");
      db.exec("CREATE VIRTUAL TABLE notes_fts USING fts5(body)");
      db.exec("INSERT INTO notes_fts(body) VALUES ('hello world'), ('goodbye moon')");
      db.query("SELECT rowid FROM notes_fts WHERE notes_fts MATCH 'hello'").all();
      db.query("SELECT count(*) c FROM notes_fts").get();
      db.close(i % 2 === 0);
    }
    console.log("survived");
  `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", src],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(stdout.trim()).toBe("survived");
  expect(exitCode).toBe(0);
});

it("close() releases an FTS5 database file once the last prepare() statement is finalized (#37044)", () => {
  using dir = tempDir("sqlite-close-unlink-fts5", {});
  const file = path.join(String(dir), "x.sqlite");
  const db = new Database(file);
  db.exec("CREATE VIRTUAL TABLE t USING fts5(a)");
  // FTS5 caches internal prepared statements on the connection; they must not
  // keep the deferred close from ever happening.
  db.query("SELECT rowid FROM t WHERE t MATCH 'x'").all();
  const stmt = db.prepare("SELECT 1");
  db.close();
  stmt.finalize();
  // On Windows rmSync throws EBUSY if the handle stayed open past the last finalize.
  rmSync(file);
  expect(existsSync(file)).toBe(false);
});

it("should dispose even if a prepared statement is still live", () => {
  let prepared;
  expect(() => {
    {
      using db = new Database(":memory:");
      db.exec("CREATE TABLE foo (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT)");
      db.exec("INSERT INTO foo (name) VALUES ('foo')");
      prepared = db.prepare("SELECT * FROM foo");
    }
  }).not.toThrow();
  expect(() => prepared.get()).toThrow("Database has closed");
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
  async function run(op) {
    const stmt = (() => {
      const db = new Database(":memory:");
      let stmt = db.prepare("select 1");
      db.close();
      return stmt;
    })();
    Bun.gc(true);
    await Bun.sleep(100);
    Bun.gc(true);
    stmt[op]();
  }

  const ops = ["all", "get", "run"];
  const count = 99;
  const runs = new Array(count);
  for (let i = 0; i < count; i++) {
    runs[i] = run(ops[i % ops.length]);
  }

  // close(false) leaves prepare() statements usable even after the Database wrapper is collected
  await Promise.all(runs);
});

it("internal SQL helpers reject what is not a database handle", async () => {
  const src = `
    const { SQL } = require("bun:internal-for-testing");
    const { Database } = require("bun:sqlite");
    const ctor = SQL[0];
    const tuple = SQL[1];

    const db = new Database(":memory:");
    const statement = db.prepare("SELECT 1");
    const results = {};
    for (const [name, fn] of [
      ["isInTransaction", handle => ctor.isInTransaction(handle)],
      ["prepare", handle => ctor.prepare(handle, "SELECT 1", undefined, 0, 0)],
      ["run", handle => ctor.run(handle, 0, tuple, "SELECT 1")],
      ["serialize", handle => ctor.serialize(handle, "main")],
      ["loadExtension", handle => ctor.loadExtension(handle, "x")],
      ["fcntl", handle => ctor.fcntl(handle, null, 0, 0)],
      ["close", handle => ctor.close(handle, false)],
      ["handleNumber", handle => ctor.handleNumber(handle)],
      ["defineFunction", handle => ctor.defineFunction(handle, "f", 0, 0, false, () => 1)],
      ["updateHook", handle => ctor.updateHook(handle, 18)],
      ["setUpdateHook", handle => ctor.setUpdateHook(handle, 18, () => {}, db, 0)],
    ]) {
      const messages = new Set();
      // The number that db.handle gives is not the handle either.
      for (const handle of [db.handle, 0, -1, 0.5, "0", null, undefined, {}, db, statement, statement.native]) {
        try {
          fn(handle);
          messages.add("no throw");
        } catch (e) {
          messages.add(e.message);
        }
      }
      results[name] = [...messages];
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

  const rejected = ["Invalid database handle"];
  expect({ stdout: stdout.trim(), stderr, exitCode }).toEqual({
    stdout: JSON.stringify({
      isInTransaction: rejected,
      prepare: rejected,
      run: rejected,
      serialize: rejected,
      loadExtension: rejected,
      fcntl: rejected,
      close: rejected,
      handleNumber: rejected,
      defineFunction: rejected,
      updateHook: rejected,
      setUpdateHook: rejected,
    }),
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

// In a child: the accessors are there for every array of the process.
it("an indexed accessor on Array.prototype is not called for the rows", async () => {
  const src = `
    const { Database } = require("bun:sqlite");
    const db = new Database(":memory:");
    db.run("CREATE TABLE t (a)");
    const insert = db.prepare("INSERT INTO t VALUES (1), (2), (3) RETURNING a");
    let calls = 0;
    for (const index of [0, 1, 2]) {
      Object.defineProperty(Array.prototype, index, {
        configurable: true,
        get() {
          calls++;
          return "from the prototype";
        },
        set() {
          calls++;
        },
      });
    }
    let iterated = "";
    for (const row of insert.iterate()) iterated += JSON.stringify(row);
    const firstByte = (_, value) => (value instanceof Uint8Array ? value[0] : value);
    const rows = JSON.stringify({ all: insert.all(), values: insert.values(), raw: insert.raw(), iterated }, firstByte);
    console.log(rows, calls);
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
    `{"all":[{"a":1},{"a":2},{"a":3}],"values":[[1],[2],[3]],"raw":[[1],[2],[3]],"iterated":"{\\"a\\":1}{\\"a\\":2}{\\"a\\":3}"} 0`,
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
  using dir = tempDir("sqlite-fcntl-bounds", { "empty.txt": "" });
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

// SQLite dereferences the argument of sqlite3_file_control without a null check.
describe("fileControl without storage from the caller", () => {
  // sqlite3_file_control answers these itself, on every VFS.
  const core = ["FILE_POINTER", "VFS_POINTER", "JOURNAL_POINTER", "DATA_VERSION", "RESERVE_BYTES", "RESET_CACHE"];
  // The VFS of a database file answers these.
  const vfs = [
    "LOCKSTATE",
    "LAST_ERRNO",
    "SIZE_HINT",
    "CHUNK_SIZE",
    "PERSIST_WAL",
    "VFSNAME",
    "POWERSAFE_OVERWRITE",
    "TEMPFILENAME",
    "MMAP_SIZE",
    "HAS_MOVED",
    "EXTERNAL_READER",
  ];
  // The memdb VFS of a deserialized database answers these.
  const memdb = ["VFSNAME", "SIZE_LIMIT"];
  // The VFS allocates a string for these and writes its address to the argument.
  const strings = ["VFSNAME", "TEMPFILENAME"];

  async function runWithFileDatabase(dir, script) {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          import { Database, constants } from "bun:sqlite";
          const op = name => constants["SQLITE_FCNTL_" + name];
          const file = new Database("file.db");
          file.run("CREATE TABLE t (v)");
          ${script}
        `,
      ],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  it.concurrent("null, undefined and no argument are the same as -1", async () => {
    using dir = tempDir("sqlite-fcntl-null", {});
    const { stdout, stderr, exitCode } = await runWithFileDatabase(
      dir,
      `
        file.run("ATTACH DATABASE 'attached.db' AS attached");
        file.run("CREATE TABLE attached.t (v)");
        const deserialized = Database.deserialize(file.serialize());

        // Each row: the status with -1, then the status of each call without storage.
        const statuses = (db, names, schema = "main") =>
          Object.fromEntries(
            names.map(name => [
              name,
              [
                db.fileControl(schema, op(name), -1),
                db.fileControl(schema, op(name), null),
                db.fileControl(schema, op(name), undefined),
                db.fileControl(schema, op(name)),
                ...(schema === "main" ? [db.fileControl(op(name), null), db.fileControl(op(name))] : []),
              ],
            ]),
          );
        const result = {
          memory: statuses(new Database(":memory:"), ${JSON.stringify(core)}),
          // A database in memory has no file, so nothing writes a string to the argument.
          memoryStrings: statuses(new Database(":memory:"), ${JSON.stringify(strings)}),
          deserialized: statuses(deserialized, ${JSON.stringify([...core, ...memdb])}),
          file: statuses(file, ${JSON.stringify([...core, ...vfs])}),
          attached: statuses(file, ${JSON.stringify(vfs)}, "attached"),
          unknownOpcode: [file.fileControl(99999, -1), file.fileControl(99999, null)],
        };

        // -1 asks PERSIST_WAL for the flag and does not change it.
        const flagAfterNull = flag => {
          file.fileControl(op("PERSIST_WAL"), flag);
          file.fileControl(op("PERSIST_WAL"), null);
          const read = new Int32Array([-1, 0]);
          file.fileControl(op("PERSIST_WAL"), read);
          return read[0];
        };
        result.persistWal = [flagAfterNull(0), flagAfterNull(1)];

        // A negative 64-bit value asks SIZE_LIMIT for the limit and does not change it.
        const sizeLimit = () => {
          const read = new BigInt64Array([-1n]);
          deserialized.fileControl(op("SIZE_LIMIT"), read);
          return String(read[0]);
        };
        const sizeLimitBefore = sizeLimit();
        deserialized.fileControl(op("SIZE_LIMIT"), null);
        result.sizeLimitKept = sizeLimit() === sizeLimitBefore;

        console.log(JSON.stringify(result));
      `,
    );

    expect(stderr).toBe("");
    const result = JSON.parse(stdout);

    // winFileControl has no case for HAS_MOVED and EXTERNAL_READER and answers SQLITE_NOTFOUND (12).
    // macOS loads the system SQLite: the status is the one that the same call with -1 returns.
    const status = name => (isWindows && (name === "HAS_MOVED" || name === "EXTERNAL_READER") ? 12 : 0);
    const expected = (names, table, calls, bundled = status) =>
      Object.fromEntries(names.map(name => [name, Array(calls).fill(isMacOS ? table?.[name]?.[0] : bundled(name))]));

    expect(result).toEqual({
      memory: expected(core, result.memory, 6),
      memoryStrings: expected(strings, result.memoryStrings, 6, () => 12),
      deserialized: expected([...core, ...memdb], result.deserialized, 6),
      file: expected([...core, ...vfs], result.file, 6),
      attached: expected(vfs, result.attached, 4),
      unknownOpcode: Array(2).fill(isMacOS ? result.unknownOpcode?.[0] : 12),
      persistWal: [0, 1],
      sizeLimitKept: true,
    });
    expect(exitCode).toBe(0);
  });

  // NULL is a value for SET_LOCKPROXYFILE: it means no proxy file. Only the
  // SQLite of macOS can have the handler.
  it.skipIf(!isMacOS)("null stays NULL for SET_LOCKPROXYFILE", () => {
    using dir = tempDir("sqlite-fcntl-proxy", {});
    using db = new Database(path.join(String(dir), "file.db"));
    db.run("CREATE TABLE t (v)");

    // GET_LOCKPROXYFILE writes the address of the proxy path. The address is
    // NULL when the file does not use proxy locking.
    const proxyPath = () => {
      const address = new BigUint64Array([1n]);
      const status = db.fileControl(constants.SQLITE_FCNTL_GET_LOCKPROXYFILE, address);
      return { status, address: address[0] };
    };
    const before = proxyPath();

    expect(db.fileControl(constants.SQLITE_FCNTL_SET_LOCKPROXYFILE, null)).toBe(before.status);
    expect(proxyPath()).toEqual(before);
    db.run("INSERT INTO t VALUES (1)");
  });

  it.concurrent("frees the string that SQLite writes to the storage of bun", async () => {
    using dir = tempDir("sqlite-fcntl-leak", {});
    await expectRssDeltaBelow(
      [
        "-e",
        `
          import { Database, constants } from "bun:sqlite";
          const db = new Database(${JSON.stringify(path.join(String(dir), "file.db"))});
          db.run("CREATE TABLE t (v)");
          const run = arg => {
            for (let i = 0; i < 30_000; i++) db.fileControl(constants.SQLITE_FCNTL_TEMPFILENAME, arg);
          };
          run(0);
          Bun.gc(true);
          const before = process.memoryUsage.rss();
          run(0);
          run(null);
          Bun.gc(true);
          console.log(JSON.stringify({ deltaMiB: (process.memoryUsage.rss() - before) / 1024 / 1024 }));
          db.close();
        `,
      ],
      { release: 12, debug: 12 },
    );
  });

  it.concurrent("a value that is not a number, null, undefined or a TypedArray throws", async () => {
    using dir = tempDir("sqlite-fcntl-object", {});
    const { stdout, stderr, exitCode } = await runWithFileDatabase(
      dir,
      `
        const values = {
          object: {},
          date: new Date(0),
          array: [1, 2, 3],
          function: () => {},
          arrayBuffer: new ArrayBuffer(8),
          boolean: true,
          string: "1",
          bigint: 1n,
          symbol: Symbol(),
        };
        const messages = new Set();
        for (const value of Object.values(values)) {
          try {
            messages.add(file.fileControl(op("PERSIST_WAL"), value));
          } catch (error) {
            messages.add(error.message);
          }
        }
        console.log(JSON.stringify([...messages]));
      `,
    );

    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual(["Expected result to be a number, null or a TypedArray"]);
    expect(exitCode).toBe(0);
  });

  it("a TypedArray reads the value that SQLite writes back", () => {
    using dir = tempDir("sqlite-fcntl-readback", {});
    using db = new Database(path.join(String(dir), "file.db"));
    db.run("CREATE TABLE t (v)");

    const before = new Uint32Array(2);
    const after = new Uint32Array(2);
    expect(db.fileControl(constants.SQLITE_FCNTL_DATA_VERSION, before)).toBe(0);
    db.run("INSERT INTO t VALUES (1)");
    expect(db.fileControl(constants.SQLITE_FCNTL_DATA_VERSION, after)).toBe(0);
    expect(after[0]).not.toBe(before[0]);
  });

  it.each([[null], [undefined], ["main"]])("fileControl(%p, op, arg) is the main database", name => {
    using db = new Database(":memory:");
    const expected = new Uint32Array(2);
    const version = new Uint32Array(2);
    expect(db.fileControl(constants.SQLITE_FCNTL_DATA_VERSION, expected)).toBe(0);
    expect(db.fileControl(name, constants.SQLITE_FCNTL_DATA_VERSION, version)).toBe(0);
    expect(version).toEqual(expected);
    expect(version[0]).toBeGreaterThan(0);
  });
});

// SQLite and dlopen read these strings up to the first NUL.
describe("a string with a null byte is rejected instead of cut short", () => {
  const rejected = argument =>
    expect.objectContaining({
      code: "ERR_INVALID_ARG_VALUE",
      message: expect.stringContaining(`The argument '${argument}' must be a string without null bytes.`),
    });

  it("new Database(filename)", () => {
    using dir = tempDir("sqlite-nul-path", {});
    const real = path.join(String(dir), "real.sqlite");
    new Database(real).close();

    expect(() => new Database(path.join(String(dir), "db1\0zz.sqlite"))).toThrow(rejected("filename"));
    expect(() => Database.open(path.join(String(dir), "db2\0x"), constants.SQLITE_OPEN_READWRITE | constants.SQLITE_OPEN_CREATE)).toThrow(rejected("filename")); // prettier-ignore
    expect(() => new Database(real + "\0.tmp", { readonly: true })).toThrow(rejected("filename"));
    expect(readdirSync(String(dir))).toEqual(["real.sqlite"]);
  });

  it.each([
    ["loadExtension(extension)", "extension", db => db.loadExtension("does-not-exist\0.so")],
    ["loadExtension(extension, entryPoint)", "entryPoint", db => db.loadExtension("does-not-exist.so", "entry\0point")],
    ["serialize(name)", "name", db => db.serialize("main\0x")],
    [
      "fileControl(zDbName, op, arg)",
      "zDbName",
      db => db.fileControl("main\0x", constants.SQLITE_FCNTL_PERSIST_WAL, 0),
    ],
    ["Database.setCustomSQLite(path)", "path", () => Database.setCustomSQLite("libsqlite3\0.dylib")],
  ])("%s", (_, argument, call) => {
    using db = new Database(":memory:");
    expect(() => call(db)).toThrow(rejected(argument));
  });
});

it.skipIf(isMacOS)("Database.setCustomSQLite() returns false where SQLite is statically linked", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        const { Database } = require("bun:sqlite");
        const result = Database.setCustomSQLite("/nonexistent/libsqlite3.so");
        console.log(JSON.stringify({ result, version: new Database(":memory:").query("select sqlite_version() v").get().v }));
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stderr, stdout: JSON.parse(stdout), exitCode }).toEqual({
    stderr: "",
    stdout: { result: false, version: expect.any(String) },
    exitCode: 0,
  });
});

// With statistics on, a heap limit of 1 byte fails the next allocation with SQLITE_NOMEM.
// The limit is process-global, so each case has its own process.
describe.concurrent("SQLite memory statistics are off", () => {
  const inserts = `
    db.exec("PRAGMA hard_heap_limit = 1");
    db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, s TEXT)");
    const insert = db.prepare("INSERT INTO t (s) VALUES (?)");
    const row = Buffer.alloc(4096, "x").toString();
    for (let i = 0; i < 200; i++) insert.run(row);
    console.log(JSON.stringify(db.prepare("SELECT count(*) AS n FROM t").get()));
  `;

  it.each([
    ["bun:sqlite", `const db = new (require("bun:sqlite").Database)(":memory:"); ${inserts}`],
    ["node:sqlite", `const db = new (require("node:sqlite").DatabaseSync)(":memory:"); ${inserts}`],
  ])("%s: PRAGMA hard_heap_limit does not fail allocations", async (_, code) => {
    await using proc = Bun.spawn({ cmd: [bunExe(), "-e", code], env: bunEnv, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout.trim()).toBe(JSON.stringify({ n: 200 }));
    expect(exitCode).toBe(0);
  });
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

it("expands bound values in Statement#toString instead of returning an empty string", () => {
  const db = new Database(":memory:");
  const stmt = db.prepare("SELECT ? AS x");

  // A lone surrogate is bound as one U+FFFD.
  stmt.get("\uD800");
  expect(String(stmt)).toBe("SELECT '\uFFFD' AS x");

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

// Run in a subprocess so a crash shows up as a non-zero exit code instead of taking down the test runner.
it("keeps database handles working when many Workers open databases concurrently", async () => {
  await using dir = tempDir("sqlite-worker-registry", {
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

          // serialize() and deserialize() take and make a handle like open() does.
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
  await using dir = tempDir("bun-sqlite-exit-zombie", {});
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

// Bun's bundled SQLite allows 250000 parameters. A system libsqlite3 (macOS) can stop at 32766.
const sqliteAllowsMoreThan65535Parameters = (() => {
  using db = new Database(":memory:");
  try {
    db.prepare("SELECT ?65537").finalize();
    return true;
  } catch {
    return false;
  }
})();

it.skipIf(!sqliteAllowsMoreThan65535Parameters)(
  "binds statements with more than 65535 parameters without truncating the count",
  () => {
    using db = new Database(":memory:");
    db.exec("CREATE TABLE t(a)");

    // ?65537 gives a statement 65537 parameters with a short SQL text. A uint16_t
    // count wraps that to 1: one value was accepted, which left ?65537 NULL, and
    // 65537 values were rejected.
    const N = 65537;
    const values = Array(N).fill(null);
    values[N - 1] = 7;

    const select = db.prepare(`SELECT ?${N} AS v`);
    expect(select.paramsCount).toBe(N);
    expect(() => select.get([7])).toThrow(`SQLite query expected ${N} values, received 1`);
    expect(select.get(values)).toEqual({ v: 7 });

    // Object bindings walk the same count, so names past the wrapped count stayed NULL.
    const named = db.prepare(`SELECT ?${N} AS v, $name AS n`);
    expect(named.get({ [`?${N}`]: 7, $name: "x" })).toEqual({ v: 7, n: "x" });

    // Database#run(sql, values) builds its own bindings map from the same count.
    const insert = `INSERT INTO t(a) VALUES (?${N})`;
    expect(() => db.run(insert, [7])).toThrow(`SQLite query expected ${N} values, received 1`);
    expect(db.run(insert, values).changes).toBe(1);
    expect(db.query("SELECT a FROM t").all()).toEqual([{ a: 7 }]);
  },
);

// Each in a process of its own: they count native objects, read RSS, or need
// functions that no JIT tier has compiled yet.
describe.concurrent("the connection of a Database is released with the Database", () => {
  async function run(src, ...args) {
    await using proc = Bun.spawn({ cmd: [bunExe(), "-e", src, ...args], env: bunEnv, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout: stdout.trim(), stderr, exitCode };
  }

  // What a Database keeps natively is one cell, an SQLDatabase in heapStats(). Its connection goes
  // with the last of that cell and its statements.
  it("no native handle is left once the Database is collected, closed or not", async () => {
    const src = /* js */ `
      import { heapStats } from "bun:jsc";
      import { Database } from "bun:sqlite";

      const handles = () => heapStats().objectTypeCounts.SQLDatabase ?? 0;
      const serialized = (() => {
        using db = new Database(":memory:");
        db.run("create table t(a)");
        return db.serialize();
      })();
      class Subclass extends Database {}
      const shapes = {
        "open, query, close": () => {
          const db = new Database(":memory:");
          db.query("select 1").get();
          db.close();
          return db;
        },
        "open, query, never closed": () => {
          const db = new Database(":memory:");
          db.query("select 1").get();
          return db;
        },
        "deserialize, close": () => {
          const db = Database.deserialize(serialized);
          db.close();
          return db;
        },
        "deserialize, query, never closed": () => {
          const db = Database.deserialize(serialized);
          db.query("select a from t").all();
          return db;
        },
        "using": () => {
          using db = new Database(":memory:");
          db.prepare("select 1").get();
          return db;
        },
        "subclass": () => new Subclass(":memory:"),
      };

      const results = {};
      Bun.gc(true);
      for (const [shape, make] of Object.entries(shapes)) {
        const held = (() => {
          const databases = [];
          for (let i = 0; i < 20; i++) databases.push(make());
          return handles();
        })();
        Bun.gc(true);
        results[shape] = { held, collected: handles() };
      }

      // A prepare() statement outlives its Database. It keeps the handle, which has the functions that it calls.
      const kept = (() => {
        const statement = (() => {
          const db = new Database(":memory:");
          db.run("create table t(a)");
          db.run("insert into t values (7)");
          return db.prepare("select a from t");
        })();
        Bun.gc(true);
        return { held: handles(), row: statement.get() };
      })();
      Bun.gc(true);
      results["prepare() statement of a dropped Database"] = { ...kept, collected: handles() };
      console.log(JSON.stringify(results));
    `;

    const each = { held: 20, collected: 0 };
    expect(await run(src)).toEqual({
      stdout: JSON.stringify({
        "open, query, close": each,
        "open, query, never closed": each,
        "deserialize, close": each,
        "deserialize, query, never closed": each,
        "using": each,
        "subclass": each,
        "prepare() statement of a dropped Database": { held: 1, row: { a: 7 }, collected: 0 },
      }),
      stderr: "",
      exitCode: 0,
    });
  });

  it("a deserialized Database that is never closed gives its image back when collected", async () => {
    const src = /* js */ `
      import { Database } from "bun:sqlite";
      const source = new Database(":memory:");
      source.exec("create table t(a)");
      source.exec("insert into t values (randomblob(1000000))");
      const serialized = source.serialize();
      source.close();

      function dropOne() {
        const db = Database.deserialize(serialized);
        db.query("select length(a) from t").get();
      }
      // Collect after every few drops: the assertion is about what stays, not about the peak of
      // 100 live images, which the allocator keeps mapped.
      function drop(count) {
        for (let i = 0; i < count; i += 10) {
          for (let j = 0; j < 10; j++) dropOne();
          Bun.gc(true);
        }
      }
      drop(20);
      const before = process.memoryUsage.rss();
      drop(100);
      console.log(JSON.stringify({ deltaMiB: (process.memoryUsage.rss() - before) / 1024 / 1024 }));
    `;

    // Unfixed: each dropped 1 MB image stays, about 117 MiB. Fixed: the 10 images of one batch, about 15 MiB.
    await expectRssDeltaBelow(["-e", src], { release: 50, debug: 60 });
  });

  it("the collector knows the size of a deserialized image and of a statement", async () => {
    const src = /* js */ `
      import { heapStats } from "bun:jsc";
      import { Database } from "bun:sqlite";

      const extraMemory = () => {
        Bun.gc(true);
        return heapStats().extraMemorySize;
      };
      const source = new Database(":memory:");
      source.exec("create table t(a); insert into t values (randomblob(4000000))");
      const serialized = source.serialize();

      let before = extraMemory();
      const db = Database.deserialize(serialized);
      const open = extraMemory() - before;
      db.close();
      const closed = extraMemory() - before;

      before = extraMemory();
      // About 100 KB each.
      const sql = i => "select " + Array.from({ length: 200 }, (_, j) => "?" + (j + 1) + " + " + i).join(", ");
      let statements = Array.from({ length: 50 }, (_, i) => source.prepare(sql(i)));
      const prepared = extraMemory() - before;
      statements = undefined;
      const dropped = extraMemory() - before;

      const MB = 1_000_000;
      console.log(JSON.stringify({
        open: open >= serialized.length && open < serialized.length + MB,
        closed: closed < MB,
        prepared: prepared > 2 * MB,
        dropped: dropped < MB,
      }));
    `;
    expect(await run(src)).toEqual({
      stdout: JSON.stringify({ open: true, closed: true, prepared: true, dropped: true }),
      stderr: "",
      exitCode: 0,
    });
  });

  it("a Database that only its own serialize() call still uses is not closed under that call", async () => {
    const src = /* js */ `
      import { Database } from "bun:sqlite";

      // Runs inside the native call, after the caller gave up its last reference to the Database.
      const name = {
        toString() {
          Bun.gc(true);
          return "main";
        },
      };
      const holders = Array.from({ length: 30 }, () => {
        const db = new Database(":memory:");
        db.run("create table t(a)");
        return { db };
      });
      const serializeTheLastReference = holder => {
        const db = holder.db;
        holder.db = null;
        return db.serialize(name);
      };

      const outcomes = {};
      for (const holder of holders) {
        let outcome;
        try {
          outcome = serializeTheLastReference(holder).byteLength > 0 ? "serialized" : "empty";
        } catch (error) {
          outcome = error.message;
        }
        outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
      }
      console.log(JSON.stringify(outcomes));
    `;

    expect(await run(src)).toEqual({ stdout: JSON.stringify({ serialized: 30 }), stderr: "", exitCode: 0 });
  });

  it("WAL is checkpointed at exit for a dropped Database whose prepare() statement is live", async () => {
    using dir = tempDir("sqlite-collected-wal", {});
    const file = path.join(String(dir), "x.sqlite");
    const src = /* js */ `
      import { heapStats } from "bun:jsc";
      import { Database } from "bun:sqlite";
      import { statSync } from "node:fs";
      const insert = (() => {
        const db = new Database(process.argv[1]);
        db.exec("PRAGMA journal_mode=WAL; CREATE TABLE t (a)");
        return db.prepare("INSERT INTO t VALUES (?)");
      })();
      Bun.gc(true);
      insert.run(1);
      console.log(JSON.stringify({
        handles: heapStats().objectTypeCounts.SQLDatabase ?? 0,
        wal: statSync(process.argv[1] + "-wal").size > 0,
      }));
    `;
    expect(await run(src, file)).toEqual({ stdout: '{"handles":1,"wal":true}', stderr: "", exitCode: 0 });
    expect(existsSync(file + "-wal") ? statSync(file + "-wal").size : 0).toBe(0);
    using db = new Database(file, { readonly: true });
    expect(db.query("SELECT * FROM t").all()).toEqual([{ a: 1 }]);
  });

  // A VM lists the connections it has open, and one that goes gives its place in the list to the last one.
  it("the graph's Databases are closed and the WAL is checkpointed after other Databases were collected", async () => {
    using dir = tempDir("sqlite-live-list", {});
    const file = path.join(String(dir), "x.sqlite");
    const src = /* js */ `
      import { heapStats } from "bun:jsc";
      import { Database } from "bun:sqlite";
      import { statSync } from "node:fs";

      const handles = () => heapStats().objectTypeCounts.SQLDatabase ?? 0;
      const state = db => {
        try {
          db.run("select 1");
          return "open";
        } catch (error) {
          return error.message;
        }
      };
      const graph = new Bun.ModuleGraph();
      const inGraph = () => graph.run(() => new Database(":memory:"));
      // Held through an object and made in calls that have returned: nothing else refers to them.
      const held = {};
      const handlesLeft = [];
      const collect = name => {
        held[name] = null;
        Bun.gc(true);
        handlesLeft.push(handles());
      };
      (() => {
        held.outside = new Database(":memory:");
        held.first = inGraph();
        held.middle = inGraph();
        held.last = inGraph();
      })();
      collect("first"); // "last" takes the place of "first"
      collect("last"); // the one that moved goes
      (() => {
        held.second = inGraph();
        held.third = inGraph();
        held.wal = new Database(process.argv[1]);
        held.wal.exec("PRAGMA journal_mode=WAL; CREATE TABLE t (a)");
        held.insert = held.wal.prepare("INSERT INTO t VALUES (?)");
      })();
      collect("middle"); // "wal" takes the place of "middle"
      collect("second"); // "third" takes the place of "second"
      graph.dispose();
      held.insert.run(1);
      console.log(
        JSON.stringify({
          handlesLeft,
          outside: state(held.outside),
          third: state(held.third),
          wal: state(held.wal),
          walBeforeExit: statSync(process.argv[1] + "-wal").size > 0,
        }),
      );
    `;

    expect(await run(src, file)).toEqual({
      stdout: JSON.stringify({
        handlesLeft: [3, 2, 4, 3],
        outside: "open",
        third: "Database has closed",
        wal: "open",
        walBeforeExit: true,
      }),
      stderr: "",
      exitCode: 0,
    });
    expect(existsSync(file + "-wal") ? statSync(file + "-wal").size : 0).toBe(0);
  });
});

it("db.handle is a number that stays the same after close() and differs between Databases", () => {
  const first = new Database(":memory:");
  // The SQLite of macOS serializes a database without a table to no bytes at all.
  first.run("CREATE TABLE t (a)");
  const second = Database.deserialize(first.serialize());
  const open = [first.handle, second.handle];
  expect(open).toEqual([expect.any(Number), expect.any(Number)]);
  expect(open[0]).not.toBe(open[1]);
  first.close();
  second.close(true);
  expect([first.handle, second.handle]).toEqual(open);
});

it("new Database() does not leak the sqlite3 handle when open fails", async () => {
  using dir = tempDir("sqlite-open-fail", {});
  const badPath = path.join(String(dir), "nonexistent", "x.sqlite");

  // The error is built from the handle, so it must keep its SQLite code.
  expect(() => new Database(badPath)).toThrow(expect.objectContaining({ code: "SQLITE_CANTOPEN" }));

  // In a child: 200 failed opens to warm up, then `count` more. Returns the RSS growth over the `count`,
  // and the bytes that LeakSanitizer reports at exit (0 on a build without it).
  async function failedOpens(count) {
    const src = `
      import { Database } from "bun:sqlite";
      const step = () => { try { new Database(${JSON.stringify(badPath)}); } catch {} };
      for (let i = 0; i < 200; i++) step();
      Bun.gc(true);
      const start = process.memoryUsage.rss();
      for (let i = 0; i < ${count}; i++) step();
      Bun.gc(true);
      console.log((process.memoryUsage.rss() - start) / 1024 / 1024);
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", src],
      env: {
        ...bunEnv,
        // symbolize=0 keeps the child fast. It also turns the LSAN suppressions off.
        ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "detect_leaks=1", "symbolize=0"].filter(Boolean).join(":"),
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const summary = /SUMMARY: AddressSanitizer: (\d+) byte\(s\) leaked/.exec(stderr);
    // The child prints the growth last, so a number on stdout means that every open ran.
    expect({ stdout, stderr, exitCode }).toMatchObject({ stdout: expect.stringMatching(/^-?\d/) });
    // A leak report makes the child exit with 1.
    if (!summary) expect({ stdout, stderr, exitCode }).toMatchObject({ exitCode: 0 });
    return { rssGrowthMB: parseFloat(stdout), leakedBytes: Number(summary?.[1] ?? 0) };
  }

  if (isASAN) {
    // Each handle that is not closed adds about 1400 bytes. The difference of
    // two runs leaves out what every bun process leaks once.
    const [none, many] = await Promise.all([failedOpens(0), failedOpens(500)]);
    expect(many.leakedBytes - none.leakedBytes).toBeLessThan(100_000);
  } else if (!isDebug) {
    // 40000 handles that are not closed grow RSS by about 68 MB.
    expect((await failedOpens(40_000)).rssGrowthMB).toBeLessThan(32);
  }
});

describe("db.run() and db.exec() with several statements", () => {
  // This ALTER prepares fine but fails at sqlite3_step on a populated table.
  const alter = "ALTER TABLE t ADD COLUMN c TEXT NOT NULL DEFAULT (datetime('now'))";
  const alterError = "Cannot add a column with non-constant default";
  const unique = "UNIQUE constraint failed: t.x";

  it.each([
    ["in the middle", `INSERT INTO t VALUES (1); ${alter}; INSERT INTO t VALUES (2);`, alterError, false],
    ["before a newline", `INSERT INTO t VALUES (1); ${alter};\n`, alterError, false],
    ["before a comment", `INSERT INTO t VALUES (1); ${alter}; -- end\n`, alterError, false],
    ["a constraint", "INSERT INTO t VALUES (1); INSERT INTO t VALUES (1); INSERT INTO t VALUES (2);", unique, false],
    // The transaction stays open, as after sqlite3_exec().
    ["before COMMIT", "BEGIN; INSERT INTO t VALUES (1); INSERT INTO t VALUES (1); INSERT INTO t VALUES (2); COMMIT;", unique, true], // prettier-ignore
    [
      "RAISE in a trigger",
      "INSERT INTO t VALUES (1); INSERT INTO t VALUES (7); INSERT INTO t VALUES (2);",
      "seven",
      false,
    ],
  ])("a statement that fails while it runs stops the script: %s", (_, sql, message, inTransaction) => {
    for (const method of ["run", "exec"]) {
      using db = new Database(":memory:");
      db.exec("CREATE TABLE t (x INTEGER UNIQUE)");
      db.exec("CREATE TRIGGER no7 BEFORE INSERT ON t WHEN new.x = 7 BEGIN SELECT RAISE(ABORT, 'seven'); END");
      expect(() => db[method](sql)).toThrow(message);
      expect({ rows: db.query("SELECT x FROM t ORDER BY x").values().flat(), inTransaction: db.inTransaction }).toEqual(
        {
          rows: [1],
          inTransaction,
        },
      );
    }
  });

  it("the first statement gets the bindings, and a later one that fails still throws", () => {
    using db = new Database(":memory:");
    db.exec("CREATE TABLE t (x INTEGER UNIQUE)");
    expect(() => db.run("INSERT INTO t VALUES (?); INSERT INTO t VALUES (1); INSERT INTO t VALUES (2)", 1)).toThrow(
      unique,
    );
    expect(db.query("SELECT x FROM t").values()).toEqual([[1]]);
  });

  // The system SQLite of macOS before 13 has no sqlite3_error_offset. Bun reports -1 there.
  const hasErrorOffset = !(isMacOS && !isMacOSVersionAtLeast(13));

  // sqlite3_error_offset counts from the pointer that sqlite3_prepare_v3 received, which is the start of the
  // statement that failed.
  it.each(["run", "exec"])("%s() counts byteOffset from the start of the SQL text", method => {
    const byteOffsetOf = (sql, how = method) => {
      using db = new Database(":memory:");
      db.run("CREATE TABLE users (id, name)");
      try {
        db[how](sql);
      } catch (e) {
        return e.byteOffset;
      }
      return "no error";
    };
    // The UTF-8 byte index of the token that the error names.
    const at = (sql, token) => (hasErrorOffset ? Buffer.from(sql).indexOf(token) : -1);

    // The first statement of the text fails. prepare() compiles it from the start of the text and agrees.
    const first = [
      ["SELECT nmae FROM users", "nmae"],
      ["\n    SELECT nmae FROM users", "nmae"],
      [" !", "!"],
      [";;; SELECT nmae FROM users", "nmae"],
      ["-- comment\nSELECT nmae FROM users", "nmae"],
      ["/* comment */ SELECT nmae FROM users", "nmae"],
      ["\n\t SELECT 'abc", "'abc"],
    ];
    expect(
      first.map(([sql]) => ({ sql, byteOffset: byteOffsetOf(sql), prepare: byteOffsetOf(sql, "prepare") })),
    ).toEqual(first.map(([sql, token]) => ({ sql, byteOffset: at(sql, token), prepare: at(sql, token) })));

    // A later statement fails. The offset counts the statements, blanks, comments and non-ASCII text before it.
    const later = [
      ["DELETE FROM users; SELECT nmae FROM users", "nmae"],
      ["DELETE FROM users; DELETE FROM users; SELECT nmae FROM users", "nmae"],
      ["DELETE FROM users; -- comment\n SELECT nmae FROM users", "nmae"],
      ["SELECT 'é😀'; SELECT nmae FROM users", "nmae"],
      ["SELECT ';'; SELECT nmae FROM users", "nmae"],
      ["CREATE TRIGGER t AFTER INSERT ON users BEGIN DELETE FROM users; END; SELECT nmae FROM users", "nmae"],
      ["SELECT 1; SELECT * FROM users!!", "!!"],
      ["SELECT 1; !!", "!!"],
      ["SELECT 1; SELECT 'abc", "'abc"],
      // SQLite rejects a vertical tab. Bun skips it in front of a statement.
      ["\vSELECT nmae FROM users", "nmae"],
    ];
    expect(later.map(([sql]) => ({ sql, byteOffset: byteOffsetOf(sql) }))).toEqual(
      later.map(([sql, token]) => ({ sql, byteOffset: at(sql, token) })),
    );

    // An error that names no token has no offset, wherever its statement is. The last one fails in sqlite3_step.
    const noToken = [
      "SELECT 1;\n\n  SELECT * FROM nope",
      "SELECT 1; SELECT (",
      "\n  INSERT INTO users VALUES (1, 2, 3)",
      "SELECT 1;\n  SELECT abs(-9223372036854775808)",
    ];
    expect(noToken.map(sql => ({ sql, byteOffset: byteOffsetOf(sql) }))).toEqual(
      noToken.map(sql => ({ sql, byteOffset: -1 })),
    );

    // An error that does not come from SQLite has no byteOffset property.
    expect(byteOffsetOf(" ; ")).toBeUndefined();
  });

  it("a syntax error in a later statement keeps the statements before it", () => {
    using db = new Database(":memory:");
    db.run("create table t (v)");
    expect(() =>
      db.run("insert into t values (1); insert into t values (2);  insert into t valuez (3); insert into t values (4)"),
    ).toThrow('near "valuez": syntax error');
    expect(db.query("select v from t").values()).toEqual([[1], [2]]);
  });

  it("the text ends at a NUL", () => {
    using db = new Database(":memory:");
    db.run("create table t (v)");
    expect(db.run("insert into t values (1);\0insert into t values (2)").changes).toBe(1);
    expect(db.query("select v from t").values()).toEqual([[1]]);
    expect(db.prepare("select 1 as a\0, 2 as b").get()).toEqual({ a: 1 });
  });
});

// SQLite parses SQL text that ends in a NUL in place and copies any other text first, once for each prepare.
describe("SQL text reaches SQLite with a NUL at its end", () => {
  const marks = { "ASCII": "", "Latin-1": "é", "UTF-16": "\u{1F600}" };

  // ASCII text up to 1199 bytes is copied to the stack with its NUL. Longer text is copied to the heap.
  it.each(Object.keys(marks))("%s text of about 1200 bytes runs whole", encoding => {
    for (const bytes of [1198, 1199, 1200, 1201, 1202]) {
      using db = new Database(":memory:");
      const mark = marks[encoding];
      const sized = (head, tail) => {
        const value = Buffer.alloc(bytes - Buffer.byteLength(head + mark + tail), "x").toString() + mark;
        return [head + value + tail, value];
      };

      const [select, selected] = sized("select '", "' as v");
      const [inserts, inserted] = sized("create table t (v); insert into t values (1); insert into t values ('", "')");
      expect({
        bytes: [Buffer.byteLength(select), Buffer.byteLength(inserts)],
        prepare: db.prepare(select).get(),
        query: db.query(select).get(),
        run: db.run(inserts).changes,
        rows: db.query("select v from t").all(),
      }).toEqual({
        bytes: [bytes, bytes],
        prepare: { v: selected },
        query: { v: selected },
        run: 2,
        rows: [{ v: 1 }, { v: inserted }],
      });
    }
  });

  // On Linux without ASAN, malloc is mimalloc, so heapStats() counts what SQLite allocates. A debug build takes
  // 0.1 s for each heapStats() call.
  it.skipIf(!isLinux || isASAN || isDebug)(
    "SQLite allocates nothing for the text of 800 statements in one string",
    async () => {
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          `
          const { Database } = require("bun:sqlite");
          const { heapStats } = require("bun:jsc");
          const count = () => heapStats().mimalloc.malloc_normal_count;
          const db = new Database(":memory:");
          // The fewest of 5 runs: heapStats() and the other threads only add to a count.
          const during = fn => {
            let fewest = Infinity;
            for (let i = 0; i < 5; i++) {
              const before = count();
              fn();
              fewest = Math.min(fewest, count() - before);
            }
            return fewest;
          };
          const counts = {};
          // Shows that the counter sees SQLite: it saves the text of a statement that does not fit a lookaside slot
          // (1200 bytes) on the heap, once for each call.
          const long = "select 1/*" + Buffer.alloc(1300, "x").toString() + "*/";
          counts.control = during(() => { for (let i = 0; i < 200; i++) db.run(long); });
          const statement = "select 1/*pad*/;";
          for (const [encoding, mark] of Object.entries(${JSON.stringify(marks)})) {
            const text = Buffer.alloc(800 * statement.length, statement).toString() + "select 2 --" + mark;
            counts[encoding] = during(() => db.exec(text));
          }
          console.log(JSON.stringify(counts));
        `,
        ],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      const { control, ...counts } = JSON.parse(stdout);
      expect(control).toBeGreaterThanOrEqual(200);
      const under100 = mallocs => (mallocs < 100 ? "under 100" : mallocs);
      expect({ ASCII: under100(counts.ASCII), "Latin-1": under100(counts["Latin-1"]), "UTF-16": under100(counts["UTF-16"]) }).toEqual({ ASCII: "under 100", "Latin-1": "under 100", "UTF-16": "under 100" }); // prettier-ignore
      expect(exitCode).toBe(0);
    },
  );
});

describe("changes counts only the rows that the statement changes itself", () => {
  const entryPoints = {
    "Database#run": (db, sql, ...params) => db.run(sql, ...params),
    "Database#exec": (db, sql, ...params) => db.exec(sql, ...params),
    "Statement#run from prepare()": (db, sql, ...params) => {
      using stmt = db.prepare(sql);
      return stmt.run(...params);
    },
    "Statement#run from query()": (db, sql, ...params) => db.query(sql).run(...params),
  };

  describe.each(Object.entries(entryPoints))("%s", (_, run) => {
    it("not the shadow tables of a virtual table", () => {
      using db = new Database(":memory:");
      db.exec("CREATE VIRTUAL TABLE ft USING fts5(a, b); CREATE VIRTUAL TABLE rt USING rtree(id, x0, x1);");

      expect({
        fts5Insert: run(db, "INSERT INTO ft VALUES ('alpha beta', 'gamma')").changes,
        fts5InsertTwoRows: run(db, "INSERT INTO ft VALUES (?, ?), (?, ?)", "a", "b", "c", "d").changes,
        fts5UpdateTwoRows: run(db, "UPDATE ft SET b = 'delta' WHERE rowid <= 2").changes,
        fts5DeleteThreeRows: run(db, "DELETE FROM ft").changes,
        rtreeInsert: run(db, "INSERT INTO rt VALUES (1, 0, 1)").changes,
        rtreeDelete: run(db, "DELETE FROM rt WHERE id = 1").changes,
      }).toEqual({
        fts5Insert: 1,
        fts5InsertTwoRows: 2,
        fts5UpdateTwoRows: 2,
        fts5DeleteThreeRows: 3,
        rtreeInsert: 1,
        rtreeDelete: 1,
      });
    });

    it("not the rows that a trigger writes", () => {
      using db = new Database(":memory:");
      db.exec(`
        CREATE TABLE t (a);
        CREATE TABLE log (x);
        CREATE TRIGGER tr AFTER INSERT ON t BEGIN
          INSERT INTO log VALUES (new.a);
          INSERT INTO log VALUES (-new.a);
        END;
      `);

      expect(run(db, "INSERT INTO t VALUES (1)").changes).toBe(1);
      expect(run(db, "INSERT INTO t VALUES (?), (?)", 2, 3).changes).toBe(2);
      expect(db.query("SELECT x FROM log ORDER BY rowid").values()).toEqual([[1], [-1], [2], [-2], [3], [-3]]);
    });

    it("not the rows that a foreign key action deletes", () => {
      using db = new Database(":memory:");
      db.exec(`
        PRAGMA foreign_keys = ON;
        CREATE TABLE parent (id INTEGER PRIMARY KEY);
        CREATE TABLE child (id INTEGER PRIMARY KEY, parent_id REFERENCES parent (id) ON DELETE CASCADE);
        INSERT INTO parent VALUES (1), (2);
        INSERT INTO child VALUES (10, 1), (11, 1), (12, 1), (20, 2);
      `);

      expect(run(db, "DELETE FROM parent WHERE id = 1").changes).toBe(1);
      expect(db.query("SELECT id FROM child").values()).toEqual([[20]]);
    });

    // https://www.sqlite.org/c3ref/changes.html: an INSTEAD OF trigger makes the change, so the statement changes no row.
    it("not the rows that an INSTEAD OF trigger writes for a view", () => {
      using db = new Database(":memory:");
      db.exec(`
        CREATE TABLE t (a);
        CREATE VIEW v AS SELECT a FROM t;
        CREATE TRIGGER vi INSTEAD OF INSERT ON v BEGIN
          INSERT INTO t VALUES (new.a);
        END;
      `);

      expect(run(db, "INSERT INTO v VALUES (1)").changes).toBe(0);
      expect(db.query("SELECT a FROM t").values()).toEqual([[1]]);
    });

    it("0 for a statement that changes no row, not the count of the write before it", () => {
      using db = new Database(":memory:");
      db.exec("CREATE TABLE t (a)");

      // Each statement runs right after a write of two rows, the count that sqlite3_changes() still holds.
      const afterWrite = sql => {
        expect(run(db, "INSERT INTO t VALUES (1), (2)").changes).toBe(2);
        return run(db, sql).changes;
      };
      expect({
        select: afterWrite("SELECT a FROM t"),
        createTable: afterWrite("CREATE TABLE other (a)"),
        begin: afterWrite("BEGIN"),
        commit: afterWrite("COMMIT"),
        updateNoRow: afterWrite("UPDATE t SET a = 0 WHERE 0"),
      }).toEqual({ select: 0, createTable: 0, begin: 0, commit: 0, updateNoRow: 0 });
    });

    // FTS5 keeps the rows of a transaction in memory. SAVEPOINT, RELEASE and COMMIT make it write them to its shadow tables.
    it("0 for a SAVEPOINT, RELEASE or COMMIT that makes FTS5 write its pending rows", () => {
      using db = new Database(":memory:");
      db.exec("CREATE VIRTUAL TABLE ft USING fts5(a, b)");
      const insert = () => expect(run(db, "INSERT INTO ft VALUES ('alpha beta', 'gamma')").changes).toBe(1);

      run(db, "BEGIN");
      insert();
      const savepoint = run(db, "SAVEPOINT s1").changes;
      insert();
      run(db, "SAVEPOINT s2");
      insert();
      const release = run(db, "RELEASE s1").changes;
      insert();
      const commit = run(db, "COMMIT").changes;
      expect({ savepoint, release, commit }).toEqual({ savepoint: 0, release: 0, commit: 0 });
    });
  });

  it.each(["run", "exec"])("Database#%s adds up the statements of a multi-statement string", method => {
    using db = new Database(":memory:");
    db.exec(`
      CREATE TABLE t (a);
      CREATE TABLE log (x);
      CREATE TRIGGER tr AFTER INSERT ON t BEGIN
        INSERT INTO log VALUES (new.a);
      END;
      CREATE VIRTUAL TABLE ft USING fts5(a, b);
    `);

    // The SELECT and the CREATE TABLE change no row, so they must not add the count of the INSERT before them again.
    const sql = "INSERT INTO t VALUES (1); INSERT INTO t VALUES (2), (3); SELECT a FROM t; CREATE TABLE other (a);";
    expect(db[method](sql).changes).toBe(3);
    expect(db[method]("SELECT 1; SELECT 2;").changes).toBe(0);
    expect(db.query("SELECT x FROM log ORDER BY rowid").values()).toEqual([[1], [2], [3]]);

    // Nor the FTS5 writes of a COMMIT.
    const inserts = "INSERT INTO ft VALUES ('a', 'b'); INSERT INTO ft VALUES ('c', 'd'), ('e', 'f');";
    expect([db[method](inserts).changes, db[method](`BEGIN; ${inserts} COMMIT;`).changes]).toEqual([3, 3]);
  });

  // With foreign keys on, DROP TABLE runs a DELETE that SQLite counts. The second DROP is a no-op and sets no counter.
  it.each(["prepare", "query"])("a reused DROP TABLE Statement from %s() reports 0 when it is a no-op", method => {
    using db = new Database(":memory:");
    db.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE parent (id INTEGER PRIMARY KEY);
      CREATE TABLE child (id INTEGER PRIMARY KEY, parent_id REFERENCES parent (id) ON DELETE CASCADE);
      CREATE TABLE t (a);
      INSERT INTO parent VALUES (1), (2), (3);
      INSERT INTO child VALUES (10, 1);
    `);
    using drop = db[method]("DROP TABLE IF EXISTS parent");

    expect([
      drop.run().changes,
      db.run("INSERT INTO t VALUES (1), (2), (3), (4), (5)").changes,
      drop.run().changes,
    ]).toEqual([3, 5, 0]);
  });

  it.each(["prepare", "query"])("a reused Statement from %s() reports its own rows on every run", method => {
    using db = new Database(":memory:");
    db.exec(`
      CREATE TABLE t (id INTEGER PRIMARY KEY, a);
      CREATE TABLE log (x);
      CREATE TRIGGER tr AFTER UPDATE ON t BEGIN
        INSERT INTO log VALUES (new.id);
      END;
    `);
    using insert = db[method]("INSERT INTO t (a) VALUES (?), (?), (?)");
    using update = db[method]("UPDATE t SET a = ? WHERE id <= ?");
    using select = db[method]("SELECT count(*) FROM t");

    expect([
      update.run("x", 0).changes,
      insert.run(1, 2, 3).changes,
      update.run("x", 2).changes,
      select.run().changes,
      insert.run(4, 5, 6).changes,
      update.run("y", 0).changes,
      select.run().changes,
      update.run("y", 1).changes,
    ]).toEqual([0, 3, 2, 0, 3, 0, 0, 1]);
  });
});

describe("binding values", () => {
  it("binds every safe integer number as INTEGER", () => {
    using db = new Database(":memory:");
    const bound = db.query("SELECT typeof(?1) AS type, CAST(?1 AS TEXT) AS text");

    // A Float64Array element is a double in JSC, also when its value fits in an int32.
    const sevenAsDouble = new Float64Array([7])[0];
    const safeIntegers = [
      0,
      sevenAsDouble,
      2 ** 31,
      -(2 ** 31) - 1,
      2 ** 51 - 1,
      2 ** 51,
      2 ** 52 + 1,
      Number.MAX_SAFE_INTEGER,
      -(2 ** 51),
      -(2 ** 51) - 1,
      Number.MIN_SAFE_INTEGER,
    ];
    expect(safeIntegers.map(value => bound.get(value))).toEqual(
      safeIntegers.map(value => ({ type: "integer", text: String(value) })),
    );

    // These are not safe integers. They keep the REAL type.
    const reals = [2 ** 53, -(2 ** 53), 2 ** 63, 1e300, 1.5, -0, Infinity];
    expect(reals.map(value => bound.get(value).type)).toEqual(reals.map(() => "real"));
    expect(db.query("SELECT ? AS value").get(-0).value).toBe(-0);
    // sqlite3_bind_double() turns NaN into NULL.
    expect(bound.get(NaN)).toEqual({ type: "null", text: null });
  });

  // SQLite's own UTF-16 decoder pairs a lone high surrogate with the next code unit, stores a trailing one as
  // ill-formed UTF-8, drops a leading U+FEFF and swaps the bytes of all text after a leading U+FFFE.
  it.each([
    ["lone high surrogate before a character", "a\uD800b"],
    ["trailing lone high surrogate", "a\uD800"],
    ["lone low surrogate before a character", "a\uDC00b"],
    ["only a lone high surrogate", "\uD800"],
    ["leading U+FEFF", "﻿hello"],
    ["leading U+FFFE", "￾hello €"],
    ["only U+FFFE", "￾"],
    ["surrogate pair", "a😀b"],
    ["Latin-1", "café"],
    ["interior NUL", "a\0b€"],
  ])("a string is stored as TextEncoder encodes it: %s", (_, input) => {
    using db = new Database(":memory:");
    const expected = { h: Buffer.from(new TextEncoder().encode(input)).toString("hex").toUpperCase(), v: input.toWellFormed() }; // prettier-ignore
    db.run("CREATE TABLE t (s TEXT)");
    db.run("INSERT INTO t VALUES (?)", [input]);
    expect({
      positional: db.query("SELECT hex(CAST(? AS BLOB)) AS h, ? AS v").get(input, input),
      named: db.query("SELECT hex(CAST($x AS BLOB)) AS h, $x AS v").get({ $x: input }),
      "db.run()": db.query("SELECT hex(CAST(s AS BLOB)) AS h, s AS v FROM t").get(),
    }).toEqual({ positional: expected, named: expected, "db.run()": expected });
  });

  const unsupported = "Binding expected string, TypedArray, boolean, number, bigint or null";

  it.each([
    ["Date", () => new Date(0)],
    ["Map", () => new Map([["a", 1]])],
    ["Set", () => new Set([1])],
    ["Promise", () => Promise.resolve(1)],
    ["RegExp", () => /x/],
    ["Error", () => new Error("e")],
    ["boxed string", () => new String("x")],
  ])("a %s as the only argument throws instead of binding NULL", (_, make) => {
    for (const strict of [false, true]) {
      using db = new Database(":memory:", { strict });
      db.run("CREATE TABLE t (a)");
      using insert = db.prepare("INSERT INTO t VALUES (?)");
      for (const call of [
        () => insert.run(make()),
        () => insert.get(make()),
        () => insert.all(make()),
        () => insert.values(make()),
        () => insert.raw(make()),
        () => [...insert.iterate(make())],
        () => db.run("INSERT INTO t VALUES (?)", make()),
        () => db.prepare("INSERT INTO t VALUES (?)", make()),
      ]) {
        expect(call).toThrow(TypeError);
        expect(call).toThrow(unsupported);
      }
      expect(db.query("SELECT count(*) AS n FROM t").get()).toEqual({ n: 0 });
    }
  });

  it("an ArrayBuffer binds as a BLOB", () => {
    using db = new Database(":memory:");
    const bytes = new Uint8Array([1, 2, 3]);
    const blob = { t: "blob", v: bytes };
    const query = db.query("SELECT typeof(?1) AS t, ?1 AS v");
    expect(query.get(bytes.buffer)).toEqual(blob);
    expect(query.get([bytes.buffer])).toEqual(blob);
    expect(db.query("SELECT typeof($a) AS t, $a AS v").get({ $a: bytes.buffer })).toEqual(blob);
    expect(db.query("SELECT typeof(?) AS t, ? AS v").get(bytes.buffer, 5)).toEqual({ t: "blob", v: 5 });
    const shared = new SharedArrayBuffer(3);
    new Uint8Array(shared).set(bytes);
    expect(query.get(shared)).toEqual(blob);
    expect(query.get(new ArrayBuffer(0))).toEqual({ t: "blob", v: new Uint8Array(0) });
    const detached = new ArrayBuffer(4);
    detached.transfer();
    expect(query.get(detached)).toEqual({ t: "blob", v: new Uint8Array(0) });
  });

  it("every other object still holds named parameters", () => {
    using db = new Database(":memory:");
    const query = db.query("SELECT $a AS a");
    class Params {
      $a = 1;
    }
    expect(query.get(new Params())).toEqual({ a: 1 });
    expect(query.get(Object.assign(Object.create(null), { $a: 2 }))).toEqual({ a: 2 });
    expect(query.get(new Proxy({ $a: 3 }, {}))).toEqual({ a: 3 });
    // What follows the object is ignored.
    expect(query.get({ $a: 4 }, "ignored")).toEqual({ a: 4 });
    expect(
      (function () {
        return db.query("SELECT ? AS a, ? AS b").get(arguments);
      })(5, 6),
    ).toEqual({ a: 5, b: 6 });
  });

  it("db.prepare(sql, value) binds a single value", () => {
    using db = new Database(":memory:");
    const bind = value => db.prepare("SELECT ? AS a", value).get();
    expect([bind("x"), bind(5), bind(5n), bind(true), bind(["y"])]).toEqual([{ a: "x" }, { a: 5 }, { a: 5 }, { a: 1 }, { a: "y" }]); // prettier-ignore
    expect(bind(new Uint8Array([1]))).toEqual({ a: new Uint8Array([1]) });
    expect(db.prepare("SELECT $a AS a", { $a: "z" }).get()).toEqual({ a: "z" });
    // Not a binding.
    expect([bind(undefined), bind(null)]).toEqual([{ a: null }, { a: null }]);
    expect(db.prepare("SELECT ? AS a, ? AS b", null).get()).toEqual({ a: null, b: null });
  });

  it("db.prepare(sql, value) drops a single value that the statement has no one parameter for", () => {
    using db = new Database(":memory:");
    expect(["SELECT 1 AS a", "SELECT 2 AS a"].map(db.prepare, db).map(statement => statement.get())).toEqual([{ a: 1 }, { a: 2 }]); // prettier-ignore
    expect(db.prepare("SELECT 1 AS a", "x").get()).toEqual({ a: 1 });
    expect(db.prepare("SELECT ? AS a, ? AS b", 5).get()).toEqual({ a: null, b: null });
    // A list says how many values it has.
    expect(() => db.prepare("SELECT 1 AS a", [5])).toThrow("SQLite query expected 0 values, received 1");
    expect(() => db.prepare("SELECT ? AS a, ? AS b", [5])).toThrow("SQLite query expected 2 values, received 1");
  });

  it.skipIf(!isLinux)(
    "db.prepare() whose binding throws leaves no statement that keeps the file open after close()",
    () => {
      using dir = tempDir("sqlite-prepare-bind-throws", {});
      const file = path.join(realpathSync(String(dir)), "kept.db");
      const open = () => readdirSync("/proc/self/fd").filter(fd => { try { return readlinkSync("/proc/self/fd/" + fd) === file; } catch { return false; } }).length; // prettier-ignore
      using db = new Database(file);
      expect(() => db.prepare("SELECT ? AS a", [Symbol()])).toThrow("Binding expected");
      expect(open()).toBe(1);
      db.close();
      expect(open()).toBe(0);
    },
  );

  it("no argument keeps the values of the last call, and an empty array clears them", () => {
    using db = new Database(":memory:");
    const query = db.query("SELECT ? AS a");
    expect([query.get("x"), query.get(), query.all(), query.values(), query.get([]), query.get()]).toEqual([
      { a: "x" },
      { a: "x" },
      [{ a: "x" }],
      [["x"]],
      { a: null },
      { a: null },
    ]);
  });
});

describe("named parameters", () => {
  const get = (strict, sql, params) => {
    using db = new Database(":memory:", { strict });
    try {
      return db.query(sql).get(params);
    } catch (e) {
      return e.message;
    }
  };

  // [sql, params, default mode, strict mode]
  it.each([
    // Both modes take both spellings of a name. The mode's own spelling wins.
    ["select :p a", { ":p": 1 }, { a: 1 }, { a: 1 }],
    ["select :p a", { p: 1 }, { a: 1 }, { a: 1 }],
    ["select :p a", { ":p": 1, p: 2 }, { a: 1 }, { a: 2 }],
    ["select @a a, $a b, :a c", { a: 1 }, { a: 1, b: 1, c: 1 }, { a: 1, b: 1, c: 1 }],
    ["select @a a, $a b, :a c", { "@a": 1, $a: 2, ":a": 3 }, { a: 1, b: 2, c: 3 }, { a: 1, b: 2, c: 3 }],
    // Only strict mode throws for a parameter without a value.
    ["select :p a", { nope: 1 }, { a: null }, 'Missing parameter "p"'],
    ["select :p a", {}, { a: null }, 'Missing parameter "p"'],
    ["select :p a", { p: undefined }, { a: null }, { a: null }],
    // $N, :N and @N are names: the key is N.
    ["select $1 a", { 1: "one" }, { a: "one" }, { a: "one" }],
    ["select :1 a", { 1: "one" }, { a: "one" }, { a: "one" }],
    ["select @1 a", { 1: "one" }, { a: "one" }, { a: "one" }],
    ["select $1 a", { $1: "p" }, { a: "p" }, { a: "p" }],
    ["select $1 a", { 0: "zero" }, { a: null }, 'Missing parameter "$1"'],
    ["select :2 two, :1 one", { 1: "A", 2: "B" }, { two: "B", one: "A" }, { two: "B", one: "A" }],
    ["select :2 two, :1 one", { 0: "A", 1: "B" }, { two: null, one: "B" }, 'Missing parameter ":2"'],
    ["select $0 a", { 0: "zero" }, { a: "zero" }, { a: "zero" }],
    ["select $0 a", { 4294967295: "w" }, { a: null }, 'Missing parameter "$0"'],
    ["select $name n, $2 b", { name: "x", 2: "y" }, { n: "x", b: "y" }, { n: "x", b: "y" }],
    // Not array indices.
    ["select $01 a", { "01": "x" }, { a: "x" }, { a: "x" }],
    ["select $4294967295 a", { 4294967295: "x" }, { a: "x" }, { a: "x" }],
    ["select $1abc a", { "1abc": "x" }, { a: "x" }, { a: "x" }],
    // ? and ?N are positions: the key counts from 0, as in an array.
    ["select ?2 two, ?1 one", { 0: "A", 1: "B" }, { two: "B", one: "A" }, { two: "B", one: "A" }],
    ["select ?2 two, ?1 one", { "?1": "A", "?2": "B" }, { two: "B", one: "A" }, { two: "B", one: "A" }],
    ["select ? a, $n b", { 0: 1, $n: 2 }, { a: 1, b: 2 }, { a: 1, b: 2 }],
    ["select ? a, $n b", { n: 2 }, { a: null, b: 2 }, 'Missing parameter "?1"'],
    ["select ? a", { x: 1 }, { a: null }, 'Missing parameter "?1"'],
  ])("%s <- %j", (sql, params, inDefaultMode, inStrictMode) => {
    expect({ default: get(false, sql, params), strict: get(true, sql, params) }).toEqual({
      default: inDefaultMode,
      strict: inStrictMode,
    });
  });

  it("the other spelling is read only when the first is absent", () => {
    using db = new Database(":memory:");
    const reads = [];
    const params = new Proxy(
      { $a: 1, b: 2 },
      {
        getOwnPropertyDescriptor(target, key) {
          reads.push(key);
          return Reflect.getOwnPropertyDescriptor(target, key);
        },
      },
    );
    expect(db.query("SELECT $a AS a, $b AS b").get(params)).toEqual({ a: 1, b: 2 });
    expect(reads).toEqual(["$a", "$b", "b"]);
  });
});

describe("row objects", () => {
  describe("with more columns than fit inline", () => {
    it.each([62, 63, 64, 100, 200, 512, 513])("%d columns", count => {
      using db = new Database(":memory:");
      db.run(`CREATE TABLE wide (${Array.from({ length: count }, (_, i) => `c${i} INTEGER`).join(",")})`);
      for (let r = 0; r < 3; r++) {
        db.run(`INSERT INTO wide VALUES (${Array.from({ length: count }, (_, i) => r * count + i).join(",")})`);
      }

      const expected = Array.from({ length: 3 }, (_, r) =>
        Object.fromEntries(Array.from({ length: count }, (_, i) => [`c${i}`, r * count + i])),
      );
      const rows = db.query("SELECT * FROM wide").all();
      expect(rows).toEqual(expected);
      expect(Object.keys(rows[0])).toEqual(Object.keys(expected[0]));
      expect(db.query("SELECT * FROM wide").get()).toEqual(expected[0]);
      expect([...db.query("SELECT * FROM wide").iterate()]).toEqual(expected);
    });

    it("rows share one Structure", async () => {
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          `
            import { heapStats } from "bun:jsc";
            import { Database } from "bun:sqlite";
            const db = new Database(":memory:");
            db.run("CREATE TABLE wide (" + Array.from({ length: 100 }, (_, i) => "c" + i).join(",") + ")");
            const insert = db.prepare("INSERT INTO wide (c0) VALUES (?)");
            for (let i = 0; i < 1000; i++) insert.run(i);
            const structures = () => (Bun.gc(true), heapStats().objectTypeCounts.Structure);
            const before = structures();
            globalThis.rows = db.query("SELECT * FROM wide").all();
            console.log(structures() - before);
          `,
        ],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      // One for each column.
      expect(Number(stdout)).toBeWithin(1, 300);
      expect(exitCode).toBe(0);
    });

    it("a join with a duplicate name", () => {
      using db = new Database(":memory:");
      const columns = prefix => Array.from({ length: 40 }, (_, i) => `${prefix}${i} INTEGER`).join(",");
      const values = from => Array.from({ length: 40 }, (_, i) => from + i).join(",");
      db.run(`CREATE TABLE ta (id INTEGER PRIMARY KEY, ${columns("a")})`);
      db.run(`CREATE TABLE tb (id INTEGER PRIMARY KEY, ${columns("b")})`);
      db.run(`INSERT INTO ta VALUES (1, ${values(0)})`);
      db.run(`INSERT INTO tb VALUES (1, ${values(100)})`);

      const [row] = db.query("SELECT * FROM ta JOIN tb ON ta.id = tb.id").all();
      expect(Object.keys(row)).toHaveLength(81);
      expect([row.id, row.a0, row.a39, row.b0, row.b39]).toEqual([1, 0, 39, 100, 139]);
    });

    it("as(Class) and safeIntegers", () => {
      using db = new Database(":memory:");
      const sql = `SELECT ${Array.from({ length: 70 }, (_, i) => `${i} AS c${i}`).join(", ")}`;
      class Row {
        get last() {
          return this.c69;
        }
      }
      const row = db.query(sql).as(Row).get();
      expect(row).toBeInstanceOf(Row);
      expect(row.last).toBe(69);
      expect(db.prepare(sql).safeIntegers(true).get().c69).toBe(69n);
    });

    it("rows do not share what is added to one, and their strings survive a collection", () => {
      using db = new Database(":memory:");
      const text = (row, column) => `cell_${row}_${column}_${Buffer.alloc(32, "x").toString()}`;
      db.run(`CREATE TABLE wide (${Array.from({ length: 80 }, (_, i) => `f${i}`).join(",")})`);
      const insert = db.prepare(`INSERT INTO wide VALUES (${Array(80).fill("?").join(",")})`);
      for (let r = 0; r < 100; r++) insert.run(Array.from({ length: 80 }, (_, c) => text(r, c)));

      const rows = db.query("SELECT * FROM wide").all();
      rows[0].named = "named";
      rows[0][5] = "indexed";
      Bun.gc(true);
      expect(["named" in rows[1], 5 in rows[1], rows[0].named, rows[0][5]]).toEqual([false, false, "named", "indexed"]);
      expect(rows.map(row => [row.f0, row.f61, row.f62, row.f79])).toEqual(
        rows.map((_, r) => [text(r, 0), text(r, 61), text(r, 62), text(r, 79)]),
      );
    });
  });

  describe("with a column name that is an array index", () => {
    it("the row is what the object literal with the same keys is", () => {
      using db = new Database(":memory:");
      for (const [sql, literal] of [
        [`SELECT 1`, { 1: 1 }],
        [`SELECT 1 AS "2", 2 AS name, 3 AS "0"`, { 2: 1, name: 2, 0: 3 }],
        [`SELECT 1 AS a, 2 AS "0", 3 AS b, 4 AS c`, { a: 1, 0: 2, b: 3, c: 4 }],
        [`SELECT 1 AS "5", 2 AS "5"`, { 5: 2 }],
        [`SELECT 1 AS "5", 2 AS a, 3 AS "5", 4 AS a`, { 5: 3, a: 4 }],
        // 4294967294 is the largest array index. The others are plain names.
        [`SELECT 1 AS "4294967295", 2 AS "01", 3 AS "-0", 4 AS "4294967294", 5 AS "1.5"`, { 4294967295: 1, "01": 2, "-0": 3, 4294967294: 4, 1.5: 5 }], // prettier-ignore
      ]) {
        for (const row of [db.query(sql).get(), db.query(sql).all()[0], ...db.query(sql).iterate()]) {
          expect(Object.entries(row)).toEqual(Object.entries(literal));
          for (const key in literal) {
            expect([sql, key, row[key], key in row, Object.hasOwn(row, key)]).toEqual([
              sql,
              key,
              literal[key],
              true,
              true,
            ]);
          }
          expect(JSON.stringify(row)).toBe(JSON.stringify(literal));
          expect({ ...row }).toEqual(literal);
          expect(structuredClone(row)).toEqual(literal);
        }
      }
    });

    it("reads with a number, writes and deletes reach the same property", () => {
      using db = new Database(":memory:");
      const row = db.query(`SELECT 10 AS "0", 'x' AS name`).get();
      expect([row[0], 0 in row]).toEqual([10, true]);
      const { 0: destructured } = row;
      expect(destructured).toBe(10);
      row[0] = 99;
      expect([row["0"], JSON.stringify(row)]).toEqual([99, '{"0":99,"name":"x"}']);
      expect(delete row[0]).toBe(true);
      expect(Object.keys(row)).toEqual(["name"]);
    });

    it("columnNames and values() keep the order of the columns", () => {
      using db = new Database(":memory:");
      const query = db.query(`SELECT 1 AS a, 2 AS "0", 3 AS b`);
      expect(query.columnNames).toEqual(["a", "0", "b"]);
      expect(query.values()).toEqual([[1, 2, 3]]);
    });

    it.each([70, 515])("among %d columns", count => {
      using db = new Database(":memory:");
      const columns = Array.from({ length: count }, (_, i) => `${100 + i} AS c${i}`);
      columns[5] = `1005 AS "2"`;
      columns[65] = `1065 AS "0"`;
      columns[66] = `1066 AS "4294967294"`;
      const named = Array.from({ length: count }, (_, i) => `c${i}`).filter((_, i) => i !== 5 && i !== 65 && i !== 66);
      const [row] = db.query(`SELECT ${columns.join(", ")}`).all();
      expect(Object.keys(row)).toEqual(["0", "2", "4294967294", ...named]);
      expect([row[2], row[0], row[4294967294], row.c0, row[`c${count - 1}`]]).toEqual([
        1005,
        1065,
        1066,
        100,
        99 + count,
      ]);
    });

    it("70 of them", () => {
      using db = new Database(":memory:");
      const [row] = db.query(`SELECT ${Array.from({ length: 70 }, (_, i) => `${i + 100} AS "${i}"`).join(", ")}`).all();
      expect(Object.values(row)).toEqual(Array.from({ length: 70 }, (_, i) => i + 100));
    });

    it("is an own property on a row of as(Class), and a bigint with safeIntegers", () => {
      using db = new Database(":memory:");
      class Row {
        get 0() {
          return "prototype getter";
        }
      }
      const row = db.query(`SELECT 10 AS "0", 20 AS v`).as(Row).get();
      expect(row).toBeInstanceOf(Row);
      expect([row[0], row.v]).toEqual([10, 20]);
      expect(db.prepare(`SELECT 10 AS "0"`).safeIntegers(true).get()[0]).toBe(10n);
    });
  });

  it("a duplicate name keeps its first place and its last value", () => {
    using db = new Database(":memory:");
    const query = db.query("SELECT 1 AS a, 2 AS b, 3 AS a, 4 AS c, 5 AS a");
    expect(Object.entries(query.get())).toEqual(Object.entries({ a: 1, b: 2, a: 3, c: 4, a: 5 })); // prettier-ignore
    expect(query.columnNames).toEqual(["a", "b", "a", "c", "a"]);
  });

  it("as() changes the rows of this statement only, also in the middle of a loop", () => {
    using db = new Database(":memory:");
    db.run("CREATE TABLE t (a)");
    db.run("INSERT INTO t VALUES (1), (2), (3)");
    class Row {}
    const query = db.prepare("SELECT a FROM t");
    const other = db.prepare("SELECT a FROM t");
    expect([query.get(), other.get()]).toEqual([{ a: 1 }, { a: 1 }]);

    const seen = [];
    for (const row of query.iterate()) {
      seen.push([row.a, row instanceof Row]);
      query.as(Row);
    }
    expect(seen).toEqual([
      [1, false],
      [2, true],
      [3, true],
    ]);
    expect(other.get()).not.toBeInstanceOf(Row);
    expect(query.as(Object).get()).not.toBeInstanceOf(Row);
  });

  describe("after a schema change", () => {
    // https://github.com/oven-sh/bun/issues/1332
    it.each([
      ["dropping a column", "ALTER TABLE t DROP COLUMN a", { id: 1, b: "B", c: "C" }],
      ["renaming a column", "ALTER TABLE t RENAME COLUMN b TO z", { id: 1, a: "A", z: "B", c: "C" }],
      [
        "rebuilding the table with another column order",
        "CREATE TABLE t2 (id INTEGER PRIMARY KEY, c TEXT, b TEXT, a TEXT);" +
          "INSERT INTO t2 SELECT id, c, b, a FROM t;" +
          "DROP TABLE t;" +
          "ALTER TABLE t2 RENAME TO t",
        { id: 1, c: "C", b: "B", a: "A" },
      ],
      ["adding a column", "ALTER TABLE t ADD COLUMN e TEXT DEFAULT 'E'", { id: 1, a: "A", b: "B", c: "C", e: "E" }],
      ["renaming to a name that is not ASCII", "ALTER TABLE t RENAME COLUMN b TO é", { id: 1, a: "A", é: "B", c: "C" }],
    ])("%s reaches every reader of a kept statement", (_name, migration, after) => {
      using dir = tempDir("sqlite-migration", {});
      const file = path.join(String(dir), "app.db");
      const migrate = {
        "db.run()": db => db.run(migration),
        "a prepared statement": db => {
          for (const sql of migration.split(";")) db.prepare(sql).run();
        },
        "another connection": () => {
          using other = new Database(file);
          other.run(migration);
        },
      };
      for (const [who, run] of Object.entries(migrate)) {
        rmSync(file, { force: true });
        using db = new Database(file);
        db.run("CREATE TABLE t (id INTEGER PRIMARY KEY, a TEXT, b TEXT, c TEXT)");
        db.run("INSERT INTO t VALUES (1, 'A', 'B', 'C')");
        db.run("CREATE TABLE u (tid INTEGER, d TEXT)");
        db.run("INSERT INTO u VALUES (1, 'D')");

        class Row {}
        const SELECT = "SELECT * FROM t WHERE id = 1";
        using kept = db.prepare(SELECT);
        using asClass = db.prepare(SELECT).as(Row);
        using join = db.prepare("SELECT * FROM t JOIN u ON u.tid = t.id");
        const read = () => ({
          who,
          "query().get()": db.query(SELECT).get(),
          "keys of get()": Object.keys(kept.get()),
          "all()": kept.all(),
          "iterate()": [...kept.iterate()],
          "values()": kept.values(),
          "columnNames": kept.columnNames,
          "columnTypes": kept.columnTypes.length,
          "as(Class).get()": { ...asClass.get() },
          "join get()": join.get(),
        });
        const expected = row => ({
          who,
          "query().get()": row,
          "keys of get()": Object.keys(row),
          "all()": [row],
          "iterate()": [row],
          "values()": [Object.values(row)],
          "columnNames": Object.keys(row),
          "columnTypes": Object.keys(row).length,
          "as(Class).get()": row,
          "join get()": { ...row, tid: 1, d: "D" },
        });

        // Run every statement once so that each one has its row shape.
        expect(read()).toEqual(expected({ id: 1, a: "A", b: "B", c: "C" }));
        run(db);
        expect(read()).toEqual(expected(after));
      }
    });

    // https://github.com/oven-sh/bun/issues/1332
    it("made by another process", async () => {
      using dir = tempDir("sqlite-migration-process", {});
      const file = path.join(String(dir), "app.db");
      using db = new Database(file);
      db.run("PRAGMA journal_mode = wal");
      db.run("CREATE TABLE foo (id INTEGER PRIMARY KEY AUTOINCREMENT, greeting TEXT)");
      db.run("INSERT INTO foo (greeting) VALUES (?)", ["Welcome to bun!"]);
      const query = db.query("SELECT * FROM foo");
      expect(query.get()).toEqual({ id: 1, greeting: "Welcome to bun!" });

      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          `const db = new (require("bun:sqlite").Database)(process.argv[1]);
           db.run("ALTER TABLE foo RENAME COLUMN greeting TO greeting2");
           db.close();`,
          file,
        ],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({ stdout, stderr, exitCode }).toEqual({ stdout: "", stderr: "", exitCode: 0 });

      expect(query.get()).toEqual({ id: 1, greeting2: "Welcome to bun!" });
    });
  });

  // SQLite prepares these again for each new value.
  it("LIMIT ? and LIKE ? keep their rows right", () => {
    using db = new Database(":memory:");
    db.run("CREATE TABLE t (a TEXT PRIMARY KEY, b)");
    db.run("INSERT INTO t VALUES ('ab', 1), ('ac', 2), ('bc', 3)");
    const limit = db.query("SELECT * FROM t ORDER BY a LIMIT ?");
    const like = db.query("SELECT * FROM t WHERE a LIKE ? ORDER BY a");
    expect([limit.all(1), limit.all(2), limit.get(3), like.all("a%"), like.all("%c"), like.get("b%")]).toEqual([
      [{ a: "ab", b: 1 }],
      [
        { a: "ab", b: 1 },
        { a: "ac", b: 2 },
      ],
      { a: "ab", b: 1 },
      [
        { a: "ab", b: 1 },
        { a: "ac", b: 2 },
      ],
      [
        { a: "ac", b: 2 },
        { a: "bc", b: 3 },
      ],
      { a: "bc", b: 3 },
    ]);
  });
});

describe("the newest run of a Statement owns its cursor", () => {
  const invalidated = "This iterator was invalidated: its statement was run again";

  function open() {
    const db = new Database(":memory:");
    db.exec("CREATE TABLE t (a INTEGER); INSERT INTO t VALUES (0), (1), (2)");
    return db;
  }
  const rows = [{ a: 0 }, { a: 1 }, { a: 2 }];
  const SELECT = "SELECT a FROM t ORDER BY a";

  it.each([
    ["get()", s => s.get()],
    ["all()", s => s.all()],
    ["values()", s => s.values()],
    ["raw()", s => s.raw()],
    ["run()", s => s.run()],
    ["columnTypes", s => s.columnTypes],
    ["iterate()", s => s.iterate().next()],
    ["for..of", s => s[Symbol.iterator]().next()],
  ])("%s in the body of a loop over the same statement works, and the loop throws at its next row", (_, use) => {
    using db = open();
    for (const s of [db.prepare(SELECT), db.query(SELECT)]) {
      const seen = [];
      expect(() => {
        for (const row of s.iterate()) {
          if (seen.push(row) > rows.length) throw new Error("the loop started again");
          use(s);
        }
      }).toThrow(invalidated);
      expect(seen).toEqual([{ a: 0 }]);
      expect(s.all()).toEqual(rows);
    }
  });

  it("a call that fails to bind invalidates the iterator too", () => {
    using db = open();
    const s = db.prepare("SELECT a FROM t WHERE a >= ? ORDER BY a");
    const iterator = s.iterate(0);
    expect(iterator.next().value).toEqual({ a: 0 });
    expect(() => s.get(Symbol())).toThrow(TypeError);
    expect(() => iterator.next()).toThrow(invalidated);
  });

  it("nested loops over db.query() of the same SQL throw instead of looping for ever", () => {
    using db = open();
    let steps = 0;
    expect(() => {
      for (const _outer of db.query(SELECT).iterate()) {
        for (const _inner of db.query(SELECT).iterate()) {
          if (++steps > rows.length ** 2) throw new Error("the loop started again");
        }
      }
    }).toThrow(invalidated);

    const pairs = [];
    for (const outer of db.prepare(SELECT).iterate()) for (const inner of db.prepare(SELECT).iterate()) pairs.push(outer.a * 3 + inner.a); // prettier-ignore
    expect(pairs).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("of two iterators the second one runs, and closing the first does not disturb it", () => {
    using db = open();
    const s = db.prepare(SELECT);
    const a = s.iterate();
    expect(a.next().value).toEqual({ a: 0 });
    const b = s.iterate();
    expect(b.next().value).toEqual({ a: 0 });
    expect(a.return()).toEqual({ value: undefined, done: true });
    expect([...b]).toEqual([{ a: 1 }, { a: 2 }]);
  });

  it("an iterator that was dropped half way blocks nobody", () => {
    using db = open();
    expect(db.query(SELECT).iterate().next().value).toEqual({ a: 0 });
    expect(db.query(SELECT).all()).toEqual(rows);
    expect(db.query(SELECT).iterate().next().value).toEqual({ a: 0 });
    expect([...db.query(SELECT).iterate()]).toEqual(rows);
  });

  it.each([
    ["break", s => { for (const _row of s.iterate()) break; }], // prettier-ignore
    ["an exception", s => { try { for (const _row of s.iterate()) throw new Error("boom"); } catch {} }], // prettier-ignore
    ["destructuring", s => { const [_first] = s.iterate(); }], // prettier-ignore
    ["return()", s => { const iterator = s.iterate(); iterator.next(); iterator.return(); }], // prettier-ignore
    ["break from for..of over the statement", s => { for (const _row of s) break; }], // prettier-ignore
  ])("%s ends the run: the next one starts at the first row and the table is not locked", (_, leave) => {
    using db = open();
    const s = db.query(SELECT);
    leave(s);
    expect([...s.iterate()]).toEqual(rows);
    leave(s);
    db.transaction(() => db.run("DROP TABLE t"))();
  });

  it("with parameters", () => {
    using db = open();
    const s = db.prepare("SELECT a FROM t WHERE a >= $min ORDER BY a");
    for (const row of s.iterate({ $min: 1 })) {
      expect(row).toEqual({ a: 1 });
      break;
    }
    expect([...s.iterate({ $min: 0 })]).toEqual(rows);
    // The last values stay bound.
    expect([...s.iterate()]).toEqual(rows);
  });

  it.each([
    ["finalize()", (db, s) => s.finalize(), "Statement has finalized"],
    ["db.close()", db => db.close(), "Database has closed"],
    ["db.close(true)", db => db.close(true), "Database has closed"],
  ])("%s in the loop body ends the loop with an error", (_, end, message) => {
    using db = open();
    const s = db.query(SELECT);
    const seen = [];
    expect(() => {
      for (const row of s.iterate()) {
        seen.push(row);
        end(db, s);
      }
    }).toThrow(message);
    expect(seen).toEqual([{ a: 0 }]);
  });

  describe("INSERT ... RETURNING with a deferred foreign key that fails at the commit", () => {
    // No parent 999 exists, but the check is deferred, so the first step still returns the row. Ending the run is
    // the commit: https://www.sqlite.org/c3ref/reset.html
    function openChild() {
      const db = new Database(":memory:");
      db.exec(`
        PRAGMA foreign_keys = ON;
        CREATE TABLE parent (id INTEGER PRIMARY KEY);
        CREATE TABLE child (id INTEGER PRIMARY KEY, pid INTEGER REFERENCES parent(id) DEFERRABLE INITIALLY DEFERRED);
      `);
      return db;
    }
    const INSERT = "INSERT INTO child (id, pid) VALUES (1, 999) RETURNING id";
    const failure = expect.objectContaining({
      name: "SQLiteError",
      code: "SQLITE_CONSTRAINT_FOREIGNKEY",
      message: "FOREIGN KEY constraint failed",
    });

    it.each([
      ["get()", s => s.get()],
      ["break", s => { for (const _row of s.iterate()) break; }], // prettier-ignore
    ])("%s throws, and the statement can run again", (_, use) => {
      using db = openChild();
      const s = db.prepare(INSERT);
      expect(() => use(s)).toThrow(failure);
      expect(db.query("SELECT * FROM child").all()).toEqual([]);
      db.exec("INSERT INTO parent (id) VALUES (999)");
      expect(s.get()).toEqual({ id: 1 });
      expect(db.query("SELECT id, pid FROM child").all()).toEqual([{ id: 1, pid: 999 }]);
    });

    it("an exception from the loop body is not replaced", () => {
      using db = openChild();
      const s = db.prepare(INSERT);
      expect(() => {
        for (const _row of s.iterate()) throw new Error("boom");
      }).toThrow("boom");
      expect(db.query("SELECT * FROM child").all()).toEqual([]);
    });
  });
});

describe("Statement#get", () => {
  it("does not read the rows after the first", () => {
    using db = new Database(":memory:");
    db.run("CREATE TABLE t (a)");
    db.run("INSERT INTO t VALUES (1), (-9223372036854775808)");
    // The second row is an integer overflow.
    const query = db.query("SELECT abs(a) AS a FROM t");
    expect(query.get()).toEqual({ a: 1 });
    expect(() => query.all()).toThrow("integer overflow");
  });

  it("makes all the changes of INSERT ... RETURNING", () => {
    using db = new Database(":memory:");
    db.run("CREATE TABLE t (a)");
    expect(db.query("INSERT INTO t VALUES (1), (2), (3) RETURNING a").get()).toEqual({ a: 1 });
    expect(db.query("SELECT a FROM t").values()).toEqual([[1], [2], [3]]);
  });
});

it("all(), values() and raw() return an empty array for a statement without columns", () => {
  using db = new Database(":memory:");
  db.run("CREATE TABLE t (a)");
  const insert = db.query("INSERT INTO t VALUES (1)");
  expect([insert.all(), insert.values(), insert.raw(), insert.get(), [...insert.iterate()]]).toEqual([
    [],
    [],
    [],
    null,
    [],
  ]);
  expect(db.query("SELECT count(*) AS n FROM t").get()).toEqual({ n: 5 });
});

describe("db.query() does not cache long SQL (#28911)", () => {
  const cachedCount = Symbol.for("Bun.Database.cache.count");
  const padTo = n => `SELECT '${Buffer.alloc(n - "SELECT ''".length, "x").toString()}'`;

  it("64 KB is cached, one more character is not", () => {
    using db = new Database(":memory:");
    const atLimit = db.query(padTo(64 * 1024));
    expect(db[cachedCount]).toBe(1);
    expect(db.query(padTo(64 * 1024))).toBe(atLimit);

    const overLimit = db.query(padTo(64 * 1024 + 1));
    expect(db[cachedCount]).toBe(1);
    expect(db.query(padTo(64 * 1024 + 1))).not.toBe(overLimit);
    expect(overLimit.all()).toHaveLength(1);
  });

  it("close() still finalizes a statement that was not cached", () => {
    const db = new Database(":memory:");
    const statement = db.query(padTo(64 * 1024 + 1));
    db.close();
    expect(statement.isFinalized).toBe(true);
  });
});

// Spawned: JSC::createError() asserts that the message is not empty.
it("a trigger that raises an empty message throws a SQLiteError", async () => {
  const src = `
    import { Database } from "bun:sqlite";
    const db = new Database(":memory:");
    db.run("CREATE TABLE foo (id INTEGER PRIMARY KEY)");
    db.run("CREATE TRIGGER no_insert BEFORE INSERT ON foo BEGIN SELECT RAISE(ABORT, ''); END");
    for (const insert of [() => db.run("INSERT INTO foo VALUES (1)"), () => db.query("INSERT INTO foo VALUES (1)").run()]) {
      try {
        insert();
        console.log("did not throw");
      } catch (e) {
        console.log(JSON.stringify({ name: e.name, message: e.message, code: e.code }));
      }
    }
  `;
  await using proc = Bun.spawn({ cmd: [bunExe(), "-e", src], env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const expected = '{"name":"SQLiteError","message":"","code":"SQLITE_CONSTRAINT_TRIGGER"}';
  expect(stderr).toBe("");
  expect(stdout.trim().split(/\r?\n/)).toEqual([expected, expected]);
  expect(exitCode).toBe(0);
});

it("db.run() gives its values to the first statement and runs the parameters of the later ones as NULL", () => {
  using db = new Database(":memory:");
  db.run("CREATE TABLE t (a)");
  expect(db.run("INSERT INTO t VALUES (?); INSERT INTO t VALUES (?); INSERT INTO t VALUES (:a)", [1])).toEqual({
    changes: 3,
    lastInsertRowid: 3,
  });
  expect(db.query("SELECT a FROM t").values()).toEqual([[1], [null], [null]]);
});

// macOS loads the system SQLite, which has its own default.
it.skipIf(isMacOS)("a WAL database syncs at every commit unless the application says otherwise", () => {
  using dir = tempDir("sqlite-wal-synchronous", {});
  using db = new Database(path.join(String(dir), "wal.sqlite"));
  const synchronous = () => db.query("PRAGMA synchronous").values()[0][0];
  const FULL = 2;
  const NORMAL = 1;
  expect(synchronous()).toBe(FULL);
  db.run("PRAGMA journal_mode = WAL");
  // A default for WAL mode would take effect with the next transaction.
  db.run("CREATE TABLE t (a)");
  expect(synchronous()).toBe(FULL);
  db.run("PRAGMA synchronous = NORMAL");
  expect(synchronous()).toBe(NORMAL);
});

// https://github.com/nodejs/node/pull/59405
it("a Database says which SQLite module it is from", () => {
  using db = new Database(":memory:");
  const type = Symbol.for("sqlite-type");
  expect(db[type]).toBe("bun:sqlite");
  expect(Object.hasOwn(db, type)).toBe(false);
  expect(new (class extends Database {})(":memory:")[type]).toBe("bun:sqlite");
});

describe("Statement#reader and Statement#readonly", () => {
  it.each([
    ["SELECT a FROM t", true, true],
    ["INSERT INTO t VALUES (1)", false, false],
    ["INSERT INTO t VALUES (1) RETURNING a", true, false],
    ["UPDATE t SET a = 1", false, false],
    ["CREATE TABLE u (a)", false, false],
    ["BEGIN", false, true],
    ["PRAGMA user_version", true, true],
    ["PRAGMA user_version = 1", false, false],
  ])("%s", (sql, reader, readonly) => {
    using db = new Database(":memory:");
    db.run("CREATE TABLE t (a)");
    for (const statement of [db.prepare(sql), db.query(sql)]) {
      expect({ reader: statement.reader, readonly: statement.readonly }).toEqual({ reader, readonly });
    }
    // Neither one runs the statement.
    expect(db.query("SELECT (SELECT count(*) FROM t) AS rows, (SELECT count(*) FROM sqlite_schema) AS tables").get()).toEqual({ rows: 0, tables: 1 }); // prettier-ignore
  });

  it("throw on a finalized statement", () => {
    using db = new Database(":memory:");
    const statement = db.prepare("SELECT 1");
    statement.finalize();
    expect(() => statement.reader).toThrow("Statement has finalized");
    expect(() => statement.readonly).toThrow("Statement has finalized");
  });
});

describe("db.function()", () => {
  const busy = "This database connection is busy executing a query";

  it("returns the database", () => {
    using db = new Database(":memory:");
    expect(db.function("one", () => 1)).toBe(db);
    expect(db.function("two", {}, () => 2)).toBe(db);
    expect(db.function("three", null, () => 3)).toBe(db);
    expect(db.query("SELECT one() + two() + three() AS n").get()).toEqual({ n: 6 });
  });

  describe("a result is stored as the same value is when it is bound", () => {
    it.each([
      ["an int32", 1, "integer", 1],
      ["a safe integer", 2 ** 40, "integer", 2 ** 40],
      ["a fraction", 1.5, "real", 1.5],
      ["a number that is not a safe integer", 2 ** 60, "real", 2 ** 60],
      ["-0", -0, "real", -0],
      ["Infinity", Infinity, "real", Infinity],
      ["NaN", NaN, "null", null],
      ["a string", "text", "text", "text"],
      ["an empty string", "", "text", ""],
      ["a string that is not Latin-1", "é😀", "text", "é😀"],
      ["a lone surrogate", "\uD800", "text", "�"],
      ["a string with a NUL", "a\0b", "text", "a\0b"],
      ["null", null, "null", null],
      ["undefined", undefined, "null", null],
      ["true", true, "integer", 1],
      ["false", false, "integer", 0],
      ["a BigInt", 2n ** 62n, "integer", 2 ** 62],
      ["a Uint8Array", new Uint8Array([1, 2]), "blob", new Uint8Array([1, 2])],
      ["an empty Uint8Array", new Uint8Array(0), "blob", new Uint8Array(0)],
      ["a Float64Array", new Float64Array([1]), "blob", new Uint8Array(new Float64Array([1]).buffer)],
      ["a Buffer", Buffer.from("ab"), "blob", new Uint8Array([97, 98])],
      ["an ArrayBuffer", new Uint8Array([3, 4]).buffer, "blob", new Uint8Array([3, 4])],
    ])("%s", (_, value, type, readBack) => {
      using db = new Database(":memory:");
      db.function("f", () => value);
      const row = db.query("SELECT typeof(f()) AS result, typeof(?1) AS bound, f() AS value").get(value);
      expect(row).toEqual({ result: type, bound: type, value: readBack });
      expect(Object.is(row.value, -0)).toBe(Object.is(readBack, -0));
    });
  });

  it.each([
    ["an object", () => ({})],
    ["an array", () => [1]],
    ["a Date", () => new Date(0)],
    ["a symbol", () => Symbol("s")],
    ["a function", () => () => 1],
    ["a promise", async () => 1],
  ])("%s is not a result", (_, fn) => {
    using db = new Database(":memory:");
    db.function("bad name", fn);
    const query = db.query('SELECT "bad name"() AS a');
    for (const run of [() => query.get(), () => db.run('SELECT "bad name"()')]) {
      expect(run).toThrow(new TypeError("User-defined function bad name() returned an invalid value"));
    }
  });

  it("a BigInt that does not fit in 64 bits is treated as a parameter is: by the safeIntegers of the function", () => {
    using db = new Database(":memory:");
    db.function("wraps", () => 2n ** 64n - 1n);
    expect(db.query("SELECT wraps() AS result, ? AS bound").get(2n ** 64n - 1n)).toEqual({ result: -1, bound: -1 });
    db.function("f", { safeIntegers: true }, () => 2n ** 63n);
    expect(() => db.query("SELECT f()").get()).toThrow(
      new RangeError("BigInt value '9223372036854775808' is out of range"),
    );
  });

  it("arguments are what a column of the same value is, and `this` is undefined", () => {
    using db = new Database(":memory:");
    const calls = [];
    db.function("f", { varargs: true }, function (...args) {
      calls.push([this, ...args]);
    });
    const sql = "1, 1.5, 'a', '', x'0102', x'', NULL, 9007199254740993";
    const columns = db.query(`SELECT ${sql}`).values()[0];
    db.run(`SELECT f(${sql})`);
    expect(calls).toEqual([[undefined, ...columns]]);
    expect(columns).toEqual([1, 1.5, "a", "", new Uint8Array([1, 2]), new Uint8Array(0), null, 9007199254740992]);
  });

  it.each([
    [{}, {}, "number"],
    [{}, { safeIntegers: true }, "bigint"],
    [{}, { safeIntegers: false }, "number"],
    [{ safeIntegers: true }, {}, "bigint"],
    [{ safeIntegers: true }, { safeIntegers: undefined }, "bigint"],
    [{ safeIntegers: true }, { safeIntegers: false }, "number"],
  ])("new Database(%j) and function(%j) give an integer as a %s", (databaseOptions, options, type) => {
    using db = new Database(":memory:", databaseOptions);
    db.function("f", options, a => typeof a);
    db.aggregate("g", { ...options, step: (_, a) => typeof a });
    expect(db.query("SELECT f(1) AS f, g(1) AS g").get()).toEqual({ f: type, g: type });
  });

  it("the number of parameters is the number of arguments, and functions with other numbers live side by side", () => {
    using db = new Database(":memory:");
    db.function("f", () => "none");
    db.function("f", a => "one");
    db.function("f", (a, b, c) => "three");
    expect(db.query("SELECT f() AS a, f(1) AS b, f(1, 2, 3) AS c").get()).toEqual({ a: "none", b: "one", c: "three" });
    expect(() => db.query("SELECT f(1, 2)")).toThrow("wrong number of arguments to function f()");

    db.function("f", { varargs: true }, (...args) => "any " + args.length);
    expect(db.query("SELECT f(1) AS b, f(1, 2) AS d, f(1, 2, 3, 4) AS e").get()).toEqual({
      b: "one",
      d: "any 2",
      e: "any 4",
    });
    // Only parameters before the first default or rest parameter count.
    db.function("g", (a, b = 1, ...rest) => "g");
    expect(db.query("SELECT g(1) AS g").get()).toEqual({ g: "g" });
  });

  it("a function replaces the one with its name (in any case) and number of arguments, also for a prepared statement", () => {
    using db = new Database(":memory:");
    db.function("f", () => "first");
    const query = db.query("SELECT f() AS f, upper('a') AS u");
    expect(query.get()).toEqual({ f: "first", u: "A" });
    db.function("F", () => "second");
    db.function("upper", a => "mine");
    expect(query.get()).toEqual({ f: "second", u: "mine" });
    db.aggregate("f", { start: "third", step: () => {} });
    expect(query.get()).toEqual({ f: "third", u: "mine" });
    db.function("f", () => "fourth");
    expect(query.get()).toEqual({ f: "fourth", u: "mine" });
  });

  it("a function cannot be replaced while a statement is running", () => {
    using db = new Database(":memory:");
    db.function("f", () => 1);
    const rows = db.query("SELECT 1 UNION ALL SELECT 2").iterate();
    rows.next();
    expect(() => db.function("f", () => 2)).toThrow(
      expect.objectContaining({ name: "SQLiteError", code: "SQLITE_BUSY", message: "unable to delete/modify user-function due to active statements" }), // prettier-ignore
    );
    rows.return();
    expect(db.query("SELECT f() AS f").get()).toEqual({ f: 1 });
  });

  it("deterministic allows an index on the function", () => {
    using db = new Database(":memory:");
    db.run("CREATE TABLE t (a)");
    db.function("plain", a => a);
    db.function("pure", { deterministic: true }, a => a);
    expect(() => db.run("CREATE INDEX i ON t (plain(a))")).toThrow(
      "non-deterministic functions prohibited in index expressions",
    );
    db.run("CREATE INDEX i ON t (pure(a))");
    db.run("INSERT INTO t VALUES (1)");
    expect(db.query("SELECT a FROM t WHERE pure(a) = 1").all()).toEqual([{ a: 1 }]);
  });

  it("directOnly keeps the function out of views and triggers", () => {
    using db = new Database(":memory:");
    db.function("open", () => 1);
    db.function("direct", { directOnly: true }, () => 1);
    db.aggregate("directsum", { directOnly: true, start: 0, step: (sum, a) => sum + a });
    db.run(`
      CREATE TABLE t (a);
      CREATE TABLE log (a);
      CREATE VIEW ok AS SELECT open() AS a;
      CREATE VIEW v AS SELECT direct() AS a;
      CREATE VIEW w AS SELECT directsum(1) AS a;
      CREATE TRIGGER tr AFTER INSERT ON t BEGIN INSERT INTO log VALUES (direct()); END;
    `);
    expect(db.query("SELECT direct() AS a, directsum(2) AS b, (SELECT a FROM ok) AS c").get()).toEqual({
      a: 1,
      b: 2,
      c: 1,
    });
    expect(() => db.query("SELECT a FROM v")).toThrow("unsafe use of direct()");
    expect(() => db.query("SELECT a FROM w")).toThrow("unsafe use of directsum()");
    expect(() => db.run("INSERT INTO t VALUES (1)")).toThrow("unsafe use of direct()");
  });

  describe("what the function throws comes out of the call unchanged", () => {
    class MyError extends Error {}
    const thrown = [new MyError("mine"), "a string", 0, null, undefined, { an: "object" }];
    const how = {
      get: query => query.get(),
      all: query => query.all(),
      values: query => query.values(),
      raw: query => query.raw(),
      run: query => query.run(),
      iterate: query => [...query.iterate()],
      columnTypes: query => query.columnTypes,
    };

    it.each(Object.keys(how))("Statement#%s", name => {
      using db = new Database(":memory:");
      let value;
      let fail = true;
      db.function("f", () => {
        if (fail) throw value;
        return 1;
      });
      const query = db.prepare("SELECT f() AS f");
      for (value of thrown) {
        let caught = "nothing";
        try {
          how[name](query);
        } catch (error) {
          caught = error;
        }
        expect(caught).toBe(value);
      }
      fail = false;
      expect(query.get()).toEqual({ f: 1 });
    });

    it("Database#run, in any statement of the string", () => {
      using db = new Database(":memory:");
      const error = new MyError("mine");
      db.function("f", () => {
        throw error;
      });
      db.run("CREATE TABLE t (a)");
      let caught;
      try {
        db.run("INSERT INTO t VALUES (1); INSERT INTO t VALUES (f()); INSERT INTO t VALUES (3)");
      } catch (e) {
        caught = e;
      }
      expect(caught).toBe(error);
      expect(db.query("SELECT a FROM t").values()).toEqual([[1]]);
    });

    it("in a later row: the rows before it are lost, the function is not called again, and the statement works afterwards", () => {
      using db = new Database(":memory:");
      db.run("CREATE TABLE t (a)");
      db.run("INSERT INTO t VALUES (1), (2), (3), (4), (5)");
      const seen = [];
      let failAt = 3;
      db.function("f", a => {
        seen.push(a);
        if (a === failAt) throw new MyError("row " + a);
        return a;
      });
      const query = db.query("SELECT f(a) AS a FROM t");
      expect(() => query.all()).toThrow(new MyError("row 3"));
      expect(seen).toEqual([1, 2, 3]);

      const rows = [];
      expect(() => {
        for (const row of query.iterate()) rows.push(row.a);
      }).toThrow(new MyError("row 3"));
      expect(rows).toEqual([1, 2]);

      failAt = 0;
      expect(query.values()).toEqual([[1], [2], [3], [4], [5]]);
    });

    it("db.transaction() rolls back", () => {
      using db = new Database(":memory:");
      db.run("CREATE TABLE t (a)");
      db.function("f", a => {
        if (a === 2) throw new MyError("two");
        return a;
      });
      const insert = db.prepare("INSERT INTO t VALUES (f(?))");
      expect(() => db.transaction(() => [1, 2, 3].forEach(a => insert.run(a)))()).toThrow(new MyError("two"));
      expect(db.inTransaction).toBe(false);
      expect(db.query("SELECT count(*) AS n FROM t").get()).toEqual({ n: 0 });
    });
  });

  describe("while a function runs, every call on its connection throws", () => {
    const calls = {
      "the running statement: get()": ({ running }) => running.get(),
      "the running statement: all()": ({ running }) => running.all(),
      "the running statement: run()": ({ running }) => running.run(),
      "the running statement: values()": ({ running }) => running.values(),
      "the running statement: raw()": ({ running }) => running.raw(),
      "the running statement: iterate()": ({ running }) => running.iterate().next(),
      "the running statement: finalize()": ({ running }) => running.finalize(),
      "the running statement: as()": ({ running }) => running.as(class {}),
      "the running statement: columnNames": ({ running }) => running.columnNames,
      "the running statement: columnTypes": ({ running }) => running.columnTypes,
      "the running statement: safeIntegers()": ({ running }) => running.safeIntegers(true),
      "another statement: get()": ({ other }) => other.get(),
      "another statement: finalize()": ({ other }) => other.finalize(),
      "db.run()": ({ db }) => db.run("SELECT 1"),
      "db.prepare()": ({ db }) => db.prepare("SELECT 1"),
      "db.query() of new text": ({ db }) => db.query("SELECT 'new'"),
      "db.close()": ({ db }) => db.close(),
      "db.close(true)": ({ db }) => db.close(true),
      "db.function()": ({ db }) => db.function("g", () => 1),
      "db.aggregate()": ({ db }) => db.aggregate("g", { step: () => 1 }),
      "db.serialize()": ({ db }) => db.serialize(),
      "db.inTransaction": ({ db }) => db.inTransaction,
      "db.transaction()()": ({ db }) => db.transaction(() => 1)(),
      "db.fileControl()": ({ db }) => db.fileControl(constants.SQLITE_FCNTL_PERSIST_WAL, 0),
      "db.loadExtension()": ({ db }) => db.loadExtension("nothing"),
    };

    it.each(Object.keys(calls))("%s", name => {
      using db = new Database(":memory:");
      db.run("CREATE TABLE t (a)");
      db.run("INSERT INTO t VALUES (1), (2), (3)");
      const other = db.prepare("SELECT 'other' AS a");
      const parked = db.prepare("SELECT a FROM t").iterate();
      expect(parked.next().value).toEqual({ a: 1 });

      const errors = [];
      const attempt = () => {
        try {
          calls[name]({ db, running, other });
          errors.push("no error");
        } catch (error) {
          errors.push(error);
        }
      };
      db.function("f", a => (attempt(), a * 10));
      db.aggregate("g", { start: 0, step: (sum, a) => (attempt(), sum + a), result: sum => (attempt(), sum) });

      let running = db.prepare("SELECT f(a) AS a FROM t");
      expect(running.all()).toEqual([{ a: 10 }, { a: 20 }, { a: 30 }]);
      running = db.prepare("SELECT g(a) AS a FROM t");
      expect(running.get()).toEqual({ a: 6 });
      expect(errors).toEqual(Array(7).fill(new TypeError(busy)));

      // Nothing of it happened.
      expect(other.get()).toEqual({ a: "other" });
      expect(parked.next().value).toEqual({ a: 2 });
    });

    it.each(["next", "return"])("%s() of an iterator that is under way throws, which ends the iterator", method => {
      using db = new Database(":memory:");
      const parked = db.prepare("SELECT 1 AS a UNION ALL SELECT 2 UNION ALL SELECT 3").iterate();
      expect(parked.next().value).toEqual({ a: 1 });
      db.function("f", () => parked[method]());
      expect(() => db.run("SELECT f()")).toThrow(new TypeError(busy));
      expect(parked.next()).toEqual({ value: undefined, done: true });
    });

    it("another connection works", () => {
      using db = new Database(":memory:");
      using second = new Database(":memory:");
      second.function("twice", a => a * 2);
      db.function("f", a => second.query("SELECT twice(?) AS a").get(a).a);
      expect(db.query("SELECT f(21) AS a").get()).toEqual({ a: 42 });
    });

    it("the connection is free again after a function threw", () => {
      using db = new Database(":memory:");
      db.function("f", () => {
        throw new Error("thrown");
      });
      expect(() => db.run("SELECT f()")).toThrow("thrown");
      expect(db.query("SELECT 1 AS a").get()).toEqual({ a: 1 });
    });
  });

  describe("the database keeps the function alive, and nothing else", () => {
    it("after the caller dropped it, with a collection between and inside the calls", () => {
      using db = new Database(":memory:");
      db.run("CREATE TABLE t (a)");
      db.run("INSERT INTO t VALUES (1), (2), (3)");
      (() => {
        const captured = { text: "captured" };
        db.function("f", a => (Bun.gc(true), captured.text + a));
        db.aggregate("g", {
          start: () => (Bun.gc(true), []),
          step: (list, a) => (Bun.gc(true), void list.push(captured.text + a)),
          result: list => (Bun.gc(true), list.join()),
        });
      })();
      Bun.gc(true);
      const query = db.query("SELECT f(a) AS a FROM t");
      expect(query.values()).toEqual([["captured1"], ["captured2"], ["captured3"]]);
      Bun.gc(true);
      expect(query.values()).toEqual([["captured1"], ["captured2"], ["captured3"]]);
      expect(db.query("SELECT g(a) AS a FROM t").get()).toEqual({ a: "captured1,captured2,captured3" });
    });

    it("a statement whose Database was dropped can still call it", () => {
      const query = (() => {
        const db = new Database(":memory:");
        const captured = { text: "captured" };
        db.function("f", () => captured.text);
        return db.prepare("SELECT f() AS a");
      })();
      Bun.gc(true);
      expect(query.get()).toEqual({ a: "captured" });
      query.finalize();
    });

    it("a prepared statement can still call it after close(false)", () => {
      const db = new Database(":memory:");
      db.function("f", () => "called");
      const query = db.prepare("SELECT f() AS a");
      db.close(false);
      Bun.gc(true);
      expect(query.get()).toEqual({ a: "called" });
      query.finalize();
    });

    it("functions that were replaced, and databases that their own functions hold, are collected", () => {
      // heapStats() counts cells by their native class.
      const Captured = Bun.Glob;
      const globs = () => (Bun.gc(true), heapStats().objectTypeCounts.Glob ?? 0);
      const before = globs();
      using db = new Database(":memory:");
      for (let i = 0; i < 100; i++) {
        const captured = new Captured("*");
        db.function("f", () => captured);
        db.aggregate("g", {
          start: () => captured,
          step: () => captured,
          inverse: () => captured,
          result: () => captured,
        });
      }
      // The last one is in use.
      expect(globs() - before).toBeWithin(1, 10);

      for (let i = 0; i < 100; i++) {
        const dropped = new Database(":memory:");
        const captured = new Captured("*");
        dropped.function("f", () => [dropped, captured]);
        dropped.aggregate("g", { step: () => [dropped, captured] });
      }
      expect(globs() - before).toBeWithin(1, 10);

      const closed = [];
      for (let i = 0; i < 100; i++) {
        closed.push(new Database(":memory:"));
        const captured = new Captured("*");
        closed[i].function("f", () => captured);
        closed[i].close();
      }
      expect(globs() - before).toBeWithin(1, 10);
      expect(closed).toHaveLength(100);
    });
  });

  it.each([
    [[], "Expected first argument to be a string"],
    [[1, () => {}], "Expected first argument to be a string"],
    [["f"], "Expected last argument to be a function"],
    [["f", {}], "Expected last argument to be a function"],
    [["f", {}, "fn"], "Expected last argument to be a function"],
    [["f", 1, () => {}], "Expected second argument to be an options object"],
    [["", () => {}], "User-defined function name cannot be an empty string"],
    [["f", { varargs: 1 }, () => {}], 'Expected the "varargs" option to be a boolean'],
    [["f", { deterministic: "yes" }, () => {}], 'Expected the "deterministic" option to be a boolean'],
    [["f", { directOnly: null }, () => {}], 'Expected the "directOnly" option to be a boolean'],
    [["f", { safeIntegers: 0 }, () => {}], 'Expected the "safeIntegers" option to be a boolean'],
    [
      ["f", Object.defineProperty(() => {}, "length", { value: 1.5 })],
      "Expected function.length to be a positive integer",
    ],
    [
      ["f", Object.defineProperty(() => {}, "length", { value: -1 })],
      "Expected function.length to be a positive integer",
    ],
  ])("function(...%j) is a TypeError", (args, message) => {
    using db = new Database(":memory:");
    expect(() => db.function(...args)).toThrow(new TypeError(message));
  });

  it("SQLite refuses a name over 255 bytes and more arguments than it allows", () => {
    using db = new Database(":memory:");
    const misuse = expect.objectContaining({ name: "SQLiteError", code: "SQLITE_MISUSE", message: "bad parameter or other API misuse" }); // prettier-ignore
    expect(() => db.function("é".repeat(128), () => 1)).toThrow(misuse);
    expect(() => db.aggregate("é".repeat(128), { step: () => 1 })).toThrow(misuse);
    expect(() =>
      db.function(
        "f",
        Object.defineProperty(() => 1, "length", { value: 100_000 }),
      ),
    ).toThrow(misuse);
    db.function("é".repeat(127), () => 1);
    expect(() => db.function("a\0b", () => 1)).toThrow(expect.objectContaining({ code: "ERR_INVALID_ARG_VALUE" }));
  });

  it("throws on a closed database", () => {
    const db = new Database(":memory:");
    db.close();
    expect(() => db.function("f", () => 1)).toThrow("Database has closed");
    expect(() => db.aggregate("f", { step: () => 1 })).toThrow("Database has closed");
  });

  it.each(["function", "step", "result", "hook", "transform"])("process.exit() in a %s callback exits", async where => {
    using dir = tempDir("sqlite-exit-in-callback", {});
    const src = `
      const { Database } = require("bun:sqlite");
      const db = new Database(${JSON.stringify(path.join(String(dir), "exit"))} + process.env.BUN_DESTRUCT_VM_ON_EXIT);
      db.run("PRAGMA journal_mode = WAL");
      db.run("CREATE TABLE t (a)");
      db.run("INSERT INTO t VALUES (1), (2)");
      const exit = where => { if (where === ${JSON.stringify(where)}) { console.log("exiting"); process.exit(7); } };
      db.function("f", a => (exit("function"), a));
      db.aggregate("g", { start: 0, step: (sum, a) => (exit("step"), sum + a), result: sum => (exit("result"), sum) });
      db.onInsert = () => exit("hook");
      globalThis.kept = [db.prepare("SELECT a FROM t"), db.prepare("INSERT INTO t SELECT g(f(a)) FROM t")];
      kept[0].iterate().next();
      kept[1].run();
      const transform = { column: name => (exit("transform"), name) };
      const rows = new Bun.SQL({ adapter: "sqlite", filename: ":memory:", transform }).unsafe("SELECT 1 AS a");
      rows.then(() => console.log("not reached"));
    `;
    for (const destructVM of ["0", "1"]) {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", src],
        env: { ...bunEnv, BUN_DESTRUCT_VM_ON_EXIT: destructVM },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({ stdout, stderr, exitCode }).toEqual({ stdout: "exiting\n", stderr: "", exitCode: 7 });
    }
  });

  it.each([
    ["function", `db.function("forever", forever); db.run("SELECT forever()");`],
    ["hook", `db.onInsert = forever; db.run("CREATE TABLE t (a); INSERT INTO t VALUES (1), (2)");`],
  ])("terminating a Worker that is inside a %s ends it", async (_, src) => {
    const worker = new Worker(
      `
        const { Database } = require("bun:sqlite");
        const db = new Database(":memory:");
        const forever = () => { postMessage("inside"); for (;;); };
        ${src}
      `,
      { eval: true },
    );
    await new Promise(resolve => worker.once("message", resolve));
    expect(await worker.terminate()).toBeNumber();
  });
});

describe("db.aggregate()", () => {
  const numbers = db => {
    db.run("CREATE TABLE t (k, a)");
    db.run("INSERT INTO t VALUES ('x', 1), ('x', 2), ('y', 3), ('y', 4), ('y', 5)");
    return db;
  };

  it("returns the database", () => {
    using db = new Database(":memory:");
    expect(db.aggregate("g", { step: () => 1 })).toBe(db);
  });

  it.each([
    ["start is the first accumulator", { start: 100, step: (sum, a) => sum + a }, 115, 100],
    ["without start it is null", { step: (sum, a) => sum + a }, 15, null],
    ["start: undefined is no start", { start: undefined, step: (sum, a) => sum + a }, 15, null],
    ["a start function makes it", { start: () => 1000, step: (sum, a) => sum + a }, 1015, 1000],
    [
      "result makes the result of it",
      { start: 0, step: (sum, a) => sum + a, result: sum => "sum " + sum },
      "sum 15",
      "sum 0",
    ],
    ["a step that returns undefined keeps it", { start: () => [], step: (list, a) => void list.push(a), result: list => list.join() }, "1,2,3,4,5", ""], // prettier-ignore
    ["a step that returns null replaces it", { start: 1, step: (_, a) => null }, null, 1],
  ])("%s", (_, options, all, none) => {
    using db = numbers(new Database(":memory:"));
    db.aggregate("g", options);
    expect(db.query("SELECT g(a) AS g FROM t").get()).toEqual({ g: all });
    expect(db.query("SELECT g(a) AS g FROM t WHERE 0").get()).toEqual({ g: none });
  });

  it("each group has an accumulator of its own, and `this` is undefined in every callback", () => {
    using db = numbers(new Database(":memory:"));
    const receivers = new Set();
    let started = 0;
    db.aggregate("g", {
      start() {
        receivers.add(this);
        return [++started];
      },
      step(list, a) {
        receivers.add(this);
        list.push(a);
      },
      inverse(list) {
        receivers.add(this);
        list.splice(1, 1);
      },
      result(list) {
        receivers.add(this);
        return list.join();
      },
    });
    expect(db.query("SELECT k, g(a) AS g FROM t GROUP BY k ORDER BY k").values()).toEqual([["x", "1,1,2"], ["y", "2,3,4,5"]]); // prettier-ignore
    expect(db.query("SELECT g(a) OVER (ORDER BY a ROWS 1 PRECEDING) AS g FROM t").values()).toEqual([["3,1"], ["3,1,2"], ["3,2,3"], ["3,3,4"], ["3,4,5"]]); // prettier-ignore
    expect([...receivers]).toEqual([undefined]);
  });

  it("with inverse it is a window function; result is called for each row and leaves the accumulator alone", () => {
    using db = numbers(new Database(":memory:"));
    const calls = { step: 0, inverse: 0, result: 0 };
    db.aggregate("g", {
      start: 0,
      step: (sum, a) => (calls.step++, sum + a),
      inverse: (sum, a) => (calls.inverse++, sum - a),
      result: sum => (calls.result++, sum * 10),
    });
    const sql = "SELECT g(a) OVER (ORDER BY a ROWS BETWEEN 1 PRECEDING AND 1 FOLLOWING) AS g FROM t";
    expect(db.query(sql).values()).toEqual([[30], [60], [90], [120], [90]]);
    expect(calls).toEqual({ step: 5, inverse: expect.any(Number), result: 5 });
    expect(calls.inverse).toBeGreaterThan(0);
    expect(db.query("SELECT g(a) AS g FROM t").get()).toEqual({ g: 150 });
  });

  it("without inverse it is not a window function", () => {
    using db = numbers(new Database(":memory:"));
    db.aggregate("g", { start: 0, step: (sum, a) => sum + a });
    expect(() => db.query("SELECT g(a) OVER (ORDER BY a) FROM t")).toThrow("g() may not be used as a window function");
  });

  it("the parameters of step and inverse after the accumulator are the arguments", () => {
    using db = numbers(new Database(":memory:"));
    db.aggregate("none", { start: 0, step: count => count + 1 });
    db.aggregate("noparameters", { start: 0, step: () => 1 });
    db.aggregate("two", { start: 0, step: (sum, a, b) => sum + a * b });
    db.aggregate("widest", { start: 0, step: (sum, a) => sum + a, inverse: (sum, a, b) => sum - a });
    db.aggregate("anything", { varargs: true, start: 0, step: (sum, ...args) => sum + args.length });
    expect(db.query("SELECT none() AS a, noparameters() AS b, two(a, 2) AS c, widest(a, 0) AS d, anything() + anything(1, 2, 3) AS e FROM t").get()).toEqual({ a: 5, b: 1, c: 30, d: 15, e: 15 }); // prettier-ignore
    expect(() => db.query("SELECT two(a) FROM t")).toThrow("wrong number of arguments to function two()");
  });

  describe("what a callback throws comes out of the call unchanged", () => {
    it.each(["start", "step", "inverse", "result"])("%s", where => {
      using db = numbers(new Database(":memory:"));
      const error = new RangeError("from " + where);
      const calls = [];
      let fail = true;
      const callback = (name, value) => {
        calls.push(name);
        if (fail && name === where) throw error;
        return value;
      };
      db.aggregate("g", {
        start: () => callback("start", 0),
        step: (sum, a) => callback("step", sum + a),
        inverse: (sum, a) => callback("inverse", sum - a),
        result: sum => callback("result", sum),
      });
      const query = db.prepare("SELECT g(a) OVER (ORDER BY a ROWS 1 PRECEDING) AS g FROM t");
      for (const run of [
        () => query.all(),
        () => [...query.iterate()],
        () => query.run(),
        () => db.run(String(query)),
      ]) {
        calls.length = 0;
        let caught;
        try {
          run();
        } catch (e) {
          caught = e;
        }
        expect(caught).toBe(error);
        // No callback runs after the one that threw.
        expect(calls.at(-1)).toBe(where);
        expect(calls.filter(name => name === where)).toHaveLength(1);
      }
      fail = false;
      expect(query.values()).toEqual([[1], [3], [5], [7], [9]]);
    });
  });

  it("a result that SQLite cannot hold is a TypeError", () => {
    using db = numbers(new Database(":memory:"));
    db.aggregate("list", { start: () => [], step: (list, a) => void list.push(a) });
    db.aggregate("made", { step: (_, a) => 1, result: () => ({}) });
    expect(() => db.query("SELECT list(a) FROM t").get()).toThrow(new TypeError("User-defined function list() returned an invalid value")); // prettier-ignore
    expect(() => db.query("SELECT made(a) FROM t").get()).toThrow(new TypeError("User-defined function made() returned an invalid value")); // prettier-ignore
  });

  describe("ending a window query that is under way calls nothing", () => {
    it.each([
      ["return()", ({ rows }) => rows.return()],
      ["finalize()", ({ query }) => query.finalize()],
      ["running the statement again", ({ query }) => query.get()],
      ["close()", ({ db }) => db.close()],
      ["close(true)", ({ db }) => db.close(true)],
    ])("%s", (_, end) => {
      const db = numbers(new Database(":memory:"));
      const calls = [];
      db.aggregate("g", {
        start: () => (calls.push("start"), 0),
        step: (sum, a) => (calls.push("step"), sum + a),
        inverse: (sum, a) => (calls.push("inverse"), sum - a),
        result: sum => (calls.push("result"), sum),
      });
      const query = db.query("SELECT g(a) OVER (ORDER BY a ROWS BETWEEN 1 PRECEDING AND 1 FOLLOWING) AS g FROM t");
      const rows = query.iterate();
      expect(rows.next().value).toEqual({ g: 3 });
      expect(rows.next().value).toEqual({ g: 6 });
      calls.length = 0;
      end({ db, query, rows });
      expect(calls.filter(name => name !== "start" && name !== "step" && name !== "result")).toEqual([]);
      if (!_.startsWith("running")) expect(calls).toEqual([]);
      db.close(true);
    });

    it("so does collecting it", () => {
      using db = numbers(new Database(":memory:"));
      let calls = 0;
      db.aggregate("g", { start: 0, step: (sum, a) => (calls++, sum + a), inverse: (sum, a) => (calls++, sum - a), result: sum => (calls++, sum) }); // prettier-ignore
      const statements = () => (Bun.gc(true), heapStats().objectTypeCounts.SQLStatement ?? 0);
      const statementsBefore = statements();
      for (let i = 0; i < 100; i++)
        db.prepare("SELECT g(a) OVER (ORDER BY a ROWS 1 PRECEDING) AS g FROM t").iterate().next();
      const callsBefore = calls;
      expect(statements() - statementsBefore).toBeLessThan(10);
      expect(calls).toBe(callsBefore);
    });
  });

  it.each([
    [[], "Expected first argument to be a string"],
    [["g"], "Expected second argument to be an options object"],
    [["g", null], "Expected second argument to be an options object"],
    [["g", () => {}], "Expected second argument to be an options object"],
    [["", { step: () => {} }], "User-defined function name cannot be an empty string"],
    [["g", {}], 'Missing required option "step"'],
    [["g", { step: null }], 'Missing required option "step"'],
    [["g", { step: 1 }], 'Expected the "step" option to be a function'],
    [["g", { step: () => {}, inverse: "no" }], 'Expected the "inverse" option to be a function'],
    [["g", { step: () => {}, result: {} }], 'Expected the "result" option to be a function'],
    [["g", { step: () => {}, varargs: 1 }], 'Expected the "varargs" option to be a boolean'],
    [["g", { step: () => {}, deterministic: 1 }], 'Expected the "deterministic" option to be a boolean'],
    [["g", { step: () => {}, directOnly: 1 }], 'Expected the "directOnly" option to be a boolean'],
    [["g", { step: () => {}, safeIntegers: 1 }], 'Expected the "safeIntegers" option to be a boolean'],
    [
      ["g", { step: Object.defineProperty(() => {}, "length", { value: "1" }) }],
      "Expected function.length to be a positive integer",
    ],
  ])("aggregate(...%j) is a TypeError", (args, message) => {
    using db = new Database(":memory:");
    expect(() => db.aggregate(...args)).toThrow(new TypeError(message));
  });

  it("each option is read once, before anything is defined", () => {
    using db = new Database(":memory:");
    const reads = [];
    const options = new Proxy({ start: 0, step: (sum, a) => sum + a }, { get: (target, key) => (reads.push(key), target[key]) }); // prettier-ignore
    db.aggregate("g", options);
    expect(reads).toEqual([
      "start",
      "step",
      "inverse",
      "result",
      "safeIntegers",
      "deterministic",
      "directOnly",
      "varargs",
    ]);
  });
});

describe("db.onInsert, db.onUpdate and db.onDelete", () => {
  const busy = "This database connection is busy executing a query";
  const names = ["onInsert", "onUpdate", "onDelete"];
  // [hook, `this` and the first argument are the Database, table, rowid, schema]
  const record = db => {
    const calls = [];
    for (const name of names) {
      db[name] = function (database, ...rest) {
        calls.push([name, this === db && database === db, ...rest]);
      };
    }
    return calls;
  };
  const table = db => (db.run("CREATE TABLE t (id INTEGER PRIMARY KEY, a)"), db);

  it("each one is called for its kind of change, with the Database, the table, the rowid and the schema", () => {
    using db = table(new Database(":memory:"));
    const calls = record(db);
    db.run("INSERT INTO t VALUES (7, 'a'), (8, 'b')");
    db.run("UPDATE t SET a = 'c' WHERE id = 8");
    db.run("UPDATE t SET id = 9 WHERE id = 8");
    db.run("DELETE FROM t WHERE id = 7");
    db.run("SELECT * FROM t");
    expect(calls).toEqual([
      ["onInsert", true, "t", 7, "main"],
      ["onInsert", true, "t", 8, "main"],
      ["onUpdate", true, "t", 8, "main"],
      ["onUpdate", true, "t", 9, "main"],
      ["onDelete", true, "t", 7, "main"],
    ]);
  });

  it.each([
    ["Database#run", (db, sql) => db.run(sql)],
    ["Database#run, in a later statement of the string", (db, sql) => db.run("SELECT 1; " + sql)],
    ["Statement#run", (db, sql) => db.prepare(sql).run()],
    ["Statement#get", (db, sql) => db.prepare(sql + " RETURNING id").get()],
    ["Statement#all", (db, sql) => db.query(sql + " RETURNING id").all()],
    ["Statement#values", (db, sql) => db.query(sql + " RETURNING id").values()],
    ["Statement#iterate", (db, sql) => [...db.query(sql + " RETURNING id").iterate()]],
    ["db.transaction()", (db, sql) => db.transaction(() => db.run(sql))()],
  ])("%s", (_, run) => {
    using db = table(new Database(":memory:"));
    const calls = record(db);
    run(db, "INSERT INTO t VALUES (1, 'a'), (2, 'b')");
    expect(calls).toEqual([
      ["onInsert", true, "t", 1, "main"],
      ["onInsert", true, "t", 2, "main"],
    ]);
  });

  it("the changes of a trigger, in a temporary table and in an attached database", () => {
    using db = table(new Database(":memory:"));
    db.run(`
      ATTACH ':memory:' AS other;
      CREATE TABLE other."tablé" (a);
      CREATE TEMP TABLE scratch (a);
      CREATE TABLE log (a);
      CREATE TRIGGER tr AFTER DELETE ON t BEGIN INSERT INTO log VALUES (old.id); END;
      INSERT INTO t VALUES (5, 'a');
    `);
    const calls = record(db);
    db.run(`INSERT INTO other."tablé" VALUES (1)`);
    db.run("INSERT INTO scratch VALUES (1)");
    db.run("DELETE FROM t WHERE id = 5");
    expect(calls).toEqual([
      ["onInsert", true, "tablé", 1, "other"],
      ["onInsert", true, "scratch", 1, "temp"],
      ["onDelete", true, "t", 5, "main"],
      ["onInsert", true, "log", 1, "main"],
    ]);
  });

  it("a change is reported when it is made: one that is rolled back has been reported", () => {
    using db = table(new Database(":memory:"));
    const calls = record(db);
    expect(() =>
      db.transaction(() => {
        db.run("INSERT INTO t VALUES (1, 'a')");
        throw new Error("rolled back");
      })(),
    ).toThrow("rolled back");
    expect(() => db.run("INSERT INTO t VALUES (2, 'a'), (2, 'b')")).toThrow("UNIQUE constraint failed");
    expect(calls).toEqual([
      ["onInsert", true, "t", 1, "main"],
      ["onInsert", true, "t", 2, "main"],
    ]);
    expect(db.query("SELECT count(*) AS n FROM t").get()).toEqual({ n: 0 });
  });

  it.each([
    [
      "a table WITHOUT ROWID",
      "INSERT INTO w VALUES (2); UPDATE w SET k = 3 WHERE k = 2; DELETE FROM w WHERE k = 3",
      [],
    ],
    ["DELETE without WHERE, which empties the table in one step", "DELETE FROM t", []],
    ["the row that INSERT OR REPLACE removes", "INSERT OR REPLACE INTO t VALUES (1, 'new')", [["onInsert", true, "t", 1, "main"]]], // prettier-ignore
    ["a change by another connection", "SELECT 1", []],
  ])("SQLite does not report %s", (_, sql, expected) => {
    using dir = tempDir("sqlite-update-hook", {});
    using db = table(new Database(path.join(String(dir), "x.sqlite")));
    using second = new Database(db.filename);
    db.run("CREATE TABLE w (k PRIMARY KEY) WITHOUT ROWID; INSERT INTO w VALUES (1); INSERT INTO t VALUES (1, 'a')");
    const calls = record(db);
    second.run("INSERT INTO t VALUES (100, 'second')");
    db.run(sql);
    db.run("INSERT INTO t VALUES (200, 'reported')");
    expect(calls).toEqual([...expected, ["onInsert", true, "t", 200, "main"]]);
  });

  it.each([
    [{}, 1, 2 ** 53],
    [{ safeIntegers: false }, 1, 2 ** 53],
    [{ safeIntegers: true }, 1n, 2n ** 53n + 1n],
  ])("new Database(%j) gives the rowid as %p", (options, small, large) => {
    using db = table(new Database(":memory:", options));
    const rowids = [];
    db.onInsert = (_, __, rowid) => void rowids.push(rowid);
    db.run("INSERT INTO t VALUES (1, 'a'), (9007199254740993, 'b')");
    expect(rowids).toEqual([small, large]);
  });

  it("reads back what was set; null and undefined remove it, and the others stay", () => {
    using db = table(new Database(":memory:"));
    expect(names.map(name => db[name])).toEqual([null, null, null]);
    expect(Object.keys(db)).not.toContainAnyValues(names);

    const calls = record(db);
    const hooks = names.map(name => db[name]);
    expect(hooks.map(hook => typeof hook)).toEqual(["function", "function", "function"]);
    expect(new Set(hooks).size).toBe(3);

    db.onInsert = null;
    db.onDelete = undefined;
    expect(names.map(name => db[name])).toEqual([null, hooks[1], null]);
    db.run("INSERT INTO t VALUES (1, 'a'); UPDATE t SET a = 'b'; DELETE FROM t WHERE id = 1");
    expect(calls).toEqual([["onUpdate", true, "t", 1, "main"]]);

    db.onUpdate = null;
    db.run("INSERT INTO t VALUES (1, 'a'); UPDATE t SET a = 'b'; DELETE FROM t WHERE id = 1");
    expect(calls).toHaveLength(1);

    db.onDelete = hooks[2];
    db.run("INSERT INTO t VALUES (1, 'a'); UPDATE t SET a = 'b'; DELETE FROM t WHERE id = 1");
    expect(calls.slice(1)).toEqual([["onDelete", true, "t", 1, "main"]]);
  });

  it.each([[1], ["f"], [{}], [[]], [true], [Symbol("s")]])(
    "%p is not a hook, and the one that was set stays",
    value => {
      using db = table(new Database(":memory:"));
      const hook = () => {};
      for (const name of names) {
        db[name] = hook;
        expect(() => (db[name] = value)).toThrow(new TypeError("Expected a function or null"));
        expect(db[name]).toBe(hook);
      }
    },
  );

  it("anything callable is a hook, and what it returns is ignored", () => {
    using db = table(new Database(":memory:"));
    const calls = [];
    db.onInsert = new Proxy(() => {}, { apply: (_, __, args) => (calls.push(["proxy", args[1]]), {}) });
    db.onUpdate = ((prefix, _, name) => (calls.push([prefix, name]), Symbol("ignored"))).bind(null, "bound");
    db.onDelete = async (_, name) => void calls.push(["async", name]);
    db.run("INSERT INTO t VALUES (1, 'a'); UPDATE t SET a = 'b'; DELETE FROM t WHERE id = 1");
    expect(calls).toEqual([["proxy", "t"], ["bound", "t"], ["async", "t"]]); // prettier-ignore
  });

  it("each Database has its own", () => {
    using first = table(new Database(":memory:"));
    using second = table(new Database(":memory:"));
    const firstCalls = record(first);
    const secondCalls = record(second);
    first.run("INSERT INTO t VALUES (1, 'a')");
    second.run("INSERT INTO t VALUES (2, 'a')");
    second.onInsert = null;
    first.run("INSERT INTO t VALUES (3, 'a')");
    second.run("INSERT INTO t VALUES (4, 'a')");
    expect(firstCalls.map(call => call[3])).toEqual([1, 3]);
    expect(secondCalls.map(call => call[3])).toEqual([2]);
  });

  describe("while a hook runs, every call on its connection throws", () => {
    it.each(
      Object.entries({
        "the running statement: run()": ({ running }) => running.run(9, "x"),
        "the running statement: finalize()": ({ running }) => running.finalize(),
        "another statement: get()": ({ other }) => other.get(),
        "db.run()": ({ db }) => db.run("SELECT 1"),
        "db.prepare()": ({ db }) => db.prepare("SELECT 1"),
        "db.close()": ({ db }) => db.close(),
        "db.close(true)": ({ db }) => db.close(true),
        "db.inTransaction": ({ db }) => db.inTransaction,
        "db.function()": ({ db }) => db.function("f", () => 1),
        "db.onInsert": ({ db }) => db.onInsert,
        "db.onInsert = null": ({ db }) => (db.onInsert = null),
        "db.onDelete = a function": ({ db }) => (db.onDelete = () => {}),
      }),
    )("%s", (_, call) => {
      using db = table(new Database(":memory:"));
      const other = db.prepare("SELECT count(*) AS n FROM t");
      const running = db.prepare("INSERT INTO t VALUES (?, ?)");
      const errors = [];
      db.onInsert = () => {
        try {
          call({ db, running, other });
          errors.push("no error");
        } catch (error) {
          errors.push(error);
        }
      };
      expect(running.run(1, "a")).toEqual({ changes: 1, lastInsertRowid: 1 });
      expect(errors).toEqual([new TypeError(busy)]);
      expect(other.get()).toEqual({ n: 1 });
      expect(db.onDelete).toBeNull();
    });

    it("another connection works, and so does this one once the statement has ended", async () => {
      using db = table(new Database(":memory:"));
      using second = table(new Database(":memory:"));
      const { promise, resolve } = Promise.withResolvers();
      db.onInsert = (_, name, rowid) => {
        second.run("INSERT INTO t VALUES (?, ?)", rowid, name);
        queueMicrotask(() => resolve(db.query("SELECT a FROM t WHERE id = ?").get(rowid)));
      };
      db.run("INSERT INTO t VALUES (3, 'mine')");
      expect(second.query("SELECT * FROM t").all()).toEqual([{ id: 3, a: "t" }]);
      expect(await promise).toEqual({ a: "mine" });
    });
  });

  describe.concurrent("what a hook throws", () => {
    async function run(src) {
      await using proc = Bun.spawn({ cmd: [bunExe(), "-e", src], env: bunEnv, stdout: "pipe", stderr: "pipe" });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      return { stdout: stdout.trim(), stderr, exitCode };
    }
    const prelude = /* js */ `
      const { Database } = require("bun:sqlite");
      const db = new Database(":memory:");
      db.run("CREATE TABLE t (id INTEGER PRIMARY KEY)");
      const log = [];
      db.onInsert = (_, table, rowid) => {
        log.push("hook " + rowid);
        if (rowid !== 2) throw new RangeError("thrown for " + rowid);
      };
    `;

    it("is an uncaught exception, and the statement goes on", async () => {
      const src = /* js */ `
        ${prelude}
        process.on("uncaughtException", (error, origin) => {
          let busy;
          try { db.run("SELECT 1"); } catch (e) { busy = e.message; }
          log.push([error.name, error.message, origin, busy].join(": "));
        });
        log.push(JSON.stringify(db.run("INSERT INTO t VALUES (1), (2), (3)")));
        log.push(JSON.stringify(db.prepare("INSERT INTO t VALUES (4) RETURNING id").all()));
        log.push(JSON.stringify(db.query("SELECT count(*) AS n FROM t").get()));
        console.log(log.join("\\n"));
      `;
      expect(await run(src)).toEqual({
        stdout: [
          "hook 1",
          `RangeError: thrown for 1: uncaughtException: ${busy}`,
          "hook 2",
          "hook 3",
          `RangeError: thrown for 3: uncaughtException: ${busy}`,
          '{"changes":3,"lastInsertRowid":3}',
          "hook 4",
          `RangeError: thrown for 4: uncaughtException: ${busy}`,
          '[{"id":4}]',
          '{"n":4}',
        ].join("\n"),
        stderr: "",
        exitCode: 0,
      });
    });

    it("ends the process with code 1 when nothing listens for it", async () => {
      const src = /* js */ `
        ${prelude}
        process.on("exit", code => console.log("exit", code));
        console.log(JSON.stringify(db.run("INSERT INTO t VALUES (1)")));
        setTimeout(() => console.log("not reached"), 0);
      `;
      const { stdout, stderr, exitCode } = await run(src);
      expect(stderr).toContain("RangeError: thrown for 1");
      expect({ stdout, exitCode }).toEqual({ stdout: '{"changes":1,"lastInsertRowid":1}\nexit 1', exitCode: 1 });
    });
  });

  describe("the database keeps a hook alive, and nothing else", () => {
    it("after the caller dropped it, with a collection between and inside the calls", () => {
      using db = table(new Database(":memory:"));
      const calls = [];
      (() => {
        const captured = { text: "captured" };
        db.onInsert = (_, name, rowid) => (Bun.gc(true), void calls.push(captured.text + name + rowid));
      })();
      Bun.gc(true);
      db.run("INSERT INTO t VALUES (1, 'a'), (2, 'b')");
      Bun.gc(true);
      db.run("INSERT INTO t VALUES (3, 'c')");
      expect(calls).toEqual(["capturedt1", "capturedt2", "capturedt3"]);
    });

    it("a statement whose Database was dropped still calls it, with that Database", () => {
      const calls = [];
      const insert = (() => {
        const db = table(new Database(":memory:"));
        db.onInsert = (database, name) => void calls.push([database.filename, database instanceof Database, name]);
        return db.prepare("INSERT INTO t VALUES (1, 'a')");
      })();
      Bun.gc(true);
      insert.run();
      insert.finalize();
      expect(calls).toEqual([[":memory:", true, "t"]]);
    });

    it("a prepared statement still calls it after close(false)", () => {
      const db = table(new Database(":memory:"));
      const calls = record(db);
      const insert = db.prepare("INSERT INTO t VALUES (1, 'a')");
      db.close(false);
      Bun.gc(true);
      insert.run();
      insert.finalize();
      expect(calls).toEqual([["onInsert", true, "t", 1, "main"]]);
    });

    it("hooks that were replaced or removed, those of a closed database, and databases that their own hooks hold, are collected", () => {
      // heapStats() counts cells by their native class.
      const Captured = Bun.Glob;
      const globs = () => (Bun.gc(true), heapStats().objectTypeCounts.Glob ?? 0);
      const handles = () => (Bun.gc(true), heapStats().objectTypeCounts.SQLDatabase ?? 0);
      const globsBefore = globs();
      const handlesBefore = handles();

      using db = new Database(":memory:");
      for (let i = 0; i < 100; i++) {
        for (const name of names) {
          const captured = new Captured("*");
          db[name] = () => captured;
        }
      }
      // The last three are in use.
      expect(globs() - globsBefore).toBeWithin(3, 12);
      for (const name of names) db[name] = null;
      expect(globs() - globsBefore).toBeLessThan(9);

      const closed = [];
      for (let i = 0; i < 100; i++) {
        const dropped = new Database(":memory:");
        const captured = new Captured("*");
        dropped.onUpdate = () => [dropped, captured];

        closed.push(new Database(":memory:"));
        closed[i].onDelete = () => captured;
        closed[i].close();
      }
      expect(globs() - globsBefore).toBeLessThan(9);
      // `db` and the hundred in `closed`
      expect(handles() - handlesBefore).toBeWithin(101, 110);
    });
  });

  // The INSERT commits when its statement is reset or finalized. An FTS5 table writes to its shadow tables
  // at commit, which calls onInsert.
  describe("an INSERT that iterate() only stepped to its first row", () => {
    const open = (calls, filename = ":memory:") => {
      const db = new Database(filename);
      db.run("CREATE VIRTUAL TABLE ft USING fts5(x)");
      db.onInsert = (_, name) => void calls.push(name);
      return db;
    };
    const abandonInsert = (db, calls) => {
      db.prepare("INSERT INTO ft VALUES ('a') RETURNING 1").iterate().next();
      calls.length = 0;
    };

    it("is finished by the next call on the connection after it's garbage collected", () => {
      const calls = [];
      using db = open(calls);
      abandonInsert(db, calls);
      Bun.gc(true);
      expect(calls).toEqual([]);
      expect(db.inTransaction).toBe(false);
      expect(calls).toContain("ft_data");
    });

    it("doesn't call the hook when it's collected along with its Database", () => {
      const calls = [];
      (() => abandonInsert(open(calls), calls))();
      Bun.gc(true);
      expect(calls).toEqual([]);
    });

    it.each([
      ["it's", false],
      ["it and a SELECT that was still iterating are", true],
    ])("releases the file when %s collected after close(), even if the Database isn't", (_, abandonSelect) => {
      using dir = tempDir("sqlite-abandoned-insert", {});
      const file = path.join(String(dir), "x.sqlite");
      const calls = [];
      using db = open(calls, file);
      if (abandonSelect) (() => void db.prepare("SELECT 1").iterate().next())();
      abandonInsert(db, calls);
      db.close();
      Bun.gc(true);
      expect(calls).toEqual([]);
      using other = new Database(file);
      // Throws "database is locked" while the INSERT is still open.
      other.run("CREATE TABLE t (a)");
    });

    it("doesn't interrupt a statement that's still iterating when it's collected after close()", () => {
      const calls = [];
      using db = open(calls);
      db.run("CREATE TABLE n (a)");
      db.run("INSERT INTO n VALUES (1), (2)");
      const rows = db.prepare("SELECT a FROM n").iterate();
      expect(rows.next().value).toEqual({ a: 1 });
      abandonInsert(db, calls);
      db.close();
      Bun.gc(true);
      expect(calls).toEqual([]);
      expect(rows.next().value).toEqual({ a: 2 });
      expect(calls).toContain("ft_data");
    });

    it("doesn't call the hook when the ModuleGraph that opened its Database is disposed", () => {
      const calls = [];
      const graph = new Bun.ModuleGraph();
      const db = graph.run(() => open(calls));
      abandonInsert(db, calls);
      graph.dispose();
      expect(calls).toEqual([]);
      expect(() => db.run("SELECT 1")).toThrow("Database has closed");
    });

    it("is committed when it's collected along with a Database that has a user function", () => {
      using dir = tempDir("sqlite-collected-insert", {});
      const file = path.join(String(dir), "x.sqlite");
      (() => {
        const db = new Database(file);
        db.run("CREATE VIRTUAL TABLE ft USING fts5(x)");
        db.function("lower2", text => text.toLowerCase());
        db.prepare("INSERT INTO ft VALUES ('a') RETURNING 1").iterate().next();
      })();
      Bun.gc(true);
      using db = new Database(file);
      expect(db.query("SELECT x FROM ft WHERE ft MATCH 'a'").all()).toEqual([{ x: "a" }]);
    });

    it.concurrent.each(["the process", "a Worker"])("is committed when %s exits", async who => {
      using dir = tempDir("sqlite-exit-insert", {
        "main.js": `
          const { Database } = require("bun:sqlite");
          const { Worker, isMainThread } = require("worker_threads");
          if (isMainThread && process.argv[2] === "a Worker") {
            new Worker(__filename);
          } else {
            const db = new Database("x.sqlite");
            db.run("CREATE VIRTUAL TABLE ft USING fts5(x)");
            db.onInsert = () => {};
            db.prepare("INSERT INTO ft VALUES ('a'), ('b') RETURNING 1").iterate().next();
            console.log(db.run("INSERT INTO ft VALUES ('c')").changes);
          }`,
      });
      await using proc = Bun.spawn({
        cmd: [bunExe(), "main.js", who],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({ stdout, stderr, exitCode }).toEqual({ stdout: "1\n", stderr: "", exitCode: 0 });
      using db = new Database(path.join(String(dir), "x.sqlite"));
      expect(db.query("SELECT count(*) AS n FROM ft WHERE ft MATCH 'a OR b OR c'").get()).toEqual({ n: 3 });
    });

    it("is finished by close(), and the hook can collect other statements", async () => {
      const src = /* js */ `
        const { Database } = require("bun:sqlite");
        for (const force of [true, false]) {
          const db = new Database(":memory:");
          db.run("CREATE VIRTUAL TABLE ft USING fts5(x)");
          let others = Array.from({ length: 400 }, (_, i) => db.query("SELECT " + i));
          db.query("INSERT INTO ft VALUES ('a') RETURNING 1").iterate().next();
          let calls = 0;
          db.onInsert = () => {
            calls++;
            others = null;
            Bun.gc(true);
          };
          db.close(force);
          console.log(calls);
        }
      `;
      // Malloc=1 lets ASAN catch a use of freed WTF memory. On Windows, WebKit traps at startup when it's set.
      const ASAN_OPTIONS = [bunEnv.ASAN_OPTIONS, "symbolize=0", "detect_leaks=0"].filter(Boolean).join(":");
      const env = isWindows ? bunEnv : { ...bunEnv, Malloc: "1", ASAN_OPTIONS };
      await using proc = Bun.spawn({ cmd: [bunExe(), "-e", src], env, stdout: "pipe", stderr: "pipe" });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({ stdout, stderr, exitCode }).toEqual({ stdout: "3\n3\n", stderr: "", exitCode: 0 });
    });
  });

  it("on a closed database: null, and setting one throws", () => {
    const db = new Database(":memory:");
    db.onInsert = () => {};
    db.close();
    for (const name of names) {
      expect(db[name]).toBeNull();
      expect(() => (db[name] = () => {})).toThrow("Database has closed");
      expect(() => (db[name] = null)).toThrow("Database has closed");
    }
  });
});

// What the SQLite adapter of Bun.sql uses for `transform.column.from`. Only builtin modules can call it.
describe("the column name transform of a Statement", () => {
  const busy = "This database connection is busy executing a query";
  const setTransform = internalForTesting.setSQLiteColumnNameTransform;
  const upper = name => name.toUpperCase();

  it("makes the keys of get(), all() and iterate(); values(), raw() and columnNames have the names of SQLite", () => {
    using db = new Database(":memory:");
    const query = db.query("SELECT 1 AS a, 2 AS b");
    setTransform(query, upper);
    expect({
      get: query.get(),
      all: query.all(),
      iterate: [...query.iterate()],
      values: query.values(),
      columnNames: query.columnNames,
    }).toEqual({
      get: { A: 1, B: 2 },
      all: [{ A: 1, B: 2 }],
      iterate: [{ A: 1, B: 2 }],
      values: [[1, 2]],
      columnNames: ["a", "b"],
    });
  });

  it("user code cannot reach it through Statement#native", () => {
    using db = new Database(":memory:");
    const query = db.query("SELECT 1 AS a");
    const native = query.native;
    for (const object of [native, Object.getPrototypeOf(native)]) {
      expect("columnNameTransform" in object).toBe(false);
      expect("setColumnNameTransform" in object).toBe(false);
      const keys = Reflect.ownKeys(object);
      expect(keys.map(String).filter(key => key.toLowerCase().includes("transform"))).toEqual([]);
    }
    // A property with such a name is a property and nothing else.
    native.columnNameTransform = native.setColumnNameTransform = native.$setColumnNameTransform = () => "theirs";
    expect(query.get()).toEqual({ a: 1 });
    setTransform(query, () => "ours");
    expect(query.get()).toEqual({ ours: 1 });
  });

  it("is called with the name alone, once for a column, until the names change", () => {
    using db = new Database(":memory:");
    db.run("CREATE TABLE t (a, b); INSERT INTO t VALUES (1, 2), (3, 4), (5, 6)");
    const query = db.query("SELECT * FROM t LIMIT ?");
    const calls = [];
    setTransform(query, function (...args) {
      calls.push([this, ...args]);
      return args[0] + "!";
    });
    expect(calls).toEqual([]);
    expect(query.all(3)).toEqual([{ "a!": 1, "b!": 2 }, { "a!": 3, "b!": 4 }, { "a!": 5, "b!": 6 }]); // prettier-ignore
    expect(query.get(3)).toEqual({ "a!": 1, "b!": 2 });
    // A new value for LIMIT prepares the statement again, with the same names.
    expect(query.all(1)).toEqual([{ "a!": 1, "b!": 2 }]);
    expect(calls).toEqual([[undefined, "a"], [undefined, "b"]]); // prettier-ignore

    db.run("ALTER TABLE t RENAME COLUMN b TO c");
    expect(query.get(1)).toEqual({ "a!": 1, "c!": 2 });
    expect(calls.slice(2)).toEqual([[undefined, "a"], [undefined, "c"]]); // prettier-ignore
  });

  it("another function, null and undefined take effect at the next run", () => {
    using db = new Database(":memory:");
    const query = db.query("SELECT 1 AS a");
    setTransform(query, upper);
    expect(query.get()).toEqual({ A: 1 });
    setTransform(query, name => name + name);
    expect(query.get()).toEqual({ aa: 1 });
    setTransform(query, null);
    expect(query.get()).toEqual({ a: 1 });
    setTransform(query, upper);
    setTransform(query, undefined);
    expect(query.get()).toEqual({ a: 1 });
  });

  it("the keys are treated as names are: the last of two equal ones wins, an index is an index, as() has its prototype", () => {
    using db = new Database(":memory:");
    class Row {}
    const query = db.query("SELECT 1 AS a, 2 AS b, 3 AS A, 4 AS one, 5 AS blank").as(Row);
    setTransform(query, name => ({ one: 1, blank: "" })[name] ?? name.toUpperCase());
    const row = query.get();
    expect(Object.entries(row)).toEqual([["1", 4], ["A", 3], ["B", 2], ["", 5]]); // prettier-ignore
    expect(row).toBeInstanceOf(Row);
  });

  it.each([
    ["a number", () => 7, "7"],
    ["undefined", () => undefined, "undefined"],
    ["an object", () => ({ toString: () => "made" }), "made"],
  ])("%s is converted to a string", (_, transform, key) => {
    using db = new Database(":memory:");
    const query = db.query("SELECT 1 AS a");
    setTransform(query, transform);
    expect(query.get()).toEqual({ [key]: 1 });
  });

  it.each([
    ["the function", error => () => { throw error; }], // prettier-ignore
    ["the toString() of its result", error => () => ({ toString() { throw error; } })], // prettier-ignore
  ])("what %s throws comes out unchanged, ends the run and leaves no shape behind", (_, make) => {
    using db = new Database(":memory:");
    db.run("CREATE TABLE t (a, b); INSERT INTO t VALUES (1, 2), (3, 4)");
    const query = db.query("SELECT a, b FROM t");
    const error = new RangeError("thrown");
    const failing = make(error);
    let fail = true;
    const calls = [];
    setTransform(query, name => (calls.push(name), fail && name === "b" ? failing() : name.toUpperCase()));

    for (const run of [() => query.get(), () => query.all(), () => [...query.iterate()]]) {
      calls.length = 0;
      let caught;
      try {
        run();
      } catch (e) {
        caught = e;
      }
      expect(caught).toBe(error);
      expect(calls).toEqual(["a", "b"]);
      // No cursor is left open.
      db.run("CREATE TABLE u (a); DROP TABLE u");
    }
    fail = false;
    expect(query.all()).toEqual([{ A: 1, B: 2 }, { A: 3, B: 4 }]); // prettier-ignore
  });

  it("a Symbol is a TypeError", () => {
    using db = new Database(":memory:");
    const query = db.query("SELECT 1 AS a");
    setTransform(query, () => Symbol("key"));
    expect(() => query.get()).toThrow(TypeError);
  });

  it.each(
    Object.entries({
      "get()": ({ query }) => query.get(),
      "finalize()": ({ query }) => query.finalize(),
      "as()": ({ query }) => query.as(class {}),
      "setting another one": ({ query }) => setTransform(query, null),
      "db.run()": ({ db }) => db.run("SELECT 1"),
      "db.close(true)": ({ db }) => db.close(true),
    }),
  )("while it runs, and while its result is converted, %s throws", (_, call) => {
    using db = new Database(":memory:");
    const query = db.prepare("SELECT 1 AS a");
    const errors = [];
    const attempt = () => {
      try {
        call({ db, query });
        errors.push("no error");
      } catch (error) {
        errors.push(error);
      }
    };
    setTransform(query, () => (attempt(), { toString: () => (attempt(), "key") }));
    expect(query.all()).toEqual([{ key: 1 }]);
    expect(errors).toEqual([new TypeError(busy), new TypeError(busy)]);
    expect(db.query("SELECT 2 AS b").get()).toEqual({ b: 2 });
  });

  it.each([1, "f", {}, true])("%p is not a function", value => {
    using db = new Database(":memory:");
    const query = db.query("SELECT 1 AS a");
    expect(() => setTransform(query, value)).toThrow(new TypeError("Expected a function or null"));
    expect(query.get()).toEqual({ a: 1 });
  });

  it("the statement keeps it alive", () => {
    using db = new Database(":memory:");
    db.run("CREATE TABLE t (a); INSERT INTO t VALUES (1)");
    const query = db.query("SELECT * FROM t");
    (() => {
      const captured = { suffix: "_kept" };
      setTransform(query, name => (Bun.gc(true), name + captured.suffix));
    })();
    Bun.gc(true);
    expect(query.get()).toEqual({ a_kept: 1 });
    db.run("ALTER TABLE t RENAME COLUMN a TO b");
    Bun.gc(true);
    expect(query.get()).toEqual({ b_kept: 1 });
  });

  it("throws on a finalized statement", () => {
    using db = new Database(":memory:");
    const query = db.prepare("SELECT 1 AS a");
    query.finalize();
    expect(() => setTransform(query, () => "b")).toThrow("Statement has finalized");
  });
});

// No callback is involved: the exception is asked for from outside while SQLite runs the statement, and raised behind the step.
describe("an exception that is raised behind a step ends a statement that writes", () => {
  const tables = [
    ["a full-text table", "CREATE VIRTUAL TABLE ft USING fts5(body)", "ft"],
    [
      // PRAGMA integrity_check does not compare such an index with its table.
      "a table whose trigger feeds a full-text index",
      `
        CREATE TABLE docs (id INTEGER PRIMARY KEY, body);
        CREATE VIRTUAL TABLE ft USING fts5(body, content = 'docs', content_rowid = 'id');
        CREATE TRIGGER ai AFTER INSERT ON docs BEGIN INSERT INTO ft (rowid, body) VALUES (new.id, new.body); END;
      `,
      "docs",
    ],
  ];
  const insert = (table, rows) => `
    WITH RECURSIVE n (i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ${rows})
    INSERT INTO ${table} (body) SELECT 'hello ' || i FROM n RETURNING 1
  `;
  const count = (db, from) => db.query(`SELECT count(*) AS n FROM ${from}`).get().n;

  describe.each(tables)("a timeout of node:vm, in the load of %s", (_, schema, table) => {
    it.each([
      ["all()", load => load.all()],
      ["values()", load => load.values()],
      ["get()", load => load.get()],
      ["run()", load => load.run()],
      ["iterate()", load => load.iterate().next()],
    ])("by %s: all of it is in the file, and nothing is locked", (_, read) => {
      using dir = tempDir("sqlite-timeout-in-a-load", {});
      const file = path.join(String(dir), "db.sqlite");
      using db = new Database(file);
      db.run(schema);
      using other = new Database(file);
      const load = db.prepare(insert(table, 5000));
      const context = vm.createContext({ read: () => void read(load) });

      // A timeout that comes before the step ends a call that has done nothing. The step takes longer than all that comes
      // before it, so one of these falls into it.
      let code;
      for (let timeout = 1; !count(db, table); timeout *= 2) {
        code = "did not throw";
        try {
          vm.runInContext("read()", context, { timeout });
        } catch (error) {
          code = error.code;
        }
      }
      let write = "did not throw";
      try {
        other.run("CREATE TABLE later (x)");
      } catch (error) {
        write = error.message;
      }
      expect({ code, write, stored: count(other, table), found: count(other, "ft WHERE ft MATCH 'hello'") }).toEqual({
        code: "ERR_SCRIPT_EXECUTION_TIMEOUT",
        write: "did not throw",
        stored: 5000,
        found: 5000,
      });
    });
  });

  // Should terminate() come before or after the statement, the case passes as well. The file is read once the process of
  // that thread is gone.
  describe.concurrent("the termination of a Worker", () => {
    it.each(tables)("in the load of %s: all of it is in the file or none", async (_, schema, table) => {
      using dir = tempDir("sqlite-terminated-in-a-load", {});
      const file = path.join(String(dir), "db.sqlite");
      const inTheWorker = `
        const { Database } = require("bun:sqlite");
        const db = new Database(${JSON.stringify(file)});
        db.run(${JSON.stringify(schema)});
        // Once before, so that the second call is in SQLite at once.
        db.prepare(${JSON.stringify(insert(table, 1))}).all();
        const load = db.prepare(${JSON.stringify(insert(table, 10000))});
        require("node:worker_threads").parentPort.postMessage(1);
        load.all();
      `;
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          `
            const { Worker } = require("node:worker_threads");
            const worker = new Worker(${JSON.stringify(inTheWorker)}, { eval: true });
            await new Promise(resolve => worker.once("message", resolve));
            await worker.terminate();
          `,
        ],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({ stdout, stderr, exitCode }).toEqual({ stdout: "", stderr: "", exitCode: 0 });

      using db = new Database(file, { readonly: true });
      const stored = count(db, table);
      expect([1, 10001]).toContain(stored);
      expect(count(db, "ft WHERE ft MATCH 'hello'")).toBe(stored);
    });
  });
});
