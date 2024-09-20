import { describe, expect, test } from "bun:test";
import { getSecret } from "harness";
import { Client, Pool } from "pg";
import { parse } from "pg-connection-string";

const databaseUrl = getSecret("TLS_POSTGRES_DATABASE_URL");

describe.skipIf(!databaseUrl)("pg", () => {
  test("should connect using TLS", async () => {
    const pool = new Pool(parse(databaseUrl!));
    try {
      const { rows } = await pool.query("SELECT version()", []);
      const [{ version }] = rows;

      expect(version).toMatch(/PostgreSQL/);
    } finally {
      pool.end();
    }
  });

  test("should execute big query and end connection", async () => {
    const client = new Client({
      connectionString: databaseUrl!,
      ssl: { rejectUnauthorized: false },
    });

    await client.connect();
    const res = await client.query(`SELECT * FROM users LIMIT 1000`);
    expect(res.rows.length).toBeGreaterThanOrEqual(300);
    await client.end();
  });
});
