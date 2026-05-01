import { SQL } from "bun";
import { describe, expect, test } from "bun:test";

describe("Adapter Override", () => {
  test("postgres:// URL with adapter='sqlite' uses SQLite", async () => {
    const sql = new SQL("postgres://localhost:5432/testdb", {
      adapter: "sqlite",
      filename: ":memory:",
    });

    expect(sql.options.adapter).toBe("sqlite");
    expect(sql.options.filename).toBe(":memory:");

    // Verify it's actually SQLite by running a SQLite-specific query
    await sql`CREATE TABLE test (id INTEGER PRIMARY KEY)`;
    await sql`INSERT INTO test (id) VALUES (1)`;
    const result = await sql`SELECT * FROM test`;
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(1);

    await sql.close();
  });

  test("sqlite:// URL with adapter='sqlite' works", async () => {
    const sql = new SQL("sqlite://:memory:", {
      adapter: "sqlite",
    });

    expect(sql.options.adapter).toBe("sqlite");
    expect(sql.options.filename).toBe(":memory:");

    await sql`CREATE TABLE test2 (value TEXT)`;
    await sql`INSERT INTO test2 (value) VALUES ('hello')`;
    const result = await sql`SELECT * FROM test2`;
    expect(result).toHaveLength(1);
    expect(result[0].value).toBe("hello");

    await sql.close();
  });

  test("no URL with adapter='sqlite' and filename works", async () => {
    const sql = new SQL(undefined, {
      adapter: "sqlite",
      filename: ":memory:",
    });

    expect(sql.options.adapter).toBe("sqlite");
    expect(sql.options.filename).toBe(":memory:");

    await sql`CREATE TABLE test3 (num REAL)`;
    await sql`INSERT INTO test3 (num) VALUES (3.14)`;
    const result = await sql`SELECT * FROM test3`;
    expect(result).toHaveLength(1);
    expect(result[0].num).toBeCloseTo(3.14);

    await sql.close();
  });
});
