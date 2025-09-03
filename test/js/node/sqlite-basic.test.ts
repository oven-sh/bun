import { test, expect } from "bun:test";
import { DatabaseSync } from "node:sqlite";

test("node:sqlite basic operations work", () => {
  // Test 1: Create in-memory database
  const db = new DatabaseSync(":memory:");
  expect(db.isOpen).toBe(true);
  
  // Test 2: Create table with exec
  db.exec("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)");
  
  // Test 3: Insert with prepare and run
  const insertStmt = db.prepare("INSERT INTO users (name) VALUES (?)");
  const result1 = insertStmt.run("Alice");
  expect(result1.changes).toBe(1);
  expect(result1.lastInsertRowid).toBe(1);
  
  const result2 = insertStmt.run("Bob");
  expect(result2.changes).toBe(1);
  expect(result2.lastInsertRowid).toBe(2);
  
  // Test 4: Query with get
  const selectStmt = db.prepare("SELECT * FROM users WHERE id = ?");
  const row = selectStmt.get(1);
  expect(row).toEqual({ id: 1, name: "Alice" });
  
  // Test 5: Query with all
  const allStmt = db.prepare("SELECT * FROM users ORDER BY id");
  const rows = allStmt.all();
  expect(rows).toHaveLength(2);
  expect(rows[0]).toEqual({ id: 1, name: "Alice" });
  expect(rows[1]).toEqual({ id: 2, name: "Bob" });
  
  // Test 6: Named parameters
  const namedStmt = db.prepare("INSERT INTO users (id, name) VALUES (:id, :name)");
  namedStmt.run({ id: 3, name: "Charlie" });
  
  const charlie = selectStmt.get(3);
  expect(charlie).toEqual({ id: 3, name: "Charlie" });
  
  // Test 7: NULL values
  db.exec("CREATE TABLE nullable (id INTEGER, value TEXT)");
  const nullStmt = db.prepare("INSERT INTO nullable VALUES (?, ?)");
  nullStmt.run(1, null);
  
  const nullRow = db.prepare("SELECT * FROM nullable").get();
  expect(nullRow.value).toBeNull();
  
  // Test 8: Iterate
  const iterStmt = db.prepare("SELECT * FROM users ORDER BY id");
  const iteratedRows = [];
  for (const row of iterStmt.iterate()) {
    iteratedRows.push(row);
  }
  expect(iteratedRows).toHaveLength(3);
  
  // Test 9: isTransaction property
  expect(db.isTransaction).toBe(false);
  db.exec("BEGIN");
  expect(db.isTransaction).toBe(true);
  db.exec("COMMIT");
  expect(db.isTransaction).toBe(false);
  
  // Test 10: Close database
  db.close();
  expect(db.isOpen).toBe(false);
  
  // Should throw when using closed db
  expect(() => db.exec("SELECT 1")).toThrow(/database is not open/);
});

test("node:sqlite handles errors correctly", () => {
  const db = new DatabaseSync(":memory:");
  
  // SQL syntax error
  expect(() => db.exec("INVALID SQL")).toThrow();
  
  // Constraint violation
  db.exec("CREATE TABLE test (id INTEGER PRIMARY KEY)");
  db.exec("INSERT INTO test VALUES (1)");
  expect(() => db.exec("INSERT INTO test VALUES (1)")).toThrow(/UNIQUE constraint failed/);
  
  db.close();
});

test("node:sqlite constructor options", () => {
  // Test open: false option
  const db = new DatabaseSync(":memory:", { open: false });
  expect(db.isOpen).toBe(false);
  
  // Open it manually
  db.open();
  expect(db.isOpen).toBe(true);
  
  db.exec("CREATE TABLE test (id INTEGER)");
  db.exec("INSERT INTO test VALUES (42)");
  
  const row = db.prepare("SELECT * FROM test").get();
  expect(row.id).toBe(42);
  
  db.close();
});

test("node:sqlite blob support", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE blobs (id INTEGER, data BLOB)");
  
  const buffer = Buffer.from([1, 2, 3, 4, 5]);
  db.prepare("INSERT INTO blobs VALUES (?, ?)").run(1, buffer);
  
  const row = db.prepare("SELECT * FROM blobs").get();
  expect(Buffer.isBuffer(row.data)).toBe(true);
  expect(row.data).toEqual(buffer);
  
  db.close();
});

test("node:sqlite location method", () => {
  const db = new DatabaseSync(":memory:");
  const location = db.location();
  // In-memory databases return empty string or ":memory:" depending on implementation
  expect(typeof location).toBe("string");
  db.close();
});

test("node:sqlite statement columns", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE test (id INTEGER, name TEXT, age REAL)");
  
  const stmt = db.prepare("SELECT * FROM test");
  const columns = stmt.columns();
  
  expect(columns).toHaveLength(3);
  expect(columns[0].name).toBe("id");
  expect(columns[1].name).toBe("name");
  expect(columns[2].name).toBe("age");
  
  db.close();
});