import { expect, it, describe } from "bun:test";
import { Database, constants, SQLiteError } from "bun:sqlite";
import { existsSync, fstat, realpathSync, rmSync, writeFileSync } from "fs";
import { spawnSync } from "bun";
import { bunExe } from "harness";
import { tmpdir } from "os";
import path from "path";

const tmpbase = tmpdir() + path.sep;

var encode = text => new TextEncoder().encode(text);

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
    Database.open(tmpbase + `database-${Math.random()}.sqlite`, { readonly: true });
    throw new Error("Expected an error to be thrown");
  } catch (error) {
    expect(error.message).toBe("unable to open database file");
  }

  // in a file which doesn't exist
  try {
    Database.open(tmpbase + `database-${Math.random()}.sqlite`, { readwrite: true });
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
      SQLITE_DIR: dir,
    },
    stderr: "inherit",
  });
  expect(exitCode).toBe(0);

  const db2 = Database.open(dir + "get-persist.sqlite");

  expect(db2.query(`SELECT id FROM examples`).all()).toEqual([{ id: "hello" }, { id: "world" }]);
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
  expect(stmt2.run()).toBe(undefined);

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
    expect(e.message).toBe("Expected 2 values, got 1");
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
  const path = tmpbase + "bun-987.db";
  if (!existsSync(path)) {
    const arrayBuffer = await (await fetch("https://github.com/oven-sh/bun/files/9265429/logs.log")).arrayBuffer();
    writeFileSync(path, arrayBuffer);
  }

  const db = new Database(path);

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
  expect(db.query("SELECT * FROM movies('game')").all()).toEqual([{ title: "WarGames" }]);
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
    if (process.platform === "darwin" && process.arch === "x64") {
      if (error.byteOffset === -1) {
        // older versions of macOS don't have the function which returns the byteOffset
        // we internally use a polyfill, so we need to allow that.
        return;
      }
    }

    expect(error.byteOffset).toBe(17);
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
