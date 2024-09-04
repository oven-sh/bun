import { describe, expect, test } from "bun:test";
import { getSecret } from "harness";
import postgres from "postgres";

const databaseUrl = getSecret("TLS_POSTGRES_DATABASE_URL");

describe.skipIf(!databaseUrl)("postgres", () => {
  test("should connect using TLS", async () => {
    const sql = postgres(databaseUrl!);
    try {
      const [{ version }] = await sql`SELECT version()`;
      expect(version).toMatch(/PostgreSQL/);
    } finally {
      sql.end();
    }
  });

  test("should insert, select and delete", async () => {
    const sql = postgres(databaseUrl!);
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
