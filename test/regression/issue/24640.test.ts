// https://github.com/oven-sh/bun/issues/24640
// Test that large bulk inserts return a proper error instead of panicking
import { describe, expect, test } from "bun:test";
import { getSecret } from "harness";
import postgres from "postgres";

const databaseUrl = getSecret("TLS_POSTGRES_DATABASE_URL");

describe.skipIf(!databaseUrl)("postgres large bulk insert", () => {
  test("should throw error instead of panic when message exceeds protocol limit", async () => {
    const sql = postgres(databaseUrl!);
    try {
      // Create a test table
      await sql`DROP TABLE IF EXISTS test_bulk_insert_24640`;
      await sql`CREATE TABLE test_bulk_insert_24640 (
        id serial PRIMARY KEY,
        data TEXT
      )`;

      // Create a large array that will exceed the protocol limit
      // Each row will have ~300KB of data to trigger the overflow with fewer rows
      const largeString = "x".repeat(300 * 1024); // 300KB per row
      const rows = Array.from({ length: 8000 }, (_, i) => ({
        data: largeString,
      }));

      // This should throw an error instead of panicking
      await expect(async () => {
        await sql`INSERT INTO test_bulk_insert_24640 ${sql(rows)}`;
      }).toThrow();
    } finally {
      try {
        await sql`DROP TABLE IF EXISTS test_bulk_insert_24640`;
      } catch {}
      await sql.end();
    }
  }, 60000); // 60 second timeout for this test

  test("should work with smaller batches", async () => {
    const sql = postgres(databaseUrl!);
    try {
      // Create a test table
      await sql`DROP TABLE IF EXISTS test_bulk_insert_24640_small`;
      await sql`CREATE TABLE test_bulk_insert_24640_small (
        id serial PRIMARY KEY,
        data TEXT
      )`;

      // Create smaller batches that should work
      const rows = Array.from({ length: 100 }, (_, i) => ({
        data: `row ${i}`,
      }));

      await sql`INSERT INTO test_bulk_insert_24640_small ${sql(rows)}`;

      const result = await sql`SELECT COUNT(*) as count FROM test_bulk_insert_24640_small`;
      expect(result[0].count).toBe("100");
    } finally {
      try {
        await sql`DROP TABLE IF EXISTS test_bulk_insert_24640_small`;
      } catch {}
      await sql.end();
    }
  });
});
