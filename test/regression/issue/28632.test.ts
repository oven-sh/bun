// https://github.com/oven-sh/bun/issues/28632
import { SQL } from "bun";
import { beforeAll, expect, test } from "bun:test";
import { describeWithContainer, isASAN, isDockerEnabled } from "harness";

if (isDockerEnabled()) {
  describeWithContainer(
    "issue #28632: MySQL adapter should not leak memory on repeated queries",
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

      test("prepared statement re-execution should not leak name_or_index", async () => {
        // Create a wide table to amplify the per-column leak signal
        await sql`DROP TABLE IF EXISTS leak_test_28632`;
        await sql`CREATE TABLE leak_test_28632 (
          primary_id VARCHAR(255) PRIMARY KEY,
          column_alpha_bravo TEXT, column_charlie_delta TEXT, column_echo_foxtrot TEXT,
          column_golf_hotel TEXT, column_india_juliet TEXT, column_kilo_lima TEXT,
          column_mike_november TEXT, column_oscar_papa TEXT, column_quebec_romeo TEXT,
          column_sierra_tango TEXT, column_uniform_victor TEXT, column_whiskey_xray TEXT,
          column_yankee_zulu TEXT, column_one_two_three TEXT, column_four_five_six TEXT,
          column_seven_eight TEXT, column_nine_ten TEXT, column_eleven_twelve TEXT,
          column_thirteen_fourtn TEXT, column_fifteen_sixtn TEXT, column_seventeen TEXT,
          column_eighteen TEXT, column_nineteen TEXT, column_twenty_extra TEXT,
          column_twentyone TEXT, column_twentytwo TEXT, column_twentythree TEXT,
          column_twentyfour TEXT, column_twentyfive TEXT, column_twentysix TEXT,
          column_twentyseven TEXT, column_twentyeight TEXT, column_twentynine TEXT,
          column_thirty_extra TEXT, column_thirtyone TEXT, column_thirtytwo TEXT,
          column_thirtythree TEXT, column_thirtyfour TEXT, column_thirtyfive TEXT,
          column_thirtysix TEXT, column_thirtyseven TEXT, column_thirtyeight TEXT,
          column_thirtynine TEXT, column_forty_extra TEXT, column_fortyone TEXT,
          column_fortytwo TEXT, column_fortythree TEXT, column_fortyfour TEXT,
          column_fortyfive TEXT
        )`;
        await sql`INSERT INTO leak_test_28632 (primary_id) VALUES ('123')`;

        // Warm up to stabilize RSS
        for (let i = 0; i < 500; i++) {
          await sql`SELECT * FROM leak_test_28632 WHERE primary_id = ${"123"} LIMIT 1`;
        }
        Bun.gc(true);
        await Bun.sleep(50);
        const rssAfterWarmup = process.memoryUsage.rss();

        // Run queries — each re-decodes 50 column definitions
        for (let i = 0; i < 5000; i++) {
          await sql`SELECT * FROM leak_test_28632 WHERE primary_id = ${"123"} LIMIT 1`;
        }
        Bun.gc(true);
        await Bun.sleep(50);
        const rssAfterQueries = process.memoryUsage.rss();

        const growthMB = (rssAfterQueries - rssAfterWarmup) / 1024 / 1024;

        // Without the fix, ~17MB growth (50 leaked name_or_index allocs × 5000 queries).
        // With the fix, ~7MB (allocator noise + ASAN shadow memory). Double the
        // threshold under ASAN where RSS measurements are noisier and the
        // shadow memory makes the headroom much tighter.
        expect(growthMB).toBeLessThan(isASAN ? 24 : 12);

        await sql`DROP TABLE IF EXISTS leak_test_28632`.catch(() => {});
      });
    },
  );
}
