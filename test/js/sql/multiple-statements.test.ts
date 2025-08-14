import { SQL } from "bun";
import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";

test("SQLite hasMultipleStatements detection", () => {
  const db = new Database(":memory:");

  const single = db.prepare("SELECT 1");
  expect(single.hasMultipleStatements).toBe(false);

  const singleWithSemi = db.prepare("SELECT 1;");
  expect(singleWithSemi.hasMultipleStatements).toBe(false);

  const multi = db.prepare("SELECT 1; SELECT 2");
  expect(multi.hasMultipleStatements).toBe(true);

  const withString = db.prepare("SELECT ';' as test");
  expect(withString.hasMultipleStatements).toBe(false);

  const withComment = db.prepare("SELECT 1 -- ; comment");
  expect(withComment.hasMultipleStatements).toBe(false);

  const complex = db.prepare(`
    CREATE TABLE test (id INTEGER);
    INSERT INTO test VALUES (1);
    SELECT * FROM test;
  `);

  expect(complex.hasMultipleStatements).toBe(true);

  db.close();
});

test("SQL template multi-statement execution", async () => {
  const sql = new SQL(":memory:");

  const result = await sql`
    CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT);
    INSERT INTO users (name) VALUES ('Alice'), ('Bob');
  `;

  expect(result.count).toBe(2);
  expect(result.command).toBe("MULTI");

  const users = await sql`SELECT * FROM users`;
  expect(users).toHaveLength(2);
  expect(users[0]).toEqual({ id: 1, name: "Alice" });
  expect(users[1]).toEqual({ id: 2, name: "Bob" });
});
