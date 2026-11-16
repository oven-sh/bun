import { SQL, randomUUIDv7 } from "bun";
import { expect, test } from "bun:test";
import { describeWithContainer } from "harness";

const outcome = (query: Promise<unknown>) =>
  query.then(
    rows => rows,
    reason => ({
      rejected: {
        type: reason?.constructor?.name,
        errno: reason?.errno,
        sqlState: reason?.sqlState,
        message: reason?.message,
      },
    }),
  );
const noSuchTable = (table: string) => ({
  rejected: {
    type: "MySQLError",
    errno: 1146,
    sqlState: "42S02",
    message: `Table 'bun_sql_test.${table}' doesn't exist`,
  },
});
const newTable = () => "t_" + randomUUIDv7("hex").replaceAll("-", "");

// A simple query reads the counter, so the read does not count.
const prepares = async (sql: SQL) =>
  Number((await sql.unsafe("SHOW SESSION STATUS LIKE 'Com_stmt_prepare'").simple())[0].Value);

for (const image of ["mysql_plain", "mariadb_plain"]) {
  describeWithContainer(image, { image, concurrent: true }, container => {
    // One connection, so that every query uses the same statement cache.
    async function connect() {
      await container.ready;
      return new SQL({ url: `mysql://root@${container.host}:${container.port}/bun_sql_test`, max: 1 });
    }

    async function each(sql: SQL, queries: (() => Promise<unknown>)[]) {
      const outcomes: unknown[] = [];
      const prepared: number[] = [];
      for (const query of queries) {
        const before = await prepares(sql);
        outcomes.push(await outcome(query()));
        prepared.push((await prepares(sql)) - before);
      }
      return { outcomes, prepared };
    }

    const createTable = async (sql: SQL, table: string) => {
      await sql.unsafe(`CREATE TABLE \`${table}\` (id INT PRIMARY KEY, n INT)`).simple();
      await sql.unsafe(`INSERT INTO \`${table}\` VALUES (42, 7)`).simple();
    };
    const dropTable = (sql: SQL, table: string) => sql.unsafe(`DROP TABLE IF EXISTS \`${table}\``).simple();

    test.each<[string, (sql: SQL, table: string) => Promise<unknown>]>([
      ["a parameter", (sql, table) => sql`SELECT n FROM ${sql(table)} WHERE id = ${42}`],
      ["no parameter", (sql, table) => sql`SELECT n FROM ${sql(table)}`],
    ])("a query with %s on a table that did not exist finds the table after it is created", async (_, query) => {
      await using sql = await connect();
      const table = newTable();
      const select = () => query(sql, table);

      try {
        const missing = await each(sql, [select, select]);
        await createTable(sql, table);
        const created = await each(sql, [select, select]);

        expect({ missing, created }).toEqual({
          missing: { outcomes: [noSuchTable(table), noSuchTable(table)], prepared: [1, 1] },
          // The second query uses the statement that the first one prepared.
          created: { outcomes: [[{ n: 7 }], [{ n: 7 }]], prepared: [1, 0] },
        });
      } finally {
        await dropTable(sql, table);
      }
    });

    test("a failed prepare leaves the other statements in the cache", async () => {
      await using sql = await connect();
      const table = newTable();
      // A string: for `SELECT ?` with a number, MySQL 8.4 prepares the statement
      // again at its first execute and counts that.
      const healthy = () => sql`SELECT ${"h"} AS healthy`;
      const missing = () => sql`SELECT n FROM ${sql(table)} WHERE id = ${42}`;

      expect(await each(sql, [healthy, missing, healthy, missing, healthy])).toEqual({
        outcomes: [[{ healthy: "h" }], noSuchTable(table), [{ healthy: "h" }], noSuchTable(table), [{ healthy: "h" }]],
        prepared: [1, 1, 0, 1, 0],
      });
    });

    test("queries with one text that start in one tick each get the server's answer", async () => {
      await using sql = await connect();
      const table = newTable();
      const select = () => sql`SELECT n FROM ${sql(table)} WHERE id = ${42}`;
      const filler = Buffer.alloc(1024, "Z").toString();

      const before = await prepares(sql);
      const outcomes = await Promise.all([select(), sql`SELECT ${filler} AS x`, select()].map(outcome));
      expect({ outcomes, prepared: (await prepares(sql)) - before }).toEqual({
        outcomes: [noSuchTable(table), [{ x: filler }], noSuchTable(table)],
        prepared: 3,
      });
    });
  });
}
