import { SQL } from "bun";
import { beforeEach, expect, test } from "bun:test";
import { describeWithContainer } from "harness";

describeWithContainer(
  "postgres",
  {
    image: "postgres_plain",
    env: {},
    concurrent: true,
    args: [],
  },
  async container => {
    let databaseUrl: string;
    beforeEach(async () => {
      await container.ready;
      databaseUrl = `postgres://bun_sql_test@${container.host}:${container.port}/bun_sql_test`;
    });
    const postgres = (...args) => new SQL(...args);

    test("should handle large batch inserts without crashing", async () => {
      await using sql = postgres(databaseUrl!);
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
    });

    test("should handle empty result sets without crashing", async () => {
      await using sql = postgres(databaseUrl!);
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
    });

    test("should handle mixed date formats in batch operations", async () => {
      await using sql = postgres(databaseUrl!);
      // Create test table
      await sql`DROP TABLE IF EXISTS test_concurrent_21311`;
      await sql`CREATE TABLE test_concurrent_21311 (
        id serial PRIMARY KEY,
        should_be_null INT,
        date DATE NULL
      );`;

      // Run multiple concurrent batch operations
      // This tests potential race conditions in field metadata setup
      const concurrentOperations = Array.from({ length: 100 }, async (_, threadId) => {
        const batchSize = 20;
        const values = Array.from(
          { length: batchSize },
          (_, i) => `(${i % 2 === 0 ? 1 : 0}, ${i % 2 === 0 ? "'infinity'::date" : "NULL"})`,
        ).join(", ");

        const insertQuery = `INSERT INTO test_concurrent_21311 (should_be_null, date) VALUES ${values} RETURNING id, should_be_null, date`;
        return sql.unsafe(insertQuery);
      });

      await Promise.all(concurrentOperations);

      // Run multiple concurrent queries

      const allQueryResults = await sql`SELECT * FROM test_concurrent_21311`;
      allQueryResults.forEach((row, i) => {
        expect(row.should_be_null).toBeNumber();
        if (row.should_be_null) {
          expect(row.date).toBeDefined();
          expect(row.date?.getTime()).toBeNaN();
        } else {
          expect(row.date).toBeNull();
        }
      });
      // Cleanup
      await sql`DROP TABLE test_concurrent_21311`;
    });
  },
);
