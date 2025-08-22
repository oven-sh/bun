import { SQL } from "bun";
import { afterAll, beforeAll, expect, test } from "bun:test";

// Test edge cases for the array -> JSONB fix
let sql: SQL | null = null;

beforeAll(async () => {
  try {
    sql = new SQL("postgres://postgres@localhost:5432/test", {
      idle_timeout: 5,
      max_lifetime: 10,
    });

    await sql`SELECT 1`;
    console.log("PostgreSQL connection successful!");

    await sql`
      CREATE TABLE IF NOT EXISTS test_mixed_types (
        id serial primary key,
        json_data jsonb,
        text_data text,
        int_data integer
      )
    `;

    await sql`DELETE FROM test_mixed_types`;
  } catch (error) {
    console.log("PostgreSQL not available, skipping test:", error.message);
    sql = null;
  }
});

afterAll(async () => {
  if (sql) {
    try {
      await sql`DROP TABLE IF EXISTS test_mixed_types`;
      await sql.end();
    } catch (error) {
      // Ignore cleanup errors
    }
  }
});

test("mixed parameter types work correctly", async () => {
  if (!sql) {
    console.log("Skipping test - PostgreSQL not available");
    return;
  }

  const arr = [1, 2, 3];
  const obj = { name: "test", values: [4, 5, 6] };
  const text = "hello world";
  const num = 42;

  await sql`
    INSERT INTO test_mixed_types (json_data, text_data, int_data)
    VALUES (${arr}, ${text}, ${num})
  `;

  const result = await sql`SELECT * FROM test_mixed_types WHERE int_data = ${num}`;

  expect(result[0].json_data).toEqual([1, 2, 3]);
  expect(result[0].text_data).toBe("hello world");
  expect(result[0].int_data).toBe(42);
});

test("objects are still handled as JSONB", async () => {
  if (!sql) {
    console.log("Skipping test - PostgreSQL not available");
    return;
  }

  const obj = { name: "test", numbers: [7, 8, 9] };

  await sql`
    INSERT INTO test_mixed_types (json_data)
    VALUES (${obj})
  `;

  const result = await sql`SELECT json_data FROM test_mixed_types WHERE json_data->>'name' = 'test'`;

  expect(result[0].json_data).toEqual({ name: "test", numbers: [7, 8, 9] });
});

test("empty arrays work", async () => {
  if (!sql) {
    console.log("Skipping test - PostgreSQL not available");
    return;
  }

  const emptyArr = [];

  await sql`
    INSERT INTO test_mixed_types (json_data)
    VALUES (${emptyArr})
  `;

  const result = await sql`SELECT json_data FROM test_mixed_types WHERE json_data = '[]'::jsonb`;

  expect(result[0].json_data).toEqual([]);
});

test("nested arrays work", async () => {
  if (!sql) {
    console.log("Skipping test - PostgreSQL not available");
    return;
  }

  const nestedArr = [
    [1, 2],
    [3, 4],
    [5, 6],
  ];

  await sql`
    INSERT INTO test_mixed_types (json_data)
    VALUES (${nestedArr})
  `;

  const result =
    await sql`SELECT json_data FROM test_mixed_types WHERE id = currval(pg_get_serial_sequence('test_mixed_types', 'id'))`;

  expect(result[0].json_data).toEqual([
    [1, 2],
    [3, 4],
    [5, 6],
  ]);
});
