import { test, expect } from "bun:test";
import { Database } from "bun:sqlite";

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

test("SQLite Database.transaction() should support async functions - issue #24662", async () => {
  const db = new Database();
  
  db.run(`CREATE TABLE foo (id INTEGER PRIMARY KEY)`);
  
  // Test the exact scenario from the issue
  const results: string[] = [];
  
  // Start async transaction
  const transactionPromise = db.transaction(async () => {
    // This runs first
    db.run(`INSERT INTO foo VALUES (1)`);
    results.push("transaction: inserted 1");
    
    await sleep(100); // Reduced sleep time for faster tests
    
    // This should run after the timeout insert
    const count = db.query(`SELECT count(*) as count FROM foo`).get() as { count: number };
    results.push(`transaction: count is ${count.count}`);
    return count.count;
  })();
  
  // This should run while transaction is still active (after first insert but before commit)
  setTimeout(() => {
    db.run(`INSERT INTO foo VALUES (2)`);
    results.push("timeout: inserted 2");
    
    const count = db.query(`SELECT count(*) as count FROM foo`).get() as { count: number };
    results.push(`timeout: count is ${count.count}`);
  }, 50);
  
  // Wait for transaction to complete
  const transactionResult = await transactionPromise;
  
  // Final count after transaction is committed
  const finalCount = db.query(`SELECT count(*) as count FROM foo`).get() as { count: number };
  results.push(`final: count is ${finalCount.count}`);
  
  // The transaction should see only its own changes until committed
  // The count inside the transaction should be 1 (only its own insert)
  expect(transactionResult).toBe(1);
  
  // Final count should be 2 (both inserts)
  expect(finalCount.count).toBe(2);
  
  db.close();
});

test("async transaction with error should rollback", async () => {
  const db = new Database();
  
  db.run(`CREATE TABLE test_rollback (id INTEGER PRIMARY KEY)`);
  db.run(`INSERT INTO test_rollback VALUES (1)`);
  
  const initialCount = db.query(`SELECT count(*) as count FROM test_rollback`).get() as { count: number };
  expect(initialCount.count).toBe(1);
  
  // Transaction that throws an error after async operation
  await expect(async () => {
    await db.transaction(async () => {
      db.run(`INSERT INTO test_rollback VALUES (2)`);
      await sleep(10);
      throw new Error("Transaction error");
    })();
  }).toThrow("Transaction error");
  
  // Count should still be 1 (rollback occurred)
  const finalCount = db.query(`SELECT count(*) as count FROM test_rollback`).get() as { count: number };
  expect(finalCount.count).toBe(1);
  
  db.close();
});

test("async transaction with promise rejection should rollback", async () => {
  const db = new Database();
  
  db.run(`CREATE TABLE test_rejection (id INTEGER PRIMARY KEY)`);
  db.run(`INSERT INTO test_rejection VALUES (1)`);
  
  const initialCount = db.query(`SELECT count(*) as count FROM test_rejection`).get() as { count: number };
  expect(initialCount.count).toBe(1);
  
  // Transaction that rejects after async operation
  await expect(async () => {
    await db.transaction(async () => {
      db.run(`INSERT INTO test_rejection VALUES (2)`);
      await sleep(10);
      return Promise.reject(new Error("Promise rejection"));
    })();
  }).toThrow("Promise rejection");
  
  // Count should still be 1 (rollback occurred)
  const finalCount = db.query(`SELECT count(*) as count FROM test_rejection`).get() as { count: number };
  expect(finalCount.count).toBe(1);
  
  db.close();
});

test("nested async transactions should work", async () => {
  const db = new Database();
  
  db.run(`CREATE TABLE test_nested (id INTEGER PRIMARY KEY)`);
  
  const result = await db.transaction(async () => {
    db.run(`INSERT INTO test_nested VALUES (1)`);
    
    const nestedResult = await db.transaction(async () => {
      db.run(`INSERT INTO test_nested VALUES (2)`);
      await sleep(10);
      return "nested";
    })();
    
    await sleep(10);
    return `outer-${nestedResult}`;
  })();
  
  expect(result).toBe("outer-nested");
  
  const count = db.query(`SELECT count(*) as count FROM test_nested`).get() as { count: number };
  expect(count.count).toBe(2);
  
  db.close();
});

test("sync transaction should still work", () => {
  const db = new Database();
  
  db.run(`CREATE TABLE test_sync (id INTEGER PRIMARY KEY)`);
  
  const result = db.transaction(() => {
    db.run(`INSERT INTO test_sync VALUES (1)`);
    db.run(`INSERT INTO test_sync VALUES (2)`);
    return "sync-result";
  })();
  
  expect(result).toBe("sync-result");
  
  const count = db.query(`SELECT count(*) as count FROM test_sync`).get() as { count: number };
  expect(count.count).toBe(2);
  
  db.close();
});

test("async transaction should return promise", async () => {
  const db = new Database();
  
  db.run(`CREATE TABLE test_promise (id INTEGER PRIMARY KEY)`);
  
  const transactionPromise = db.transaction(async () => {
    db.run(`INSERT INTO test_promise VALUES (1)`);
    await sleep(10);
    return 42;
  })();
  
  // Should be a promise
  expect(transactionPromise).toBeInstanceOf(Promise);
  
  const result = await transactionPromise;
  expect(result).toBe(42);
  
  db.close();
});
