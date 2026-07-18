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
                startedCount++;
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

            const workersTerminated = workers.map(worker => {
              const exited = new Promise(resolve => worker.once("exit", resolve));
              const terminated = worker.terminate();
              return Promise.all([terminated, exited]);
            });
            await Promise.all(workersTerminated);
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
            failIf(final.postFailures !== baseline.postFailures + 3, "expected three failed completion posts");
            failIf(final.completionsRun !== baseline.completionsRun, "terminated tasks must not run completions");
            failIf(final.completionsDropped !== baseline.completionsDropped + 3, "expected three dropped completions");
            failIf(final.liveJobs !== baseline.liveJobs, "native async SQLite jobs leaked");
            failIf(final.liveResults !== baseline.liveResults, "native async SQLite results leaked");
            failIf(final.liveRequests !== baseline.liveRequests, "native async SQLite requests leaked");
            failIf(final.liveAbortAlgorithms !== baseline.liveAbortAlgorithms, "native AbortSignal algorithms leaked");

            return {
              round,
              scheduled: scheduledCount,
              started: startedCount,
              postFailures: final.postFailures - baseline.postFailures,
              completionsRun: final.completionsRun - baseline.completionsRun,
              completionsDropped: final.completionsDropped - baseline.completionsDropped,
            };
          } finally {
            if (!allWorkersTerminated) {
              await Promise.all(workers.map(worker => worker.terminate()));
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

    const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout.trim()).toBe(
      JSON.stringify({
        rounds: Array.from({ length: rounds }, (_, round) => ({
          round,
          scheduled: 3,
          started: 2,
          postFailures: 3,
          completionsRun: 0,
          completionsDropped: 3,
        })),
      }),
    );
    expect(exitCode).toBe(0);
  }, 30000);
});
