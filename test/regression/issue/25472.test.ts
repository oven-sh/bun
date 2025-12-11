import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";

// https://github.com/oven-sh/bun/issues/25472
// Database.prepare ignores single binding argument, only array bindings work

test("prepare() with single string binding", () => {
  const db = new Database(":memory:");
  db.run("CREATE TABLE test (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT)");

  const stmt = db.prepare("INSERT INTO test (name) VALUES (?)", "test1");
  stmt.run();

  const result = db.query("SELECT name FROM test WHERE id = 1").get();
  expect(result).toEqual({ name: "test1" });
});

test("prepare() with single number binding", () => {
  const db = new Database(":memory:");
  db.run("CREATE TABLE test (id INTEGER PRIMARY KEY, value INTEGER)");

  const stmt = db.prepare("INSERT INTO test (id, value) VALUES (1, ?)", 42);
  stmt.run();

  const result = db.query("SELECT value FROM test WHERE id = 1").get();
  expect(result).toEqual({ value: 42 });
});

test("prepare() with single bigint binding", () => {
  const db = new Database(":memory:");
  db.run("CREATE TABLE test (id INTEGER PRIMARY KEY, value INTEGER)");

  const stmt = db.prepare("INSERT INTO test (id, value) VALUES (1, ?)", 9007199254740991n);
  stmt.run();

  const result = db.query("SELECT value FROM test WHERE id = 1").get();
  expect(result).toEqual({ value: 9007199254740991 });
});

test("prepare() with single null binding", () => {
  const db = new Database(":memory:");
  db.run("CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)");

  const stmt = db.prepare("INSERT INTO test (id, name) VALUES (1, ?)", null);
  stmt.run();

  const result = db.query("SELECT name FROM test WHERE id = 1").get();
  expect(result).toEqual({ name: null });
});

test("prepare() with single Uint8Array binding", () => {
  const db = new Database(":memory:");
  db.run("CREATE TABLE test (id INTEGER PRIMARY KEY, data BLOB)");

  const data = new Uint8Array([1, 2, 3, 4]);
  const stmt = db.prepare("INSERT INTO test (id, data) VALUES (1, ?)", data);
  stmt.run();

  const result = db.query("SELECT data FROM test WHERE id = 1").get() as { data: Uint8Array };
  expect(result.data).toEqual(data);
});

test("prepare() with array binding still works", () => {
  const db = new Database(":memory:");
  db.run("CREATE TABLE test (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT)");

  const stmt = db.prepare("INSERT INTO test (name) VALUES (?)", ["test2"]);
  stmt.run();

  const result = db.query("SELECT name FROM test WHERE id = 1").get();
  expect(result).toEqual({ name: "test2" });
});

test("prepare() with object binding still works", () => {
  const db = new Database(":memory:");
  db.run("CREATE TABLE test (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT)");

  const stmt = db.prepare("INSERT INTO test (name) VALUES ($name)", { $name: "test3" });
  stmt.run();

  const result = db.query("SELECT name FROM test WHERE id = 1").get();
  expect(result).toEqual({ name: "test3" });
});

test("prepare() toString() shows bound value for single binding", () => {
  const db = new Database(":memory:");
  db.run("CREATE TABLE test (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT)");

  const stmt = db.prepare("INSERT INTO test (name) VALUES (?)", "test1");
  expect(stmt.toString()).toContain("'test1'");
});
