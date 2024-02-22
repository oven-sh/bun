import { test, expect, describe } from "bun:test";
import { Pool, Client } from "pg";
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

  it("should execute big query and end connection", async () => {
    const client = new Client({
      connectionString: CONNECTION_STRING,
      ssl: { rejectUnauthorized: false },
    });

    await client.connect();
    const res = await client.query(`SELECT * FROM users LIMIT 1000`);
    expect(res.rows.length).toBeGreaterThanOrEqual(300);
    await client.end();
  }, 5000);
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

  it("should insert, select and delete", async () => {
    const sql = postgres(CONNECTION_STRING as string);
    try {
      await sql`CREATE TABLE IF NOT EXISTS usernames (
            user_id serial PRIMARY KEY,
            username VARCHAR ( 50 ) NOT NULL
        );`;

      const [{ user_id, username }] = await sql`insert into usernames (username) values ('bun') returning *`;
      expect(username).toBe("bun");

      const [{ user_id: user_id2, username: username2 }] =
        await sql`select * from usernames where user_id = ${user_id}`;
      expect(username2).toBe("bun");
      expect(user_id2).toBe(user_id);

      const [{ username: username3 }] = await sql`delete from usernames where user_id = ${user_id} returning *`;
      expect(username3).toBe("bun");
    } finally {
      sql.end();
    }
  });
});
