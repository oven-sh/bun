import { test, expect, describe } from "bun:test";
import { Pool } from "pg";
import { parse } from "pg-connection-string";
import postgres from "postgres";

const CONNECTION_STRING = process.env.TLS_POSTGRES_DATABASE_URL;

const it = CONNECTION_STRING ? test : test.skip;

describe("pg", () => {
  it("should connect using TLS", async () => {
    const pool = new Pool(parse(CONNECTION_STRING as string));
    try {
      const { rows } = await pool.query("SELECT version()", []);
      const [{ version }] = rows;

      expect(version).toMatch(/PostgreSQL/);
    } finally {
      pool.end();
    }
  });
});

describe("postgres", () => {
  it("should connect using TLS", async () => {
    const sql = postgres(CONNECTION_STRING as string);
    try {
      const [{ version }] = await sql`SELECT version()`;
      expect(version).toMatch(/PostgreSQL/);
    } finally {
      sql.end();
    }
  });
});
