import { SQL, randomUUIDv7 } from "bun";
import { afterAll, beforeAll, expect, test } from "bun:test";
import { describeWithContainer, isDockerEnabled } from "harness";

// Regression test for https://github.com/oven-sh/bun/issues/26063
// MySQL VARCHAR columns with binary collations (like utf8mb4_bin) were incorrectly
// returned as Buffer instead of string since version 1.3.6.

if (isDockerEnabled()) {
  describeWithContainer(
    "issue #26063: VARCHAR with binary collation returns Buffer instead of string",
    {
      image: "mysql_plain",
      concurrent: true,
    },
    container => {
      let sql: SQL;

      beforeAll(async () => {
        await container.ready;
        sql = new SQL({
          url: `mysql://root@${container.host}:${container.port}/bun_sql_test`,
          max: 1,
        });
      });

      afterAll(async () => {
        await sql.close();
      });

      test("VARCHAR with utf8mb4_bin collation should return string (binary protocol)", async () => {
        const tableName = "test_" + randomUUIDv7("hex").replaceAll("-", "");

        await sql`
          CREATE TEMPORARY TABLE ${sql(tableName)} (
            id VARCHAR(32) COLLATE utf8mb4_bin NOT NULL,
            PRIMARY KEY (id)
          ) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `;

        await sql`INSERT INTO ${sql(tableName)} ${sql([{ id: "1" }, { id: "2" }])}`;

        const result = await sql`SELECT * FROM ${sql(tableName)}`;

        // Should return strings, not Buffers
        expect(typeof result[0].id).toBe("string");
        expect(typeof result[1].id).toBe("string");
        expect(result[0].id).toBe("1");
        expect(result[1].id).toBe("2");
      });

      test("VARCHAR with utf8mb4_bin collation should return string (text protocol)", async () => {
        const tableName = "test_" + randomUUIDv7("hex").replaceAll("-", "");

        await sql`
          CREATE TEMPORARY TABLE ${sql(tableName)} (
            id VARCHAR(32) COLLATE utf8mb4_bin NOT NULL,
            PRIMARY KEY (id)
          ) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `;

        await sql`INSERT INTO ${sql(tableName)} ${sql([{ id: "1" }, { id: "2" }])}`;

        // Use .simple() to force text protocol
        const result = await sql`SELECT * FROM ${sql(tableName)}`.simple();

        // Should return strings, not Buffers
        expect(typeof result[0].id).toBe("string");
        expect(typeof result[1].id).toBe("string");
        expect(result[0].id).toBe("1");
        expect(result[1].id).toBe("2");
      });

      test("CHAR with utf8mb4_bin collation should return string", async () => {
        const tableName = "test_" + randomUUIDv7("hex").replaceAll("-", "");

        await sql`
          CREATE TEMPORARY TABLE ${sql(tableName)} (
            code CHAR(10) COLLATE utf8mb4_bin NOT NULL
          )
        `;

        await sql`INSERT INTO ${sql(tableName)} VALUES (${"ABC"})`;

        const result = await sql`SELECT * FROM ${sql(tableName)}`;
        const resultSimple = await sql`SELECT * FROM ${sql(tableName)}`.simple();

        // Should return strings, not Buffers
        expect(typeof result[0].code).toBe("string");
        expect(typeof resultSimple[0].code).toBe("string");
      });

      test("TEXT with utf8mb4_bin collation should return string", async () => {
        const tableName = "test_" + randomUUIDv7("hex").replaceAll("-", "");

        await sql`
          CREATE TEMPORARY TABLE ${sql(tableName)} (
            content TEXT COLLATE utf8mb4_bin
          )
        `;

        await sql`INSERT INTO ${sql(tableName)} VALUES (${"Hello, World!"})`;

        const result = await sql`SELECT * FROM ${sql(tableName)}`;
        const resultSimple = await sql`SELECT * FROM ${sql(tableName)}`.simple();

        // Should return strings, not Buffers
        expect(typeof result[0].content).toBe("string");
        expect(result[0].content).toBe("Hello, World!");
        expect(typeof resultSimple[0].content).toBe("string");
        expect(resultSimple[0].content).toBe("Hello, World!");
      });

      test("true BINARY/VARBINARY columns should still return Buffer", async () => {
        const tableName = "test_" + randomUUIDv7("hex").replaceAll("-", "");

        await sql`
          CREATE TEMPORARY TABLE ${sql(tableName)} (
            a BINARY(4),
            b VARBINARY(10),
            c BLOB
          )
        `;

        await sql`INSERT INTO ${sql(tableName)} VALUES (${Buffer.from([1, 2, 3, 4])}, ${Buffer.from([5, 6])}, ${Buffer.from([7, 8, 9])})`;

        const result = await sql`SELECT * FROM ${sql(tableName)}`;
        const resultSimple = await sql`SELECT * FROM ${sql(tableName)}`.simple();

        // True binary types should return Buffers
        expect(Buffer.isBuffer(result[0].a)).toBe(true);
        expect(Buffer.isBuffer(result[0].b)).toBe(true);
        expect(Buffer.isBuffer(result[0].c)).toBe(true);
        expect(Buffer.isBuffer(resultSimple[0].a)).toBe(true);
        expect(Buffer.isBuffer(resultSimple[0].b)).toBe(true);
        expect(Buffer.isBuffer(resultSimple[0].c)).toBe(true);
      });
    },
  );
}
