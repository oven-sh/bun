// https://github.com/oven-sh/bun/issues/24850
//
// Calling a MySQL stored procedure via the prepared-statement path returned
// the first result set and then leaked an error for the trailing OK packet,
// because the prepared branch of onResolveMySQLQuery resolved on the first
// result instead of waiting for SERVER_MORE_RESULTS_EXISTS to clear.

import { SQL } from "bun";
import { afterAll, beforeAll, expect, test } from "bun:test";
import { describeWithContainer } from "harness";

describeWithContainer(
  "MySQL stored procedure multi-result (#24850)",
  { image: "mysql_plain", concurrent: true },
  container => {
    let sql: SQL;

    beforeAll(async () => {
      await container.ready;
      sql = new SQL({
        url: `mysql://root:@${container.host}:${container.port}/bun_sql_test`,
        max: 1,
      });

      await sql.unsafe(`DROP PROCEDURE IF EXISTS bun_24850`);
      await sql.unsafe(`
        CREATE PROCEDURE bun_24850(IN p JSON)
        BEGIN
          SELECT JSON_VALUE(p, '$.id') + 0 AS id, JSON_VALUE(p, '$.value') AS value;
        END
      `);
    });

    afterAll(async () => {
      await sql?.unsafe(`DROP PROCEDURE IF EXISTS bun_24850`).catch(() => {});
      await sql?.close();
    });

    test("CALL via prepared statement returns rows without leaking an error", async () => {
      const param = JSON.stringify({ id: 7, value: "hello" });
      const result = await sql`CALL bun_24850(${param})`;

      // CALL produces the SELECT result set followed by a final OK packet, so
      // the resolved value is an array of result sets.
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(2);

      const [rows, ok] = result as any;
      expect(rows[0]).toEqual({ id: 7, value: "hello" });
      expect(ok.length).toBe(0);

      // Connection must remain usable; before the fix the leaked second result
      // desynchronised the request queue and the next query observed the error.
      const [{ x }] = await sql`SELECT 1 AS x`;
      expect(x).toBe(1);
    });

    test("CALL via sql.unsafe (text protocol) still returns multi-result", async () => {
      const result = await sql.unsafe(`CALL bun_24850('{"id": 3, "value": "world"}')`);
      expect(result.length).toBe(2);
      const [rows] = result as any;
      expect(rows[0]).toEqual({ id: 3, value: "world" });
    });
  },
);
