// Regression test for https://github.com/oven-sh/bun/issues/24844
// MySQL panics on large query payloads (>16MB) due to integer truncation
//
// This test verifies that large payloads don't cause a panic.
// The fix involves properly splitting packets larger than 16MB according to MySQL protocol.

import { SQL, randomUUIDv7 } from "bun";
import { beforeAll, describe, expect, test } from "bun:test";
import { describeWithContainer, isDockerEnabled } from "harness";

// Only run this test if Docker is available
if (isDockerEnabled()) {
  describeWithContainer(
    "MySQL large payload (#24844)",
    {
      image: "mysql_plain",
      concurrent: false, // Large payload test should run alone
    },
    (container) => {
      let sql: SQL;

      beforeAll(async () => {
        await container.ready;
        sql = new SQL({
          url: `mysql://root@${container.host}:${container.port}/bun_sql_test`,
          max: 1,
        });
      });

      // Test that a payload just under 16MB works (baseline)
      test("handles payload just under 16MB threshold", async () => {
        await using db = new SQL({
          url: `mysql://root@${container.host}:${container.port}/bun_sql_test`,
          max: 1,
        });
        using sql = await db.reserve();

        // Create a large string just under 16MB (16,777,215 - some overhead)
        // Using 16MB - 1KB to account for query overhead
        const largeData = Buffer.alloc(16 * 1024 * 1024 - 1024, "A").toString();

        const tableName = "test_large_" + randomUUIDv7("hex").replaceAll("-", "");
        await sql`CREATE TEMPORARY TABLE ${sql(tableName)} (id INT, data LONGTEXT)`;

        // This should work without panic
        await sql`INSERT INTO ${sql(tableName)} (id, data) VALUES (1, ${largeData})`;

        const result = await sql`SELECT LENGTH(data) as len FROM ${sql(tableName)} WHERE id = 1`;
        expect(result[0].len).toBe(largeData.length);
      }, 60000); // 60 second timeout for large data

      // Test that a payload over 16MB works (the actual regression)
      // This test requires max_allowed_packet to be set high enough on the MySQL server
      test("handles payload over 16MB threshold without panic", async () => {
        await using db = new SQL({
          url: `mysql://root@${container.host}:${container.port}/bun_sql_test`,
          max: 1,
        });
        using sql = await db.reserve();

        // Create a string over 16MB (this is what caused the panic in #24844)
        // The reporter mentioned 18,730,521 chars caused the crash
        // We'll test with 17MB to be safe and avoid memory issues in CI
        const largeData = Buffer.alloc(17 * 1024 * 1024, "A").toString();

        const tableName = "test_large_17mb_" + randomUUIDv7("hex").replaceAll("-", "");
        await sql`CREATE TEMPORARY TABLE ${sql(tableName)} (id INT, data LONGTEXT)`;

        // This should NOT panic anymore after the fix
        // It may still fail if max_allowed_packet is not high enough, but it shouldn't panic
        try {
          await sql`INSERT INTO ${sql(tableName)} (id, data) VALUES (1, ${largeData})`;

          const result = await sql`SELECT LENGTH(data) as len FROM ${sql(tableName)} WHERE id = 1`;
          expect(result[0].len).toBe(largeData.length);
        } catch (e: unknown) {
          // If the error is about max_allowed_packet, that's expected and acceptable
          // The important thing is that we didn't panic
          const error = e as Error;
          if (error.message && error.message.includes("max_allowed_packet")) {
            console.log("Note: max_allowed_packet limit reached, but no panic occurred");
            expect().pass();
          } else {
            throw e;
          }
        }
      }, 120000); // 120 second timeout for very large data
    }
  );
} else {
  describe("MySQL large payload (#24844)", () => {
    test.skip("requires Docker to be enabled", () => {});
  });
}
