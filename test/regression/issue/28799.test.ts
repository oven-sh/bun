// https://github.com/oven-sh/bun/issues/28799
import { SQL } from "bun";
import { afterAll, beforeAll, expect, test } from "bun:test";
import { describeWithContainer, isASAN, isDockerEnabled } from "harness";

if (isDockerEnabled()) {
  describeWithContainer(
    "issue #28799: MySQL adapter should not leak memory with dynamic interpolation",
    {
      image: "mysql_plain",
    },
    container => {
      let sql: SQL;

      beforeAll(async () => {
        await container.ready;
        sql = new SQL({
          url: `mysql://root@${container.host}:${container.port}/bun_sql_test`,
          max: 1,
        });

        await sql`DROP TABLE IF EXISTS leak_test_28799`;
        await sql`CREATE TABLE leak_test_28799 (
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
        await sql`INSERT INTO leak_test_28799 (primary_id) VALUES ('123')`;
      });

      afterAll(async () => {
        await sql?.close();
      });

      // Exercises the three dynamic-interpolation patterns from the user's
      // reproduction in a single test. The 50-column table amplifies per-column
      // leaks (like the ColumnDefinition41 `name_or_index` leak fixed in #28633)
      // so the delta over the measured loop is large enough to catch with an
      // RSS threshold. ASAN inflates RSS with shadow memory, so we double the
      // threshold under ASAN where measurements are noisier.
      //
      // A single `test` runs all three patterns back-to-back and compares RSS
      // against a single baseline. Running them as separate tests would let
      // each test's RSS delta also capture allocator churn left behind by the
      // prior test, making the threshold much noisier.
      test("dynamic interpolation should not leak", async () => {
        const runQueries = async () => {
          // value interpolation
          await sql`SELECT * FROM \`leak_test_28799\` WHERE primary_id = ${"123"} LIMIT 1`;
          // identifier interpolation
          await sql`SELECT * FROM ${sql("leak_test_28799")} WHERE primary_id = '123' LIMIT 1`;
          // value + identifier interpolation
          await sql`SELECT * FROM ${sql("leak_test_28799")} WHERE primary_id = ${"123"} LIMIT 1`;
        };

        for (let i = 0; i < 500; i++) await runQueries();
        Bun.gc(true);
        await Bun.sleep(50);
        const rssBefore = process.memoryUsage.rss();

        for (let i = 0; i < 5000; i++) await runQueries();
        Bun.gc(true);
        await Bun.sleep(50);
        const rssAfter = process.memoryUsage.rss();

        const growthMB = (rssAfter - rssBefore) / 1024 / 1024;
        // Without #28633, 5000 iterations × 3 patterns × 50 columns leaks
        // ~50 MB (ASAN). With the fix, growth stays small.
        expect(growthMB).toBeLessThan(isASAN ? 36 : 18);
      }, 180_000);
    },
  );
}
