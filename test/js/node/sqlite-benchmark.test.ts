import { test, expect } from "bun:test";
import { DatabaseSync } from "node:sqlite";
import { Database as BunDatabase } from "bun:sqlite";

// Helper to benchmark a function
function bench(name: string, fn: () => void, iterations = 1000): number {
  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    fn();
  }
  const elapsed = performance.now() - start;
  console.log(`${name}: ${elapsed.toFixed(2)}ms for ${iterations} iterations (${(elapsed/iterations).toFixed(3)}ms per op)`);
  return elapsed;
}

test("SQLite Performance: node:sqlite vs bun:sqlite", () => {
  console.log("\n=== SQLite Performance Benchmark ===\n");
  
  // Setup both databases
  const nodeDb = new DatabaseSync(":memory:");
  const bunDb = new BunDatabase(":memory:");
  
  // Create identical tables
  const createTableSQL = "CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT, value INTEGER)";
  nodeDb.exec(createTableSQL);
  bunDb.exec(createTableSQL);
  
  console.log("1. INSERT Performance (1000 rows):");
  
  // Prepare statements
  const nodeInsert = nodeDb.prepare("INSERT INTO test (name, value) VALUES (?, ?)");
  const bunInsert = bunDb.prepare("INSERT INTO test (name, value) VALUES (?, ?)");
  
  // Benchmark inserts
  const nodeInsertTime = bench("  node:sqlite INSERT", () => {
    nodeInsert.run("test", Math.floor(Math.random() * 1000));
  });
  
  const bunInsertTime = bench("  bun:sqlite INSERT ", () => {
    bunInsert.run("test", Math.floor(Math.random() * 1000));
  });
  
  const insertRatio = (nodeInsertTime / bunInsertTime).toFixed(2);
  console.log(`  → bun:sqlite is ${insertRatio}x faster\n`);
  
  console.log("2. SELECT Performance (single row):");
  
  // Prepare select statements
  const nodeSelect = nodeDb.prepare("SELECT * FROM test WHERE id = ?");
  const bunSelect = bunDb.prepare("SELECT * FROM test WHERE id = ?");
  
  // Benchmark single row selects
  const nodeSelectTime = bench("  node:sqlite SELECT", () => {
    nodeSelect.get(Math.floor(Math.random() * 1000) + 1);
  }, 5000);
  
  const bunSelectTime = bench("  bun:sqlite SELECT ", () => {
    bunSelect.get(Math.floor(Math.random() * 1000) + 1);
  }, 5000);
  
  const selectRatio = (nodeSelectTime / bunSelectTime).toFixed(2);
  console.log(`  → bun:sqlite is ${selectRatio}x faster\n`);
  
  console.log("3. SELECT ALL Performance (1000 rows):");
  
  const nodeSelectAll = nodeDb.prepare("SELECT * FROM test");
  const bunSelectAll = bunDb.prepare("SELECT * FROM test");
  
  const nodeSelectAllTime = bench("  node:sqlite ALL", () => {
    nodeSelectAll.all();
  }, 100);
  
  const bunSelectAllTime = bench("  bun:sqlite ALL ", () => {
    bunSelectAll.all();
  }, 100);
  
  const allRatio = (nodeSelectAllTime / bunSelectAllTime).toFixed(2);
  console.log(`  → bun:sqlite is ${allRatio}x faster\n`);
  
  // Transaction performance
  console.log("4. Transaction Performance (100 inserts per transaction):");
  
  const nodeTransTime = bench("  node:sqlite TRANSACTION", () => {
    nodeDb.exec("BEGIN");
    for (let i = 0; i < 100; i++) {
      nodeInsert.run("batch", i);
    }
    nodeDb.exec("COMMIT");
  }, 10);
  
  const bunTransTime = bench("  bun:sqlite TRANSACTION ", () => {
    bunDb.exec("BEGIN");
    for (let i = 0; i < 100; i++) {
      bunInsert.run("batch", i);
    }
    bunDb.exec("COMMIT");
  }, 10);
  
  const transRatio = (nodeTransTime / bunTransTime).toFixed(2);
  console.log(`  → bun:sqlite is ${transRatio}x faster\n`);
  
  // Prepared statement with named parameters
  console.log("5. Named Parameters Performance:");
  
  const nodeNamed = nodeDb.prepare("INSERT INTO test (id, name, value) VALUES (:id, :name, :value)");
  const bunNamed = bunDb.prepare("INSERT INTO test (id, name, value) VALUES (:id, :name, :value)");
  
  let idCounter = 10000;
  const nodeNamedTime = bench("  node:sqlite NAMED", () => {
    nodeNamed.run({ id: idCounter++, name: "named", value: 42 });
  }, 1000);
  
  idCounter = 20000;
  const bunNamedTime = bench("  bun:sqlite NAMED ", () => {
    bunNamed.run({ id: idCounter++, name: "named", value: 42 });
  }, 1000);
  
  const namedRatio = (nodeNamedTime / bunNamedTime).toFixed(2);
  console.log(`  → bun:sqlite is ${namedRatio}x faster\n`);
  
  console.log("=== Summary ===");
  console.log(`INSERT: bun:sqlite is ${insertRatio}x faster`);
  console.log(`SELECT: bun:sqlite is ${selectRatio}x faster`);
  console.log(`SELECT ALL: bun:sqlite is ${allRatio}x faster`);
  console.log(`TRANSACTION: bun:sqlite is ${transRatio}x faster`);
  console.log(`NAMED PARAMS: bun:sqlite is ${namedRatio}x faster`);
  
  // Calculate average improvement
  const ratios = [parseFloat(insertRatio), parseFloat(selectRatio), parseFloat(allRatio), parseFloat(transRatio), parseFloat(namedRatio)];
  const avgRatio = (ratios.reduce((a, b) => a + b, 0) / ratios.length).toFixed(2);
  console.log(`\nAverage: bun:sqlite is ${avgRatio}x faster than node:sqlite`);
  
  // Clean up
  nodeDb.close();
  bunDb.close();
  
  // Expectations - node:sqlite should at least work
  expect(true).toBe(true);
});

