import { test, expect } from "bun:test";
import { DatabaseSync, StatementSync } from "node:sqlite";
import { randomInt } from "crypto";

test("node:sqlite comprehensive compatibility test", () => {
  const dbPath = `/tmp/test-${randomInt(1000000)}.db`;
  const db = new DatabaseSync(dbPath);
  
  try {
    console.log("Testing basic database operations...");
    
    // Test 1: Basic table creation and data insertion
    db.exec("CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT, value INTEGER, data BLOB, price REAL)");
    
    // Test 2: Parameter binding with different data types
    console.log("Testing parameter binding...");
    const insertStmt = db.prepare("INSERT INTO test (name, value, data, price) VALUES (?, ?, ?, ?)");
    
    // Test integers
    const result1 = insertStmt.run("test1", 42, null, 3.14);
    console.log("Insert result 1:", result1);
    expect(result1.changes).toBe(1);
    expect(result1.lastInsertRowid).toBe(1);
    
    // Test BLOB data
    const buffer = Buffer.from([1, 2, 3, 4, 5]);
    const result2 = insertStmt.run("test2", 100, buffer, 2.71);
    console.log("Insert result 2:", result2);
    
    // Test 3: Query data back and verify types
    console.log("Testing data retrieval...");
    const selectStmt = db.prepare("SELECT * FROM test WHERE id = ?");
    
    const row1 = selectStmt.get(1);
    console.log("Row 1:", row1);
    console.log("Row 1 types:", {
      id: typeof row1?.id,
      name: typeof row1?.name,
      value: typeof row1?.value,
      data: typeof row1?.data,
      price: typeof row1?.price
    });
    
    // Check if values match what we inserted
    if (row1) {
      expect(row1.id).toBe(1);
      expect(row1.name).toBe("test1");
      expect(row1.value).toBe(42);  // This might fail - returns null
      expect(row1.price).toBe(3.14); // This might fail - returns null
    }
    
    const row2 = selectStmt.get(2);
    console.log("Row 2:", row2);
    console.log("Is row2.data a Buffer?", Buffer.isBuffer(row2?.data));
    
    // Test 4: Named parameters
    console.log("Testing named parameters...");
    try {
      const namedStmt = db.prepare("INSERT INTO test (name, value) VALUES (@name, @value)");
      const namedResult = namedStmt.run({ "@name": "named_test", "@value": 999 });
      console.log("Named parameter result:", namedResult);
    } catch (error) {
      console.log("Named parameter error:", error.message);
    }
    
    // Test 5: All rows query
    console.log("Testing all() method...");
    const allStmt = db.prepare("SELECT * FROM test ORDER BY id");
    const allRows = allStmt.all();
    console.log("All rows:", allRows);
    console.log("Number of rows:", allRows.length);
    
    // Test 6: Iterator functionality
    console.log("Testing iterate() method...");
    try {
      const iter = allStmt.iterate();
      console.log("Iterator created:", !!iter);
      console.log("Is Iterator instance?", iter instanceof globalThis.Iterator);
      console.log("Iterator has toArray?", typeof iter.toArray);
      
      // Try to iterate
      let count = 0;
      for (const row of iter) {
        count++;
        console.log(`Iterator row ${count}:`, row);
        if (count >= 3) break; // Prevent infinite loop
      }
    } catch (error) {
      console.log("Iterator error:", error.message);
    }
    
    // Test 7: BigInt support
    console.log("Testing BigInt support...");
    try {
      db.exec("CREATE TABLE bigint_test (id INTEGER PRIMARY KEY, big_val INTEGER)");
      const bigIntStmt = db.prepare("INSERT INTO bigint_test (big_val) VALUES (?)");
      const bigIntResult = bigIntStmt.run(BigInt("9223372036854775807")); // Max signed 64-bit
      console.log("BigInt result:", bigIntResult);
    } catch (error) {
      console.log("BigInt error:", error.message);
    }
    
    // Test 8: Transaction methods
    console.log("Testing transaction methods...");
    console.log("Is in transaction?", db.inTransaction);
    
    try {
      db.exec("BEGIN TRANSACTION");
      console.log("After BEGIN - in transaction?", db.inTransaction);
      
      db.exec("INSERT INTO test (name, value) VALUES ('txn_test', 1234)");
      
      db.exec("ROLLBACK");
      console.log("After ROLLBACK - in transaction?", db.inTransaction);
    } catch (error) {
      console.log("Transaction error:", error.message);
    }
    
    // Test 9: Location method
    console.log("Testing location() method...");
    console.log("Database location:", db.location());
    
    // Test with in-memory database
    const memDb = new DatabaseSync(":memory:");
    console.log("Memory database location:", memDb.location());
    console.log("Should be null for :memory:, got:", memDb.location() === null);
    memDb.close();
    
    // Test 10: Statement columns
    console.log("Testing statement columns...");
    const columnStmt = db.prepare("SELECT id, name, value FROM test LIMIT 1");
    console.log("Statement columns:", columnStmt.columns);
    
    // Test 11: Error handling
    console.log("Testing error handling...");
    try {
      db.prepare("INVALID SQL SYNTAX");
    } catch (error) {
      console.log("SQL syntax error caught:", error.message);
      console.log("Error code:", error.code);
    }
    
    // Test 12: StatementSync methods
    console.log("Testing StatementSync methods...");
    const testStmt = db.prepare("SELECT * FROM test WHERE id = ?");
    console.log("Statement has setAllowUnknownNamedParameters?", typeof testStmt.setAllowUnknownNamedParameters);
    console.log("Statement has setReturnArrays?", typeof testStmt.setReturnArrays);
    console.log("Statement has setReadBigInts?", typeof testStmt.setReadBigInts);
    
  } finally {
    try {
      db.close();
    } catch (error) {
      console.log("Close error:", error.message);
    }
  }
});

test("node:sqlite constructor and static method tests", () => {
  console.log("Testing constructors...");
  
  // Test StatementSync cannot be constructed directly
  try {
    new StatementSync();
    console.log("❌ StatementSync constructor should have thrown");
  } catch (error) {
    console.log("✅ StatementSync constructor error:", error.message);
    console.log("Error code:", error.code);
  }
  
  // Test DatabaseSync with invalid paths
  try {
    new DatabaseSync("file://invalid");
    console.log("❌ Invalid file:// URL should have thrown");
  } catch (error) {
    console.log("✅ Invalid URL error:", error.message);
    console.log("Error code:", error.code);
  }
});