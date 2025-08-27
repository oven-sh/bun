import { SQL } from "bun";
import { afterAll, beforeAll, expect, test } from "bun:test";

// This test requires PostgreSQL to be running locally
// Skip if not available
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
      CREATE TABLE IF NOT EXISTS test_json_arrays (
        id serial primary key,
        data jsonb
      )
    `;

    // Clean up any existing data
    await sql`DELETE FROM test_json_arrays`;
  } catch (error) {
    console.log("PostgreSQL not available, skipping test:", error.message);
    console.log("Error details:", error);
    sql = null;
  }
});

afterAll(async () => {
  if (sql) {
    try {
      await sql`DROP TABLE IF EXISTS test_json_arrays`;
      await sql.end();
    } catch (error) {
      // Ignore cleanup errors
    }
  }
});

test("SQL parsing should handle array of numbers -> jsonb", async () => {
  if (!sql) {
    console.log("Skipping test - PostgreSQL not available");
    return;
  }

  const arr = [42802, 42803, 42804];

  // This should work - passing array to jsonb column
  await sql`
    INSERT INTO test_json_arrays (data)
    VALUES (${arr})
  `;

  const result =
    await sql`SELECT data FROM test_json_arrays WHERE id = currval(pg_get_serial_sequence('test_json_arrays', 'id'))`;

  expect(result[0].data).toEqual([42802, 42803, 42804]);
});

test("SQL parsing should handle array with explicit jsonb cast", async () => {
  if (!sql) {
    console.log("Skipping test - PostgreSQL not available");
    return;
  }

  const arr = [42802, 42803, 42804];

  // This should also work - explicit cast to jsonb
  await sql`
    INSERT INTO test_json_arrays (data)
    VALUES (${arr}::jsonb)
  `;

  const result =
    await sql`SELECT data FROM test_json_arrays WHERE id = currval(pg_get_serial_sequence('test_json_arrays', 'id'))`;

  expect(result[0].data).toEqual([42802, 42803, 42804]);
});

test("SQL parsing should handle objects as jsonb", async () => {
  if (!sql) {
    console.log("Skipping test - PostgreSQL not available");
    return;
  }

  const obj = { numbers: [1, 2, 3], name: "test" };

  await sql`
    INSERT INTO test_json_arrays (data)
    VALUES (${obj})
  `;

  const result =
    await sql`SELECT data FROM test_json_arrays WHERE id = currval(pg_get_serial_sequence('test_json_arrays', 'id'))`;

  expect(result[0].data).toEqual({ numbers: [1, 2, 3], name: "test" });
});
