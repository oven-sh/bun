// Regression test: MySQLConnection cached a prepared statement whose
// COM_STMT_PREPARE failed (status = .failed) in the per-connection statement map
// and never evicted it, so every later execution of the same query text on that
// connection rethrew the stale ErrorPacket without ever re-preparing. A
// transient prepare-time error (a table created by a concurrent migration, a
// deadlock, ER_TOO_MANY_CONCURRENT_STMTS) therefore poisoned the connection for
// the process lifetime. handlePreparedStatement now evicts the failed statement
// from the map (as the Postgres driver already did) so the prepare is retried on
// the next use of that text.
//
// This file previously asserted the opposite (Com_stmt_prepare must NOT
// increment across an identical re-run) to pin a dangling-slice read in the
// cached ErrorPacket's error_message; that cache-hit path no longer exists.
// test/js/sql/sql-mysql-failed-prepare-retry.test.ts is the wire-level
// counterpart that runs without a container.

import { SQL, randomUUIDv7 } from "bun";
import { expect, test } from "bun:test";
import { describeWithContainer, isDockerEnabled } from "harness";

if (isDockerEnabled()) {
  describeWithContainer("mysql", { image: "mysql_plain" }, container => {
    test("MySQL: a failed prepare is re-prepared instead of served from the statement cache", async () => {
      await container.ready;
      // max: 1 so every query runs on the same connection / same statement map,
      // and Com_stmt_prepare (a SESSION counter) observes exactly that session.
      await using sql = new SQL({
        url: `mysql://root@${container.host}:${container.port}/bun_sql_test`,
        max: 1,
      });

      const table = "t_retry_" + randomUUIDv7("hex").replaceAll("-", "");
      // .simple() = COM_QUERY (text protocol), so the counter read itself never
      // sends a COM_STMT_PREPARE.
      const prepares = async () =>
        Number((await sql.unsafe("SHOW SESSION STATUS LIKE 'Com_stmt_prepare'").simple())[0].Value);

      try {
        // 1. The table does not exist yet: the prepare fails (ER_NO_SUCH_TABLE).
        const err1 = await sql`SELECT n FROM ${sql(table)}`.catch((x: any) => x);
        expect(err1).toBeInstanceOf(Error);
        expect(err1.errno).toBe(1146);
        const afterFirst = await prepares();
        expect(afterFirst).toBeGreaterThan(0);

        // 2. Same text, table still missing. Before the fix the stale cached
        //    ErrorPacket was replayed and the server never saw a second
        //    COM_STMT_PREPARE; now Bun re-prepares and the server answers the
        //    same (still true) error.
        const err2 = await sql`SELECT n FROM ${sql(table)}`.catch((x: any) => x);
        expect({ errno: err2.errno, message: err2.message, prepares: await prepares() }).toEqual({
          errno: 1146,
          message: err1.message,
          prepares: afterFirst + 1,
        });

        // 3. The migration lands. The same text on the same connection must now
        //    prepare successfully and return rows.
        await sql.unsafe(`CREATE TABLE \`${table}\` (n INT)`).simple();
        await sql.unsafe(`INSERT INTO \`${table}\` VALUES (42)`).simple();
        const beforeThird = await prepares();
        expect(await sql`SELECT n FROM ${sql(table)}`).toEqual([{ n: 42 }]);
        expect(await prepares()).toBe(beforeThird + 1);

        // 4. Only Failed entries are evicted: the now-Prepared statement is
        //    served from the cache, so the counter does not move.
        expect(await sql`SELECT n FROM ${sql(table)}`).toEqual([{ n: 42 }]);
        expect(await prepares()).toBe(beforeThird + 1);
      } finally {
        await sql
          .unsafe(`DROP TABLE IF EXISTS \`${table}\``)
          .simple()
          .catch(() => {});
      }
    });
  });
}
