// Simple test to verify async transaction support
import { Database } from "bun:sqlite";

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function testAsyncTransaction() {
  console.log("Testing async transaction support...");
  
  const db = new Database();
  
  db.run(`CREATE TABLE foo (id INTEGER PRIMARY KEY)`);
  
  // Test the exact scenario from the issue
  const results = [];
  
  // Start async transaction
  const transactionPromise = db.transaction(async () => {
    // This runs first
    db.run(`INSERT INTO foo VALUES (1)`);
    results.push("transaction: inserted 1");
    
    await sleep(100);
    
    // This should run after the timeout insert
    const count = db.query(`SELECT count(*) as count FROM foo`).get();
    results.push(`transaction: count is ${count.count}`);
    return count.count;
  })();
  
  // This should run while transaction is still active
  setTimeout(() => {
    db.run(`INSERT INTO foo VALUES (2)`);
    results.push("timeout: inserted 2");
    
    const count = db.query(`SELECT count(*) as count FROM foo`).get();
    results.push(`timeout: count is ${count.count}`);
  }, 50);
  
  // Wait for transaction to complete
  const transactionResult = await transactionPromise;
  
  // Final count after transaction is committed
  const finalCount = db.query(`SELECT count(*) as count FROM foo`).get();
  results.push(`final: count is ${finalCount.count}`);
  
  console.log("Results:", results);
  console.log("Transaction result:", transactionResult);
  console.log("Final count:", finalCount.count);
  
  // The transaction should see only its own changes until committed
  if (transactionResult === 1 && finalCount.count === 2) {
    console.log("✅ Test passed! Async transactions work correctly.");
  } else {
    console.log("❌ Test failed!");
  }
  
  db.close();
}

testAsyncTransaction().catch(console.error);
