import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";

// https://github.com/oven-sh/bun/issues/25472
// Database.prepare ignores single binding argument, only array bindings work

const singleBindingCases: [string, string, string, unknown, unknown][] = [
  ["string", "name TEXT", "name", "test1", { name: "test1" }],
  ["number", "value INTEGER", "value", 42, { value: 42 }],
  ["bigint", "value INTEGER", "value", 9007199254740991n, { value: 9007199254740991 }],
  ["null", "name TEXT", "name", null, { name: null }],
];

test.each(singleBindingCases)("prepare() with single %s binding", (_, columnDef, columnName, bindValue, expected) => {
  const db = new Database(":memory:");
  db.run(`CREATE TABLE test (id INTEGER PRIMARY KEY AUTOINCREMENT, ${columnDef})`);

  const stmt = db.prepare(`INSERT INTO test (${columnName}) VALUES (?)`, bindValue);
  stmt.run();

  const result = db.query("SELECT * FROM test WHERE id = 1").get();
  expect(result).toMatchObject(expected as object);
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