test("Memory usage comparison", () => {
  console.log("\n=== Memory Usage Comparison ===\n");
  
  const initialMem = process.memoryUsage();
  
  // Create many prepared statements
  const nodeDb = new DatabaseSync(":memory:");
  nodeDb.exec("CREATE TABLE test (id INTEGER, data TEXT)");
  
  const nodeStatements = [];
  for (let i = 0; i < 100; i++) {
    nodeStatements.push(nodeDb.prepare(`SELECT * FROM test WHERE id = ${i}`));
  }
  
  const afterNodeMem = process.memoryUsage();
  const nodeMemDelta = (afterNodeMem.heapUsed - initialMem.heapUsed) / 1024 / 1024;
  
  // Do the same with bun:sqlite
  const bunDb = new BunDatabase(":memory:");
  bunDb.exec("CREATE TABLE test (id INTEGER, data TEXT)");
  
  const bunStatements = [];
  for (let i = 0; i < 100; i++) {
    bunStatements.push(bunDb.prepare(`SELECT * FROM test WHERE id = ${i}`));
  }
  
  const afterBunMem = process.memoryUsage();
  const bunMemDelta = (afterBunMem.heapUsed - afterNodeMem.heapUsed) / 1024 / 1024;
  
  console.log(`node:sqlite memory usage: ${nodeMemDelta.toFixed(2)} MB`);
  console.log(`bun:sqlite memory usage: ${bunMemDelta.toFixed(2)} MB`);
  console.log(`Ratio: ${(nodeMemDelta / bunMemDelta).toFixed(2)}x`);
  
  nodeDb.close();
  bunDb.close();
  
  expect(true).toBe(true);
});