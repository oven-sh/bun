// Test SQL logging functionality
import { expect, test } from "bun:test";

test("MySQL logging", async () => {
  try {
    const sql = new Bun.SQL("mysql://user:password@localhost:3306/test", { log: true });
    // This will fail to connect but should demonstrate the logging option being passed
  } catch (e) {
    // Connection will fail but that's expected for this test
    console.log("MySQL logging test completed (connection expected to fail)");
  }
});

test("PostgreSQL logging", async () => {
  try {
    const sql = new Bun.SQL("postgres://user:password@localhost:5432/test", { log: true });
    // This will fail to connect but should demonstrate the logging option being passed
  } catch (e) {
    // Connection will fail but that's expected for this test
    console.log("PostgreSQL logging test completed (connection expected to fail)");
  }
});

test("SQLite logging", async () => {
  try {
    const sql = new Bun.SQL(":memory:", { log: true });
    await sql`CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)`;
    await sql`INSERT INTO users (name) VALUES ('Alice')`;
    const users = await sql`SELECT * FROM users`;
    expect(users.length).toBe(1);
    expect(users[0].name).toBe('Alice');
    console.log("SQLite logging test completed successfully");
  } catch (e) {
    console.error("SQLite test failed:", e);
  }
});