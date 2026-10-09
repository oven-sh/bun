// MySQL's binary result-row protocol transmits MYSQL_TYPE_INT24 (MEDIUMINT) as
// a fixed 4-byte field. The decoder used to consume only 3, leaving the cursor
// 1 byte behind and corrupting every column that follows (or hanging on a
// length-prefixed column like VARCHAR).

import { SQL, randomUUIDv7 } from "bun";
import { expect, test } from "bun:test";
import { describeWithContainer, isDockerEnabled } from "harness";

if (isDockerEnabled()) {
  describeWithContainer("mysql", { image: "mysql_plain" }, container => {
    test("MEDIUMINT before other columns is read as 4 bytes (binary protocol)", async () => {
      await container.ready;
      await using sql = new SQL({ url: `mysql://root@${container.host}:${container.port}/bun_sql_test`, max: 1 });

      const table = ("t_" + randomUUIDv7("hex").replaceAll("-", "")).toLowerCase();
      try {
        await sql`
        CREATE TEMPORARY TABLE ${sql(table)} (
          id      INT,
          uviews  MEDIUMINT UNSIGNED,
          sviews  MEDIUMINT,
          balance BIGINT,
          ratio   DOUBLE,
          name    VARCHAR(255)
        )
      `.simple();
        await sql`INSERT INTO ${sql(table)} (id, uviews, sviews, balance, ratio, name) VALUES (1, 100, -50, 5000, 3.5, 'alice')`.simple();

        // Prepared → binary protocol. If the decoder consumes only 3 of the 4
        // INT24 bytes the cursor desyncs into balance/ratio/name and this row
        // either hangs on the VARCHAR length prefix or returns garbage.
        const [row] = await sql`SELECT id, uviews, sviews, balance, ratio, name FROM ${sql(table)}`;
        expect(row).toEqual({ id: 1, uviews: 100, sviews: -50, balance: 5000, ratio: 3.5, name: "alice" });

        const [rawRow] = await sql`SELECT id, uviews, sviews, balance, ratio, name FROM ${sql(table)}`.raw();
        expect(rawRow).toHaveLength(6);
        expect(rawRow[1]).toEqual(new Uint8Array([0x64, 0x00, 0x00])); // 100
        expect(rawRow[2]).toEqual(new Uint8Array([0xce, 0xff, 0xff])); // -50 as i24 LE
        expect(Buffer.from(rawRow[5]).toString("utf-8")).toBe("alice");
      } finally {
        await sql`DROP TABLE IF EXISTS ${sql(table)}`.simple();
      }
    });
  });
}
