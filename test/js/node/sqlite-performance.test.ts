import { test, expect } from "bun:test";
import { DatabaseSync } from "node:sqlite";

test("node:sqlite - performance test", () => {
  const db = new DatabaseSync(":memory:");
  
  db.exec(`CREATE TABLE perf_test (
    id INTEGER PRIMARY KEY,
    text_val TEXT,
    int_val INTEGER,
    real_val REAL
  )`);
  
  const insertStmt = db.prepare("INSERT INTO perf_test (text_val, int_val, real_val) VALUES (?, ?, ?)");
  const selectStmt = db.prepare("SELECT * FROM perf_test WHERE int_val = ?");
  
  // Measure insert performance
  const insertStart = performance.now();
  db.exec("BEGIN");
  
  for (let i = 0; i < 10000; i++) {
    insertStmt.run(`text_${i}`, i, i * 1.5);
  }
  
  db.exec("COMMIT");
  const insertEnd = performance.now();
  const insertTime = insertEnd - insertStart;
  
  console.log(`Inserted 10,000 rows in ${insertTime.toFixed(2)}ms (${(10000 / (insertTime / 1000)).toFixed(0)} rows/sec)`);
  
  // Verify count
  const count = db.prepare("SELECT COUNT(*) as count FROM perf_test").get();
  expect(count.count).toBe(10000);
  
  // Measure select performance
  const selectStart = performance.now();
  
  for (let i = 0; i < 1000; i++) {
    const row = selectStmt.get(i * 10);
    expect(row.int_val).toBe(i * 10);
  }
  
  const selectEnd = performance.now();
  const selectTime = selectEnd - selectStart;
  
  console.log(`Selected 1,000 rows in ${selectTime.toFixed(2)}ms (${(1000 / (selectTime / 1000)).toFixed(0)} queries/sec)`);
  
  // Measure bulk retrieval
  const allStart = performance.now();
  const allRows = db.prepare("SELECT * FROM perf_test ORDER BY id").all();
  const allEnd = performance.now();
  const allTime = allEnd - allStart;
  
  expect(allRows).toHaveLength(10000);
  console.log(`Retrieved all 10,000 rows in ${allTime.toFixed(2)}ms`);
  
  // Test iterator performance
  const iterStart = performance.now();
  let iterCount = 0;
  
  for (const row of db.prepare("SELECT * FROM perf_test").iterate()) {
    iterCount++;
    if (iterCount > 1000) break; // Just test first 1000
  }
  
  const iterEnd = performance.now();
  const iterTime = iterEnd - iterStart;
  
  console.log(`Iterated 1,000 rows in ${iterTime.toFixed(2)}ms`);
  
  // Performance assertions - these are generous to account for different machines
  expect(insertTime).toBeLessThan(2000); // Should insert 10k rows in < 2 seconds
  expect(selectTime).toBeLessThan(500);  // Should select 1k rows in < 500ms
  expect(allTime).toBeLessThan(1000);    // Should retrieve 10k rows in < 1 second
  
  db.close();
  console.log("✅ Performance test completed successfully!");
});

test("node:sqlite - memory usage test", () => {
  const db = new DatabaseSync(":memory:");
  
  db.exec("CREATE TABLE mem_test (id INTEGER PRIMARY KEY, data BLOB)");
  
  const stmt = db.prepare("INSERT INTO mem_test (data) VALUES (?)");
  
  // Insert large blobs
  const largeData = Buffer.alloc(1024 * 1024, 'x'); // 1MB buffer
  
  db.exec("BEGIN");
  for (let i = 0; i < 10; i++) {
    stmt.run(largeData);
  }
  db.exec("COMMIT");
  
  // Read them back
  const rows = db.prepare("SELECT * FROM mem_test").all();
  expect(rows).toHaveLength(10);
  
  // Each row should have 1MB of data
  for (const row of rows) {
    expect(Buffer.isBuffer(row.data)).toBe(true);
    expect(row.data.length).toBe(1024 * 1024);
  }
  
  // Clean up
  stmt.finalize();
  db.close();
  
  console.log("✅ Memory usage test completed - handled 10MB of BLOBs!");
});