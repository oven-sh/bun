// https://github.com/oven-sh/bun/issues/28632
import { SQL } from "bun";
import { afterAll, beforeAll, expect, test } from "bun:test";
import { describeWithContainer, expectRssDeltaBelow } from "harness";
import path from "node:path";

// The server re-sends one column definition per column with every
// COM_STMT_EXECUTE response, and the adapter keeps an owned copy of each
// column name (`name_or_index`). The original bug leaked that copy on every
// re-decode, so the leak per query scales with the column count and the name
// length. MySQL caps identifiers at 64 bytes; 500 columns stay under MariaDB's
// table-definition size limit.
const COLUMNS = 500;
const columns = Array.from({ length: COLUMNS }, (_, i) => `col_${i}_`.padEnd(64, "x"));
const fixture = path.join(import.meta.dir, "28632.fixture.ts");

describeWithContainer(
  "issue #28632: MySQL adapter should not leak memory on repeated queries",
  {
    image: "mysql_plain",
    concurrent: true,
  },
  container => {
    let url: string;

    beforeAll(async () => {
      await container.ready;
      url = `mysql://root@${container.host}:${container.port}/bun_sql_test`;
      await using sql = new SQL({ url, max: 1 });
      await sql.unsafe(`DROP TABLE IF EXISTS leak_test_28632`);
      await sql.unsafe(
        `CREATE TABLE leak_test_28632 (primary_id VARCHAR(255) PRIMARY KEY, ${columns.map(name => `${name} TINYINT`).join(", ")})`,
      );
      await sql`INSERT INTO leak_test_28632 (primary_id) VALUES (${"123"})`;
    });

    afterAll(async () => {
      // afterAll still runs when beforeAll failed before it assigned `url`.
      if (!url) return;
      await using sql = new SQL({ url, max: 1 });
      await sql.unsafe(`DROP TABLE IF EXISTS leak_test_28632`);
    });

    test("SELECT * returns the row with every column", async () => {
      await using sql = new SQL({ url, max: 1 });
      const objects = await sql`SELECT * FROM leak_test_28632 WHERE primary_id = ${"123"} LIMIT 1`;
      expect(objects).toEqual([{ primary_id: "123", ...Object.fromEntries(columns.map(name => [name, null])) }]);
      const values = await sql`SELECT * FROM leak_test_28632 WHERE primary_id = ${"123"} LIMIT 1`.values();
      expect(values).toEqual([["123", ...new Array(COLUMNS).fill(null)]]);
    });

    test("prepared statement re-execution should not leak name_or_index", async () => {
      // Unfixed: one 64-byte block leaks per column per query, so the
      // fixture's 300 measured queries over 500 columns leak 150,000 blocks:
      // at least 9.6 MiB under mimalloc (release), and 15 to 17 MiB measured
      // under ASAN, where each block also carries a header and redzone.
      // Fixed: 0 to 1 MiB (release) and 0 to 3 MiB (debug/ASAN, quarantine
      // off) after the fixture's 100-query warm-up.
      await expectRssDeltaBelow([fixture, url, String(COLUMNS)], { release: 5, debug: 8 });
    });
  },
);
