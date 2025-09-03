import { test, expect } from "bun:test";
import { DatabaseSync } from "node:sqlite";

test("node:sqlite - parameter binding edge cases", () => {
  const db = new DatabaseSync(":memory:");
  
  // Create test table
  db.exec(`CREATE TABLE test (
    id INTEGER PRIMARY KEY,
    val1 TEXT,
    val2 INTEGER,
    val3 REAL,
    val4 BLOB
  )`);
  
  // Test 1: Multiple positional parameters
  const stmt1 = db.prepare("INSERT INTO test (val1, val2, val3) VALUES (?, ?, ?)");
  const result1 = stmt1.run("test1", 42, 3.14);
  expect(result1.changes).toBe(1);
  
  // Test 2: Verify the values were actually inserted correctly
  const check1 = db.prepare("SELECT * FROM test WHERE id = 1").get();
  expect(check1.val1).toBe("test1");
  expect(check1.val2).toBe(42);
  expect(check1.val3).toBe(3.14);
  
  // Test 3: Named parameters with object
  const stmt2 = db.prepare("INSERT INTO test (val1, val2, val3) VALUES (:a, :b, :c)");
  const result2 = stmt2.run({ a: "test2", b: 100, c: 2.718 });
  expect(result2.changes).toBe(1);
  
  const check2 = db.prepare("SELECT * FROM test WHERE id = 2").get();
  expect(check2.val1).toBe("test2");
  expect(check2.val2).toBe(100);
  expect(check2.val3).toBe(2.718);
  
  // Test 4: Array parameter binding
  const stmt3 = db.prepare("INSERT INTO test (val1, val2, val3) VALUES (?, ?, ?)");
  const result3 = stmt3.run(["test3", 999, 1.618]);
  expect(result3.changes).toBe(1);
  
  const check3 = db.prepare("SELECT * FROM test WHERE id = 3").get();
  expect(check3.val1).toBe("test3");
  expect(check3.val2).toBe(999);
  expect(check3.val3).toBe(1.618);
  
  // Test 5: Mixed NULL values
  const stmt4 = db.prepare("INSERT INTO test (val1, val2, val3, val4) VALUES (?, ?, ?, ?)");
  const result4 = stmt4.run(null, 5, null, Buffer.from("binary"));
  expect(result4.changes).toBe(1);
  
  const check4 = db.prepare("SELECT * FROM test WHERE id = 4").get();
  expect(check4.val1).toBeNull();
  expect(check4.val2).toBe(5);
  expect(check4.val3).toBeNull();
  expect(Buffer.isBuffer(check4.val4)).toBe(true);
  expect(check4.val4.toString()).toBe("binary");
  
  // Test 6: WHERE clause parameters
  const stmt5 = db.prepare("SELECT * FROM test WHERE val2 = ? AND val1 = ?");
  const result5 = stmt5.get(42, "test1");
  expect(result5.id).toBe(1);
  expect(result5.val1).toBe("test1");
  expect(result5.val2).toBe(42);
  
  // Test 7: UPDATE with parameters
  const stmt6 = db.prepare("UPDATE test SET val1 = ?, val2 = ? WHERE id = ?");
  const result6 = stmt6.run("updated", 777, 1);
  expect(result6.changes).toBe(1);
  
  const check6 = db.prepare("SELECT * FROM test WHERE id = 1").get();
  expect(check6.val1).toBe("updated");
  expect(check6.val2).toBe(777);
  
  // Test 8: DELETE with parameters
  const stmt7 = db.prepare("DELETE FROM test WHERE val2 > ? AND val2 < ?");
  const result7 = stmt7.run(50, 200);
  expect(result7.changes).toBe(1); // Should delete the row with val2=100
  
  const remaining = db.prepare("SELECT COUNT(*) as count FROM test").get();
  expect(remaining.count).toBe(3); // 4 rows - 1 deleted = 3
  
  db.close();
  console.log("✅ All parameter binding tests passed!");
});

test("node:sqlite - stress test parameters", () => {
  const db = new DatabaseSync(":memory:");
  
  db.exec("CREATE TABLE stress (id INTEGER PRIMARY KEY, v1 INTEGER, v2 INTEGER, v3 INTEGER, v4 INTEGER, v5 INTEGER)");
  
  const stmt = db.prepare("INSERT INTO stress VALUES (?, ?, ?, ?, ?, ?)");
  
  // Insert 100 rows with 6 parameters each
  for (let i = 0; i < 100; i++) {
    const result = stmt.run(i, i*10, i*20, i*30, i*40, i*50);
    expect(result.changes).toBe(1);
    expect(result.lastInsertRowid).toBe(i);
  }
  
  // Verify a sample
  const check = db.prepare("SELECT * FROM stress WHERE id = 50").get();
  expect(check).toEqual({
    id: 50,
    v1: 500,
    v2: 1000,
    v3: 1500,
    v4: 2000,
    v5: 2500
  });
  
  const count = db.prepare("SELECT COUNT(*) as count FROM stress").get();
  expect(count.count).toBe(100);
  
  db.close();
  console.log("✅ Stress test passed - 600 parameters bound correctly!");
});