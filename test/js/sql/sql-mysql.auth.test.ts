import { SQL } from "bun";
import { expect, test } from "bun:test";
import { describeWithContainer } from "harness";

describeWithContainer(
  "mysql",
  {
    image: "mysql_native_password",
    env: {},
    args: [],
    concurrent: true,
  },
  container => {
    // Create getters that will be evaluated when the test runs
    const getUrl = () => `mysql://root:bun@${container.host}:${container.port}/bun_sql_test`;

    test("should be able to connect with mysql_native_password auth plugin", async () => {
      console.log("Container info in test:", container);
      await using sql = new SQL({
        url: getUrl(),
        max: 1,
      });
      const result = await sql`select 1 as x`;
      expect(result).toEqual([{ x: 1 }]);
      await sql.end();
    });

    test("should be able to switch auth plugin", async () => {
      {
        await using sql = new SQL({
          url: getUrl(),
          max: 1,
        });

        await sql`DROP USER IF EXISTS caching@'%';`.simple();
        await sql`CREATE USER caching@'%' IDENTIFIED WITH caching_sha2_password BY 'bunbun';
              GRANT ALL PRIVILEGES ON bun_sql_test.* TO caching@'%';
            FLUSH PRIVILEGES;`.simple();
      }
      await using sql = new SQL(`mysql://caching:bunbun@${container.host}:${container.port}/bun_sql_test`);
      const result = await sql`select 1 as x`;
      expect(result).toEqual([{ x: 1 }]);
      await sql.end();
    });
  },
);

describeWithContainer(
  "mysql caching_sha2_password",
  {
    image: "mysql_caching_sha2",
    env: {},
    args: [],
    concurrent: true,
  },
  container => {
    const getUrl = () => `mysql://root:bun@${container.host}:${container.port}/bun_sql_test`;

    test("should connect with caching_sha2_password (short password)", async () => {
      {
        await using sql = new SQL({ url: getUrl(), max: 1 });
        await sql`DROP USER IF EXISTS short_pass@'%';`.simple();
        await sql`CREATE USER short_pass@'%' IDENTIFIED WITH caching_sha2_password BY 'short';
              GRANT ALL PRIVILEGES ON bun_sql_test.* TO short_pass@'%';
            FLUSH PRIVILEGES;`.simple();
      }
      for (let i = 0; i < 2; i++) {
        await using sql = new SQL(`mysql://short_pass:short@${container.host}:${container.port}/bun_sql_test`);
        const result = await sql`select 1 as x`;
        expect(result).toEqual([{ x: 1 }]);
      }
    });

    test("should connect with caching_sha2_password (exactly 20 chars — boundary)", async () => {
      {
        await using sql = new SQL({ url: getUrl(), max: 1 });
        await sql`DROP USER IF EXISTS boundary@'%';`.simple();
        await sql`CREATE USER boundary@'%' IDENTIFIED WITH caching_sha2_password BY 'exactly20charpasswd!';
              GRANT ALL PRIVILEGES ON bun_sql_test.* TO boundary@'%';
            FLUSH PRIVILEGES;`.simple();
      }
      await using sql = new SQL(
        `mysql://boundary:exactly20charpasswd!@${container.host}:${container.port}/bun_sql_test`,
      );
      const result = await sql`select 1 as x`;
      expect(result).toEqual([{ x: 1 }]);
    });

    test("should connect with caching_sha2_password (long password > 19 chars)", async () => {
      {
        await using sql = new SQL({ url: getUrl(), max: 1 });
        await sql`DROP USER IF EXISTS long_pass@'%';`.simple();
        await sql`CREATE USER long_pass@'%' IDENTIFIED WITH caching_sha2_password BY 'ThisIsAVeryLongPassword123!';
              GRANT ALL PRIVILEGES ON bun_sql_test.* TO long_pass@'%';
            FLUSH PRIVILEGES;`.simple();
      }
      await using sql = new SQL(
        `mysql://long_pass:ThisIsAVeryLongPassword123!@${container.host}:${container.port}/bun_sql_test`,
      );
      const result = await sql`select 1 as x`;
      expect(result).toEqual([{ x: 1 }]);
    });
  },
);
