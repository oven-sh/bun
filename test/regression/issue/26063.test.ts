import { SQL, randomUUIDv7 } from "bun";
import { afterAll, beforeAll, expect, test } from "bun:test";
import { describeWithContainer } from "harness";

// Regression test for https://github.com/oven-sh/bun/issues/26063
// Since 1.3.6, MySQL VARCHAR/CHAR/TEXT columns with a binary collation (like
// utf8mb4_bin) were returned as Buffer instead of string: such columns carry the
// BINARY column flag, and the decoder treated that flag alone as "true binary
// column". Only columns with the binary pseudo-charset (BINARY, VARBINARY, BLOB)
// may decode as Buffer. Both decode paths were affected: the binary protocol
// (prepared statements) and the text protocol (.simple()).

describeWithContainer(
  "issue #26063: VARCHAR with binary collation returns Buffer instead of string",
  {
    image: "mysql_plain",
    concurrent: true,
  },
  container => {
    let sql: SQL;
    const table = "test_" + randomUUIDv7("hex").replaceAll("-", "");

    const rows = [
      {
        id: "1",
        code: "ABC",
        content: "Hello, World!",
        bin: Buffer.from([1, 2, 3, 4]),
        varbin: Buffer.from([5, 6]),
        blob_col: Buffer.from([7, 8, 9]),
      },
      {
        id: "2",
        code: "XYZ",
        content: "naïve 🙂",
        bin: Buffer.from([0xde, 0xad, 0xbe, 0xef]),
        varbin: Buffer.from([0, 255]),
        blob_col: Buffer.from("blob"),
      },
      // Empty/NULL edges: an empty string must stay a string, a zero-length
      // buffer must stay a Buffer, and NULL must decode as null.
      {
        id: "3",
        code: "",
        content: null,
        bin: null,
        varbin: Buffer.alloc(0),
        blob_col: null,
      },
    ];

    beforeAll(async () => {
      await container.ready;
      // Temporary tables are connection-scoped; max: 1 keeps every query on the
      // connection that created the table.
      sql = new SQL({
        url: `mysql://root@${container.host}:${container.port}/bun_sql_test`,
        max: 1,
      });
      // One table covers the whole matrix: _bin-collated string columns
      // (VARCHAR, CHAR, TEXT) next to true binary columns (BINARY, VARBINARY, BLOB).
      // The table-level collation stays non-binary so the _bin collations are
      // explicit column-level overrides, matching the original report.
      await sql`
        CREATE TEMPORARY TABLE ${sql(table)} (
          id VARCHAR(32) COLLATE utf8mb4_bin NOT NULL,
          code CHAR(10) COLLATE utf8mb4_bin NOT NULL,
          content TEXT COLLATE utf8mb4_bin,
          bin BINARY(4),
          varbin VARBINARY(10),
          blob_col BLOB,
          PRIMARY KEY (id)
        ) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `;
      await sql`INSERT INTO ${sql(table)} ${sql(rows)}`;
    });

    afterAll(async () => {
      await sql.close();
    });

    function decodedType(value: unknown): string {
      return value === null ? "null" : Buffer.isBuffer(value) ? "Buffer" : typeof value;
    }

    function typeMap(row: Record<string, unknown>) {
      return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, decodedType(value)]));
    }

    function expectDecodedRows(result: Record<string, unknown>[]) {
      // The _bin collation columns must decode as strings; only the
      // binary-pseudo-charset columns may come back as Buffer.
      expect(result.map(typeMap)).toEqual(rows.map(typeMap));
      expect(result).toEqual(rows);
    }

    test("binary protocol (prepared statement)", async () => {
      expectDecodedRows(await sql`SELECT * FROM ${sql(table)} ORDER BY id`);
    });

    test("text protocol (simple query)", async () => {
      expectDecodedRows(await sql`SELECT * FROM ${sql(table)} ORDER BY id`.simple());
    });
  },
);
