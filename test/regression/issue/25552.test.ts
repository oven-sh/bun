import { SQL, randomUUIDv7 } from "bun";
import { beforeEach, expect, test } from "bun:test";
import { describeWithContainer } from "harness";

// Regression test for https://github.com/oven-sh/bun/issues/25552
// MySQL transactions hang on Windows when attempting to start a second sequential transaction.
// This was caused by the same issue fixed in #26030: queries added during JavaScript callbacks
// were not properly flushed, causing the connection to wait for data that was never sent.

describeWithContainer(
  "mysql",
  {
    image: "mysql_plain",
    env: {},
    args: [],
  },
  container => {
    const getOptions = () => ({
      url: `mysql://root@${container.host}:${container.port}/bun_sql_test`,
      max: 1,
      bigint: true,
    });

    beforeEach(async () => {
      await container.ready;
    });

    test("Sequential transactions with multiple INSERTs should not hang", async () => {
      await using sql = new SQL(getOptions());
      const random_name = ("t_" + randomUUIDv7("hex").replaceAll("-", "")).toLowerCase();

      // Create table similar to the issue reproduction
      await sql`CREATE TABLE IF NOT EXISTS ${sql(random_name)} (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        code VARCHAR(25) NOT NULL UNIQUE,
        created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )`;

      try {
        // Phase 1 - First transaction with multiple INSERTs
        await sql.begin(async tx => {
          await tx`INSERT INTO ${sql(random_name)} (name, code) VALUES (${"Name 11"}, ${"CODE_11"})`;
          await tx`INSERT INTO ${sql(random_name)} (name, code) VALUES (${"Name 12"}, ${"CODE_12"})`;
        });

        // Phase 2 - Second sequential transaction (this would hang before the fix)
        await sql.begin(async tx => {
          await tx`INSERT INTO ${sql(random_name)} (name, code) VALUES (${"Name 21"}, ${"CODE_21"})`;
          await tx`INSERT INTO ${sql(random_name)} (name, code) VALUES (${"Name 22"}, ${"CODE_22"})`;
        });

        // Verify all 4 rows were inserted
        const count = await sql`SELECT COUNT(*) as count FROM ${sql(random_name)}`;
        expect(Number(count[0].count)).toBe(4);
      } finally {
        await sql`DROP TABLE IF EXISTS ${sql(random_name)}`;
      }
    });

    test("Multiple sequential transactions in a loop should not hang", async () => {
      await using sql = new SQL(getOptions());
      const random_name = ("t_" + randomUUIDv7("hex").replaceAll("-", "")).toLowerCase();

      await sql`CREATE TABLE IF NOT EXISTS ${sql(random_name)} (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        code VARCHAR(25) NOT NULL UNIQUE
      )`;

      try {
        // Run multiple sequential transactions in a loop
        for (let i = 0; i < 5; i++) {
          await sql.begin(async tx => {
            await tx`INSERT INTO ${sql(random_name)} (name, code) VALUES (${`Name ${i}`}, ${`CODE_${i}`})`;
          });
        }

        // Verify all 5 rows were inserted
        const count = await sql`SELECT COUNT(*) as count FROM ${sql(random_name)}`;
        expect(Number(count[0].count)).toBe(5);
      } finally {
        await sql`DROP TABLE IF EXISTS ${sql(random_name)}`;
      }
    });

    test("Sequential transactions with unsafe() should not hang", async () => {
      await using sql = new SQL(getOptions());
      const random_name = ("t_" + randomUUIDv7("hex").replaceAll("-", "")).toLowerCase();

      // Create table similar to the issue reproduction
      await sql`CREATE TABLE IF NOT EXISTS ${sql(random_name)} (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        code VARCHAR(25) NOT NULL UNIQUE
      )`;

      try {
        // Phase 1 - Using unsafe() as shown in the original issue
        await sql.begin(async tx => {
          await tx.unsafe("INSERT INTO " + random_name + " (name, code) VALUES (?, ?)", ["Name 11", "CODE_11"]);
          await tx.unsafe("INSERT INTO " + random_name + " (name, code) VALUES (?, ?)", ["Name 12", "CODE_12"]);
        });

        // Phase 2 - This would hang before the fix
        await sql.begin(async tx => {
          await tx.unsafe("INSERT INTO " + random_name + " (name, code) VALUES (?, ?)", ["Name 21", "CODE_21"]);
          await tx.unsafe("INSERT INTO " + random_name + " (name, code) VALUES (?, ?)", ["Name 22", "CODE_22"]);
        });

        // Verify all 4 rows were inserted
        const count = await sql`SELECT COUNT(*) as count FROM ${sql(random_name)}`;
        expect(Number(count[0].count)).toBe(4);
      } finally {
        await sql`DROP TABLE IF EXISTS ${sql(random_name)}`;
      }
    });
  },
);
