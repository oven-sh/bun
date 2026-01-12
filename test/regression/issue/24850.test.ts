/**
 * @see https://github.com/oven-sh/bun/issues/24850
 * Test for MySQL stored procedure calls that return multiple result sets.
 * The bug was that prepared statements didn't wait for all result sets to be
 * received before resolving, causing errors to leak outside the catch block.
 */

import { SQL } from "bun";
import { beforeAll, expect, test } from "bun:test";
import { describeWithContainer, isDockerEnabled } from "harness";

if (isDockerEnabled()) {
  describeWithContainer(
    "MySQL stored procedures with multiple result sets",
    {
      image: "mysql_plain",
      concurrent: true,
    },
    container => {
      let sql: SQL;

      beforeAll(async () => {
        await container.ready;
        sql = new SQL({
          url: `mysql://root:@${container.host}:${container.port}/bun_sql_test`,
          max: 1,
        });

        // Create a simple stored procedure that uses PREPARE/EXECUTE
        // This generates multiple result sets
        await sql.unsafe(`
          DROP PROCEDURE IF EXISTS test_procedure;
        `);

        await sql.unsafe(`
          CREATE PROCEDURE test_procedure(IN param JSON)
          BEGIN
            DECLARE test_id INT;
            DECLARE test_value VARCHAR(100);
            DECLARE sql_stmt TEXT;

            SET test_id = JSON_VALUE(param, '$.id');
            SET test_value = JSON_VALUE(param, '$.value');

            SET sql_stmt = CONCAT('SELECT ', test_id, ' as id, "', test_value, '" as value');

            PREPARE stmt FROM sql_stmt;
            EXECUTE stmt;
            DEALLOCATE PREPARE stmt;
          END;
        `);
      });

      test("stored procedure with prepared statements should not leak errors", async () => {
        let caughtError = null;
        let result = null;

        try {
          const param = JSON.stringify({ id: 1, value: "test" });
          result = await sql.unsafe("CALL test_procedure(?)", [param]);
        } catch (error) {
          caughtError = error;
        }

        // The query should succeed
        expect(caughtError).toBeNull();
        expect(result).toBeDefined();

        // Result should contain the data from the stored procedure
        // MySQL returns: [result_set, ok_packet] for stored procedures
        expect(Array.isArray(result)).toBe(true);

        if (Array.isArray(result) && result.length > 0) {
          const firstResult = result[0];
          if (Array.isArray(firstResult) && firstResult.length > 0) {
            expect(firstResult[0].id).toBe(1);
            expect(firstResult[0].value).toBe("test");
          } else {
            // Single result set returned
            expect(firstResult.id).toBe(1);
            expect(firstResult.value).toBe("test");
          }
        }
      });

      test("stored procedure called with tagged template should work", async () => {
        let caughtError = null;
        let result = null;

        try {
          const param = JSON.stringify({ id: 2, value: "hello" });
          result = await sql`CALL test_procedure(${param})`;
        } catch (error) {
          caughtError = error;
        }

        // The query should succeed without throwing
        expect(caughtError).toBeNull();
        expect(result).toBeDefined();
        expect(Array.isArray(result)).toBe(true);

        if (result.length > 0) {
          expect(result[0].id).toBe(2);
          expect(result[0].value).toBe("hello");
        }
      });

      test("simple stored procedure without PREPARE/EXECUTE", async () => {
        // Create a simpler stored procedure
        await sql.unsafe(`
          DROP PROCEDURE IF EXISTS simple_procedure;
        `);

        await sql.unsafe(`
          CREATE PROCEDURE simple_procedure()
          BEGIN
            SELECT 42 as answer;
          END;
        `);

        let caughtError = null;
        let result = null;

        try {
          result = await sql.unsafe("CALL simple_procedure()");
        } catch (error) {
          caughtError = error;
        }

        expect(caughtError).toBeNull();
        expect(result).toBeDefined();
      });
    },
  );
}
