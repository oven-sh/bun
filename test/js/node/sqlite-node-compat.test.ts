import { test, expect } from "bun:test";
import { DatabaseSync } from "node:sqlite";

// These tests are based on Node.js v22.12.0 documentation:
// https://nodejs.org/api/sqlite.html

test("node:sqlite - Node.js API compatibility test", () => {
  // Example from Node.js docs
  const database = new DatabaseSync(':memory:');

  // Exact example from docs
  database
    .exec(`
      CREATE TABLE data(
        key INTEGER PRIMARY KEY,
        value TEXT
      ) STRICT
    `);

  const insert = database.prepare('INSERT INTO data (key, value) VALUES (?, ?)');
  insert.run(1, 'hello');
  insert.run(2, 'world');
  
  const query = database.prepare('SELECT * FROM data ORDER BY key');
  const rows = query.all();
  
  expect(rows).toEqual([
    { key: 1, value: 'hello' },
    { key: 2, value: 'world' }
  ]);
  
  database.close();
  console.log("✅ Basic Node.js example works");
});

test("node:sqlite - Constructor options from Node.js docs", () => {
  // Test open: false option from docs
  const db = new DatabaseSync(':memory:', { open: false });
  expect(db.isOpen).toBe(false);
  
  db.open();
  expect(db.isOpen).toBe(true);
  
  db.close();
  console.log("✅ Constructor options work as documented");
});

test("node:sqlite - StatementSync methods from docs", () => {
  const db = new DatabaseSync(':memory:');
  
  db.exec('CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)');
  
  const stmt = db.prepare('INSERT INTO test (name) VALUES (?)');
  
  // Test run() - returns { changes, lastInsertRowid }
  const result = stmt.run('Alice');
  expect(result).toHaveProperty('changes');
  expect(result).toHaveProperty('lastInsertRowid');
  expect(result.changes).toBe(1);
  expect(result.lastInsertRowid).toBe(1);
  
  stmt.run('Bob');
  stmt.run('Charlie');
  
  // Test get() - returns single row or undefined
  const getStmt = db.prepare('SELECT * FROM test WHERE id = ?');
  const row = getStmt.get(1);
  expect(row).toEqual({ id: 1, name: 'Alice' });
  
  const notFound = getStmt.get(999);
  expect(notFound).toBeUndefined();
  
  // Test all() - returns array of rows
  const allStmt = db.prepare('SELECT * FROM test ORDER BY id');
  const allRows = allStmt.all();
  expect(allRows).toHaveLength(3);
  expect(allRows[0]).toEqual({ id: 1, name: 'Alice' });
  
  db.close();
  console.log("✅ StatementSync methods match Node.js API");
});

test("node:sqlite - Named parameters as documented", () => {
  const db = new DatabaseSync(':memory:');
  
  db.exec('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, age INTEGER)');
  
  // Node.js docs show both :name and $name styles
  const stmt1 = db.prepare('INSERT INTO users (name, age) VALUES (:name, :age)');
  stmt1.run({ name: 'Alice', age: 30 });
  
  const stmt2 = db.prepare('INSERT INTO users (name, age) VALUES ($name, $age)');
  stmt2.run({ name: 'Bob', age: 25 });
  
  const users = db.prepare('SELECT * FROM users ORDER BY id').all();
  expect(users).toHaveLength(2);
  expect(users[0].name).toBe('Alice');
  expect(users[1].name).toBe('Bob');
  
  db.close();
  console.log("✅ Named parameters work as documented");
});

test("node:sqlite - Properties from Node.js docs", () => {
  const db = new DatabaseSync(':memory:');
  
  // Test isOpen property
  expect(db.isOpen).toBe(true);
  
  // Test isTransaction property
  expect(db.isTransaction).toBe(false);
  db.exec('BEGIN');
  expect(db.isTransaction).toBe(true);
  db.exec('COMMIT');
  expect(db.isTransaction).toBe(false);
  
  // Test location() method
  const location = db.location();
  expect(typeof location).toBe('string');
  
  db.close();
  expect(db.isOpen).toBe(false);
  
  console.log("✅ Properties match Node.js documentation");
});

test("node:sqlite - exec() method as documented", () => {
  const db = new DatabaseSync(':memory:');
  
  // exec() should return void/undefined
  const result = db.exec(`
    CREATE TABLE test (id INTEGER);
    INSERT INTO test VALUES (1);
    INSERT INTO test VALUES (2);
  `);
  
  expect(result).toBeUndefined();
  
  const count = db.prepare('SELECT COUNT(*) as count FROM test').get();
  expect(count.count).toBe(2);
  
  db.close();
  console.log("✅ exec() method works as documented");
});

test("node:sqlite - setReadBigInts() as documented", () => {
  const db = new DatabaseSync(':memory:');
  
  db.exec('CREATE TABLE nums (big INTEGER)');
  
  const bigNum = 9007199254740993n; // Larger than MAX_SAFE_INTEGER
  
  const insert = db.prepare('INSERT INTO nums VALUES (?)');
  insert.run(bigNum);
  
  // Default: returns as number
  const stmt1 = db.prepare('SELECT * FROM nums');
  const row1 = stmt1.get();
  expect(typeof row1.big).toBe('number');
  
  // With setReadBigInts(true): returns as BigInt
  const stmt2 = db.prepare('SELECT * FROM nums');
  stmt2.setReadBigInts(true);
  const row2 = stmt2.get();
  expect(typeof row2.big).toBe('bigint');
  
  db.close();
  console.log("✅ setReadBigInts() works as documented");
});

test("node:sqlite - columns() method as documented", () => {
  const db = new DatabaseSync(':memory:');
  
  db.exec('CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT NOT NULL, age REAL)');
  
  const stmt = db.prepare('SELECT id, name, age FROM test');
  const columns = stmt.columns();
  
  expect(columns).toHaveLength(3);
  expect(columns[0].name).toBe('id');
  expect(columns[1].name).toBe('name');
  expect(columns[2].name).toBe('age');
  
  // Type info may or may not be available
  if (columns[0].type) {
    expect(columns[0].type).toBe('INTEGER');
  }
  
  db.close();
  console.log("✅ columns() method works as documented");
});