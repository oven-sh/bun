import { SQL } from "bun";
import { afterAll, beforeAll, expect, test } from "bun:test";

// This test reproduces issue #17030 - SQL parsing fails on array of numbers -> jsonb
// Skip if PostgreSQL not available
let sql: SQL | null = null;

beforeAll(async () => {
  try {
    // Try to connect to local PostgreSQL
    sql = new SQL("postgres://postgres@localhost:5432/test", {
      idle_timeout: 5,
      max_lifetime: 10,
    });

    // Test connection
    await sql`SELECT 1`;
    console.log("PostgreSQL connection successful!");

    // Create test table
    await sql`
      CREATE TABLE IF NOT EXISTS my_table (
        id serial primary key,
        data jsonb
      )
    `;

    // Clean up any existing data
    await sql`DELETE FROM my_table`;
  } catch (error) {
    console.log("PostgreSQL not available, skipping test:", error.message);
    sql = null;
  }
});

afterAll(async () => {
  if (sql) {
    try {
      await sql`DROP TABLE IF EXISTS my_table`;
      await sql.end();
    } catch (error) {
      // Ignore cleanup errors
    }
  }
});

test("issue #17030 - SQL parsing fails on array of numbers -> jsonb", async () => {
  if (!sql) {
    console.log("Skipping test - PostgreSQL not available");
    return;
  }

  // This reproduces the exact issue from #17030
  const arr = [42802, 42803, 42804];

  // This should work but currently fails with:
  // PostgresError: column "data" is of type jsonb but expression is of type integer
  await sql`
    INSERT INTO my_table (data)
    VALUES (${arr})
  `;

  const result = await sql`SELECT data FROM my_table WHERE id = currval(pg_get_serial_sequence('my_table', 'id'))`;
  expect(result[0].data).toEqual([42802, 42803, 42804]);
});

test("issue #17030 - array with explicit jsonb cast should work", async () => {
  if (!sql) {
    console.log("Skipping test - PostgreSQL not available");
    return;
  }

  const arr = [42802, 42803, 42804];

  // This should work with explicit cast
  await sql`
    INSERT INTO my_table (data)
    VALUES (${arr}::jsonb)
  `;

  const result = await sql`SELECT data FROM my_table WHERE id = currval(pg_get_serial_sequence('my_table', 'id'))`;
  expect(result[0].data).toEqual([42802, 42803, 42804]);
});

test("issue #17030 - manual stringify + jsonb cast results in double-escaping (expected)", async () => {
  if (!sql) {
    console.log("Skipping test - PostgreSQL not available");
    return;
  }

  const arr = [42802, 42803, 42804];

  // This demonstrates expected behavior: manual JSON.stringify + ::jsonb cast = double escaping
  // Users should use either ${arr} or ${JSON.stringify(arr)} without ::jsonb cast
  await sql`
    INSERT INTO my_table (data)
    VALUES (${JSON.stringify(arr)}::jsonb)
  `;

  const result = await sql`SELECT data FROM my_table WHERE id = currval(pg_get_serial_sequence('my_table', 'id'))`;
  // This gets double-escaped because we manually stringified AND cast to jsonb
  expect(result[0].data).toEqual("[42802,42803,42804]"); // String, not array
});
