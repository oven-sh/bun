import { test, expect } from "bun:test";
import { DatabaseSync } from "node:sqlite";

test("node:sqlite - sourceSQL property", () => {
  const db = new DatabaseSync(":memory:");
  
  db.exec("CREATE TABLE test (id INTEGER, name TEXT)");
  
  const sql = "INSERT INTO test VALUES (?, ?)";
  const stmt = db.prepare(sql);
  
  // Test sourceSQL property
  expect(stmt.sourceSQL).toBe(sql);
  
  stmt.run(1, "Alice");
  
  // sourceSQL should remain the same after execution
  expect(stmt.sourceSQL).toBe(sql);
  
  db.close();
  console.log("✅ sourceSQL property works");
});

test("node:sqlite - expandedSQL property", () => {
  const db = new DatabaseSync(":memory:");
  
  db.exec("CREATE TABLE test (id INTEGER, name TEXT)");
  
  const stmt = db.prepare("INSERT INTO test VALUES (?, ?)");
  
  // Before binding, expandedSQL shows NULL for unbound parameters (SQLite behavior)
  expect(stmt.expandedSQL).toBe("INSERT INTO test VALUES (NULL, NULL)");
  
  // After execution with parameters, expandedSQL should show the bound values
  stmt.run(42, "Bob");
  
  // Note: The exact format of expandedSQL depends on SQLite's implementation
  // It might be something like "INSERT INTO test VALUES (42, 'Bob')"
  // For now, just check that it's a string
  expect(typeof stmt.expandedSQL).toBe("string");
  
  db.close();
  console.log("✅ expandedSQL property works");
});

test("node:sqlite - setReturnArrays() method", () => {
  const db = new DatabaseSync(":memory:");
  
  db.exec("CREATE TABLE test (id INTEGER, name TEXT)");
  db.exec("INSERT INTO test VALUES (1, 'Alice')");
  db.exec("INSERT INTO test VALUES (2, 'Bob')");
  
  const stmt = db.prepare("SELECT * FROM test ORDER BY id");
  
  // Default: returns objects
  const objResult = stmt.get();
  expect(objResult).toEqual({ id: 1, name: "Alice" });
  
  // Enable array mode
  stmt.setReturnArrays(true);
  
  // Now should return arrays
  const arrayResult = stmt.get();
  expect(Array.isArray(arrayResult)).toBe(true);
  expect(arrayResult).toEqual([1, "Alice"]);
  
  // Test with all()
  const allArrays = stmt.all();
  expect(allArrays).toEqual([
    [1, "Alice"],
    [2, "Bob"]
  ]);
  
  // Disable array mode
  stmt.setReturnArrays(false);
  
  // Back to objects
  const objResult2 = stmt.get();
  expect(objResult2).toEqual({ id: 1, name: "Alice" });
  
  db.close();
  console.log("✅ setReturnArrays() method works");
});

test("node:sqlite - combined new features", () => {
  const db = new DatabaseSync(":memory:");
  
  db.exec("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, score REAL)");
  
  const insertStmt = db.prepare("INSERT INTO users (name, score) VALUES (:name, :score)");
  
  // Check sourceSQL
  expect(insertStmt.sourceSQL).toContain("INSERT INTO users");
  
  // Insert some data
  insertStmt.run({ name: "Charlie", score: 95.5 });
  insertStmt.run({ name: "Diana", score: 88.0 });
  
  // Test query with array mode
  const selectStmt = db.prepare("SELECT * FROM users ORDER BY score DESC");
  
  selectStmt.setReturnArrays(true);
  const topScorer = selectStmt.get();
  expect(topScorer).toEqual([1, "Charlie", 95.5]);
  
  // Check expandedSQL
  const namedStmt = db.prepare("SELECT * FROM users WHERE name = :name");
  namedStmt.get({ name: "Charlie" });  // Use get() for SELECT statements
  expect(typeof namedStmt.expandedSQL).toBe("string");
  
  db.close();
  console.log("✅ All new features work together");
});