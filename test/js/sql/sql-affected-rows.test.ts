// `affectedRows` is the portable affected-row count for writes. MySQL has
// always reported it (from the OK packet, covered in sql-mysql.test.ts).
// PostgreSQL and SQLite used to leave it null and report the count only in
// `count`, so there was no single property that worked on every adapter
// (issue #40432). The SQLite coverage lives in sqlite-sql.test.ts.
import { randomUUIDv7, SQL } from "bun";
import { expect, test } from "bun:test";
import { describeWithContainer } from "harness";

describeWithContainer("postgres", { image: "postgres_plain" }, container => {
  const url = () => `postgres://bun_sql_test@${container.host}:${container.port}/bun_sql_test`;

  test("affectedRows reports rows changed by writes", async () => {
    await container.ready;
    await using sql = new SQL({ url: url(), max: 1, idleTimeout: 5, connectionTimeout: 5 });
    const table = sql("t_" + randomUUIDv7("hex").replaceAll("-", ""));

    const created = await sql`CREATE TEMPORARY TABLE ${table} (id int, price int)`;
    expect(created.affectedRows).toBe(0);

    const inserted = await sql`INSERT INTO ${table} VALUES (1, 10), (2, 20), (3, 30)`;
    expect(inserted.affectedRows).toBe(3);
    expect(inserted.count).toBe(3);

    const updated = await sql`UPDATE ${table} SET price = price + 1 WHERE price < 25`;
    expect(updated.affectedRows).toBe(2);

    const returning = await sql`UPDATE ${table} SET price = 0 WHERE id IN (1, 2) RETURNING id`;
    expect(returning).toHaveLength(2);
    expect(returning.affectedRows).toBe(2);

    const selected = await sql`SELECT * FROM ${table}`;
    expect(selected.affectedRows).toBe(0);
    expect(selected.count).toBe(3);

    const deleted = await sql`DELETE FROM ${table} WHERE id > 1`;
    expect(deleted.affectedRows).toBe(2);

    // a write inside a CTE under a top-level SELECT is tagged SELECT by the server
    const cteDelete = await sql`WITH gone AS (DELETE FROM ${table} RETURNING id) SELECT * FROM gone`;
    expect(cteDelete).toHaveLength(1);
    expect(cteDelete.command).toBe("SELECT");
    expect(cteDelete.affectedRows).toBe(0);
  });
});
