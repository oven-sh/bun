import { expect, test } from "bun:test";

test("SQL logging option can be set and passed to adapters", async () => {
  // Test SQLite logging option
  try {
    const sql = new Bun.SQL(":memory:", { log: true });
    expect(sql).toBeDefined();

    // Verify we can create tables and run queries
    await sql`CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)`;
    await sql`INSERT INTO users (name) VALUES ('Alice')`;
    const users = await sql`SELECT * FROM users`;
    expect(users).toHaveLength(1);
    expect(users[0].name).toBe("Alice");
  } catch (error) {
    console.error("SQLite logging test failed:", error);
    throw error;
  }

  // Test that log: false works (default case)
  try {
    const sqlNoLog = new Bun.SQL(":memory:", { log: false });
    expect(sqlNoLog).toBeDefined();
    await sqlNoLog`CREATE TABLE test (id INTEGER)`;
  } catch (error) {
    console.error("SQLite no-logging test failed:", error);
    throw error;
  }
});

test("SQL logging option accepts boolean values", () => {
  // Test that log option can be true
  expect(() => new Bun.SQL(":memory:", { log: true })).not.toThrow();

  // Test that log option can be false
  expect(() => new Bun.SQL(":memory:", { log: false })).not.toThrow();

  // Test that log option can be undefined (defaults to false)
  expect(() => new Bun.SQL(":memory:", {})).not.toThrow();
  expect(() => new Bun.SQL(":memory:")).not.toThrow();
});
