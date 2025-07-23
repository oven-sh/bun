import { describe, expect, test } from "bun:test";
import { getSecret } from "harness";
import postgres from "postgres";

const databaseUrl = getSecret("TLS_POSTGRES_DATABASE_URL");

describe("postgres batch insert crash fix #21311", () => {
  test("should handle large batch inserts without crashing", async () => {
    const sql = postgres(databaseUrl!);
    try {
      // Create a test table
      await sql`DROP TABLE IF EXISTS test_batch_21311`;
      await sql`CREATE TABLE test_batch_21311 (
        id serial PRIMARY KEY,
        data VARCHAR(100)
      );`;

      // Generate a large batch of data to insert
      const batchSize = 100;
      const values = Array.from({ length: batchSize }, (_, i) => `('batch_data_${i}')`).join(", ");

      // This query would previously crash with "index out of bounds: index 0, len 0"
      // on Windows when the fields metadata wasn't properly initialized
      const insertQuery = `INSERT INTO test_batch_21311 (data) VALUES ${values} RETURNING id, data`;

      const results = await sql.unsafe(insertQuery);

      expect(results).toHaveLength(batchSize);
      expect(results[0]).toHaveProperty("id");
      expect(results[0]).toHaveProperty("data");
      expect(results[0].data).toBe("batch_data_0");
      expect(results[batchSize - 1].data).toBe(`batch_data_${batchSize - 1}`);

      // Cleanup
      await sql`DROP TABLE test_batch_21311`;
    } finally {
      await sql.end();
    }
  });

  test("should handle empty result sets without crashing", async () => {
    const sql = postgres(databaseUrl!);
    try {
      // Create a temporary table that will return no results
      await sql`DROP TABLE IF EXISTS test_empty_21311`;
      await sql`CREATE TABLE test_empty_21311 (
        id serial PRIMARY KEY,
        data VARCHAR(100)
      );`;

      // Query that returns no rows - this tests the empty fields scenario
      const results = await sql`SELECT * FROM test_empty_21311 WHERE id = -1`;

      expect(results).toHaveLength(0);

      // Cleanup
      await sql`DROP TABLE test_empty_21311`;
    } finally {
      await sql.end();
    }
  });

  test("should handle concurrent batch operations", async () => {
    const sql = postgres(databaseUrl!);
    try {
      // Create test table
      await sql`DROP TABLE IF EXISTS test_concurrent_21311`;
      await sql`CREATE TABLE test_concurrent_21311 (
        id serial PRIMARY KEY,
        thread_id INT,
        data VARCHAR(100),
        date DATE
      );`;

      // Run multiple concurrent batch operations
      // This tests potential race conditions in field metadata setup
      const concurrentOperations = Array.from({ length: 100 }, async (_, threadId) => {
        const batchSize = 20;
        const values = Array.from(
          { length: batchSize },
          (_, i) => `(${threadId}, 'thread_${threadId}_data_${i}', 'infinity'::date)`,
        ).join(", ");

        const insertQuery = `INSERT INTO test_concurrent_21311 (thread_id, data, date) VALUES ${values} RETURNING id, thread_id, data, date`;
        return sql.unsafe(insertQuery);
      });

      const allResults = await Promise.all(concurrentOperations);

      // Verify all operations completed successfully
      expect(allResults).toHaveLength(100);
      allResults.forEach((results, threadId) => {
        expect(results).toHaveLength(20);
        results.forEach((row, i) => {
          expect(row.thread_id).toBe(threadId);
          expect(row.data).toBe(`thread_${threadId}_data_${i}`);
        });
      });

      // Run multiple concurrent queries
      const concurrentQueries = Array.from({ length: 100 }, async (_, threadId) => {
        return sql`SELECT * FROM test_concurrent_21311 WHERE thread_id = ${threadId}`;
      });

      const allQueryResults = await Promise.all(concurrentQueries);
      expect(allQueryResults).toHaveLength(100);
      allQueryResults.forEach((results, threadId) => {
        expect(results).toHaveLength(20);
        results.forEach((row, i) => {
          expect(row.thread_id).toBe(threadId);
          expect(row.data).toBe(`thread_${threadId}_data_${i}`);
        });
      });
      // Cleanup
      await sql`DROP TABLE test_concurrent_21311`;
    } finally {
      await sql.end();
    }
  });
});
