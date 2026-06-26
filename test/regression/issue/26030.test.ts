import { SQL, randomUUIDv7 } from "bun";
import { beforeEach, expect, test } from "bun:test";
import { describeWithContainer } from "harness";

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

    // Regression test for https://github.com/oven-sh/bun/issues/26030
    // Bun hangs when executing multiple sequential MySQL transactions in a loop where:
    // 1. An INSERT is awaited inside the transaction callback
    // 2. A SELECT query (e.g., SELECT LAST_INSERT_ID()) is returned as an array without being awaited
    test("Sequential transactions with INSERT and returned SELECT should not hang", async () => {
      await using sql = new SQL(getOptions());
      const random_name = ("t_" + randomUUIDv7("hex").replaceAll("-", "")).toLowerCase();

      // Create a table similar to the reproduction case
      await sql`CREATE TABLE IF NOT EXISTS ${sql(random_name)} (
        id INT AUTO_INCREMENT PRIMARY KEY,
        contract_name VARCHAR(255),
        amount INT
      )`;

      try {
        const rows = [
          { contract_name: "Contract A", amount: 100000 },
          { contract_name: "Contract B", amount: 200000 },
          { contract_name: "Contract C", amount: 300000 },
        ];

        const contractIds: number[] = [];

        for (const row of rows) {
          // This is the pattern from the bug report:
          // - INSERT is awaited
          // - SELECT LAST_INSERT_ID() is returned as array (not awaited individually)
          const [[result]] = await sql.begin(async tx => {
            await tx`
              INSERT INTO ${sql(random_name)} (contract_name, amount)
              VALUES (${row.contract_name}, ${row.amount})
            `;
            // Return array with non-awaited query - this triggers the hang
            return [tx`SELECT LAST_INSERT_ID() as id`];
          });

          contractIds.push(Number(result.id));
        }

        // Verify all transactions completed
        expect(contractIds.length).toBe(3);
        expect(contractIds[0]).toBe(1);
        expect(contractIds[1]).toBe(2);
        expect(contractIds[2]).toBe(3);

        // Verify data in database
        const count = await sql`SELECT COUNT(*) as count FROM ${sql(random_name)}`;
        expect(Number(count[0].count)).toBe(3);
      } finally {
        await sql`DROP TABLE IF EXISTS ${sql(random_name)}`;
      }
    });

    test("Sequential transactions with returned array of multiple queries", async () => {
      await using sql = new SQL(getOptions());
      const random_name = ("t_" + randomUUIDv7("hex").replaceAll("-", "")).toLowerCase();

      await sql`CREATE TABLE IF NOT EXISTS ${sql(random_name)} (
        id INT AUTO_INCREMENT PRIMARY KEY,
        value INT
      )`;

      try {
        for (let i = 0; i < 3; i++) {
          const results = await sql.begin(async tx => {
            await tx`INSERT INTO ${sql(random_name)} (value) VALUES (${i * 10})`;
            // Return multiple queries as array
            return [tx`SELECT LAST_INSERT_ID() as id`, tx`SELECT COUNT(*) as count FROM ${sql(random_name)}`];
          });

          expect(results.length).toBe(2);
        }

        const count = await sql`SELECT COUNT(*) as count FROM ${sql(random_name)}`;
        expect(Number(count[0].count)).toBe(3);
      } finally {
        await sql`DROP TABLE IF EXISTS ${sql(random_name)}`;
      }
    });

    test("Many sequential transactions with awaited INSERT and returned SELECT", async () => {
      await using sql = new SQL(getOptions());
      const random_name = ("t_" + randomUUIDv7("hex").replaceAll("-", "")).toLowerCase();

      await sql`CREATE TABLE IF NOT EXISTS ${sql(random_name)} (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255)
      )`;

      try {
        // Multiple sequential transactions with awaited INSERT and returned SELECT
        for (let i = 0; i < 5; i++) {
          const [[result]] = await sql.begin(async tx => {
            // First insert
            await tx`INSERT INTO ${sql(random_name)} (name) VALUES (${"item_" + i})`;
            // Return array with SELECT
            return [tx`SELECT LAST_INSERT_ID() as id`];
          });

          expect(Number(result.id)).toBe(i + 1);
        }

        const count = await sql`SELECT COUNT(*) as count FROM ${sql(random_name)}`;
        expect(Number(count[0].count)).toBe(5);
      } finally {
        await sql`DROP TABLE IF EXISTS ${sql(random_name)}`;
      }
    });
  },
);
