import { SQL, randomUUIDv7 } from "bun";
import { beforeEach, expect, test } from "bun:test";
import { describeWithContainer } from "harness";

// https://github.com/oven-sh/bun/issues/27102
// After a sql.begin() transaction completes, subsequent queries would silently
// fail because data was queued but never flushed to the socket.
describeWithContainer(
  "mysql",
  {
    image: "mysql_plain",
  },
  container => {
    const getOptions = (): Bun.SQL.Options => ({
      url: `mysql://root@${container.host}:${container.port}/bun_sql_test`,
      max: 1,
    });

    beforeEach(async () => {
      await container.ready;
    });

    test("queries work after transaction completes", async () => {
      await using sql = new SQL(getOptions());

      // Initial query works fine
      const [before] = await sql`SELECT 1 as ok`;
      expect(before.ok).toBe(1);

      // Transaction completes successfully
      await sql.begin(async sql => {
        await sql`SELECT 1`;
      });

      // This query should work but previously caused silent process exit
      const [after] = await sql`SELECT 2 as ok`;
      expect(after.ok).toBe(2);
    });

    test("queries work after transaction with table operations", async () => {
      await using sql = new SQL(getOptions());
      const table = ("t_" + randomUUIDv7("hex").replaceAll("-", "")).toLowerCase();

      await sql`CREATE TEMPORARY TABLE ${sql(table)} (id int, val text)`;

      // Transaction with actual work
      await sql.begin(async tx => {
        await tx`INSERT INTO ${sql(table)} VALUES (1, 'hello')`;
        await tx`INSERT INTO ${sql(table)} VALUES (2, 'world')`;
      });

      // Post-transaction queries must still work
      const rows = await sql`SELECT * FROM ${sql(table)} ORDER BY id`;
      expect(rows.length).toBe(2);
      expect(rows[0].val).toBe("hello");
      expect(rows[1].val).toBe("world");

      // And another transaction should also work
      await sql.begin(async tx => {
        await tx`INSERT INTO ${sql(table)} VALUES (3, 'again')`;
      });

      const rows2 = await sql`SELECT * FROM ${sql(table)} ORDER BY id`;
      expect(rows2.length).toBe(3);
    });

    test("multiple sequential transactions work", async () => {
      await using sql = new SQL(getOptions());

      for (let i = 0; i < 5; i++) {
        await sql.begin(async tx => {
          const [row] = await tx`SELECT ${i} as val`;
          expect(row.val).toBe(i);
        });

        // Query after each transaction
        const [row] = await sql`SELECT ${i + 100} as val`;
        expect(row.val).toBe(i + 100);
      }
    });
  },
);
