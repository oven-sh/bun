// Simple test for SQL logging
console.log("Testing SQL logging...");

try {
  const sql = new Bun.SQL(":memory:", { log: true });
  console.log("SQLite connection created with logging enabled");
  
  // Test queries
  console.log("Running SQLite queries...");
  await sql`CREATE TABLE test (id INTEGER, name TEXT)`;
  await sql`INSERT INTO test VALUES (1, 'Alice')`;
  const result = await sql`SELECT * FROM test`;
  console.log("Query result:", result);
  
} catch (e) {
  console.error("Error:", e.message);
}