// https://github.com/oven-sh/bun/issues/26195
// MySQL 8.0 caching_sha2_password authentication fails due to incorrect byte order
// in the SHA256 hash calculation.
import { SQL } from "bun";
import { expect, test } from "bun:test";
import { describeWithContainer } from "harness";

describeWithContainer(
  "mysql_plain",
  {
    image: "mysql_plain",
    env: {},
    args: [],
    concurrent: true,
  },
  container => {
    // mysql_plain uses MySQL 8.4 with caching_sha2_password as default auth plugin
    const getUrl = () => `mysql://root@${container.host}:${container.port}/bun_sql_test`;

    test("should connect using caching_sha2_password (default in MySQL 8.0+)", async () => {
      await using sql = new SQL({
        url: getUrl(),
        max: 1,
      });
      const result = await sql`SELECT 1 as x`;
      expect(result).toEqual([{ x: 1 }]);
    });

    test("should connect with password using caching_sha2_password", async () => {
      // First create a user with caching_sha2_password and a password
      {
        await using sql = new SQL({
          url: getUrl(),
          max: 1,
        });
        await sql`DROP USER IF EXISTS testuser26195@'%';`.simple();
        await sql`CREATE USER testuser26195@'%' IDENTIFIED WITH caching_sha2_password BY 'testpass123';
              GRANT ALL PRIVILEGES ON bun_sql_test.* TO testuser26195@'%';
            FLUSH PRIVILEGES;`.simple();
      }

      // Now connect with the new user using caching_sha2_password
      await using sql = new SQL(`mysql://testuser26195:testpass123@${container.host}:${container.port}/bun_sql_test`);
      const result = await sql`SELECT 1 as x`;
      expect(result).toEqual([{ x: 1 }]);
    });
  },
);
