import { test, expect } from "bun:test";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unlinkSync } from "node:fs";

test("node:sqlite - error handling", () => {
  const db = new DatabaseSync(":memory:");
  
  // Test 1: Invalid SQL syntax
  expect(() => {
    db.exec("INVALID SQL GARBAGE");
  }).toThrow(/syntax error/i);
  
  // Test 2: Table doesn't exist
  expect(() => {
    db.prepare("SELECT * FROM nonexistent").get();
  }).toThrow(/no such table/i);
  
  // Test 3: Unique constraint violation
  db.exec("CREATE TABLE unique_test (id INTEGER PRIMARY KEY, value TEXT UNIQUE)");
  db.exec("INSERT INTO unique_test VALUES (1, 'unique')");
  expect(() => {
    db.exec("INSERT INTO unique_test VALUES (2, 'unique')");
  }).toThrow(/UNIQUE constraint/i);
  
  // Test 4: Operations on closed database
  const closedDb = new DatabaseSync(":memory:");
  closedDb.close();
  expect(() => {
    closedDb.exec("SELECT 1");
  }).toThrow(/not open/i);
  
  // Test 5: Invalid parameter count
  const stmt = db.prepare("INSERT INTO unique_test VALUES (?, ?)");
  expect(() => {
    stmt.run(1); // Missing second parameter
  }).toThrow();
  
  // Test 6: Type mismatch in strict tables
  db.exec("CREATE TABLE strict_test (id INTEGER, val INTEGER) STRICT");
  const strictStmt = db.prepare("INSERT INTO strict_test VALUES (?, ?)");
  expect(() => {
    strictStmt.run(1, "not a number"); // Should fail in strict mode
  }).toThrow(/datatype mismatch/i);
  
  // Test 7: Foreign key constraint
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("CREATE TABLE parent (id INTEGER PRIMARY KEY)");
  db.exec("CREATE TABLE child (id INTEGER, parent_id INTEGER, FOREIGN KEY(parent_id) REFERENCES parent(id))");
  
  expect(() => {
    db.exec("INSERT INTO child VALUES (1, 999)"); // Parent 999 doesn't exist
  }).toThrow(/FOREIGN KEY constraint/i);
  
  db.close();
  console.log("✅ All error handling tests passed!");
});

test("node:sqlite - statement finalization", () => {
  const db = new DatabaseSync(":memory:");
  
  db.exec("CREATE TABLE test (id INTEGER)");
  
  const stmt = db.prepare("INSERT INTO test VALUES (?)");
  stmt.run(1);
  
  // Finalize the statement
  stmt.finalize();
  
  // Should throw when using finalized statement
  expect(() => {
    stmt.run(2);
  }).toThrow(/finalized/i);
  
  expect(() => {
    stmt.get();
  }).toThrow(/finalized/i);
  
  expect(() => {
    stmt.all();
  }).toThrow(/finalized/i);
  
  db.close();
  console.log("✅ Statement finalization tests passed!");
});

test("node:sqlite - file database errors", () => {
  // Test 1: Invalid path
  expect(() => {
    new DatabaseSync("/invalid/path/that/does/not/exist/db.sqlite");
  }).toThrow();
  
  // Test 2: Read-only database
  const dbPath = join(tmpdir(), `readonly-${Date.now()}.db`);
  const db = new DatabaseSync(dbPath);
  db.exec("CREATE TABLE test (id INTEGER)");
  db.close();
  
  // TODO: Test read-only mode when supported
  // const roDb = new DatabaseSync(dbPath, { readonly: true });
  // expect(() => {
  //   roDb.exec("INSERT INTO test VALUES (1)");
  // }).toThrow(/readonly/i);
  // roDb.close();
  
  unlinkSync(dbPath);
  console.log("✅ File database error tests passed!");
});

test("node:sqlite - transaction errors", () => {
  const db = new DatabaseSync(":memory:");
  
  db.exec("CREATE TABLE test (id INTEGER PRIMARY KEY)");
  
  // Start transaction
  db.exec("BEGIN");
  expect(db.isTransaction).toBe(true);
  
  // Insert a row
  db.exec("INSERT INTO test VALUES (1)");
  
  // Try to insert duplicate - should fail
  expect(() => {
    db.exec("INSERT INTO test VALUES (1)");
  }).toThrow(/PRIMARY KEY/i);
  
  // Transaction should still be active
  expect(db.isTransaction).toBe(true);
  
  // Rollback
  db.exec("ROLLBACK");
  expect(db.isTransaction).toBe(false);
  
  // Verify rollback worked
  const count = db.prepare("SELECT COUNT(*) as count FROM test").get();
  expect(count.count).toBe(0);
  
  db.close();
  console.log("✅ Transaction error tests passed!");
});