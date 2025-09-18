import { SQL } from "bun";
import { expect, test } from "bun:test";
import { describeWithContainer } from "harness";

describeWithContainer(
  "mysql",
  {
    image: "mysql:8.0.43",
    env: {
      MYSQL_ROOT_PASSWORD: "bun",
      MYSQL_DEFAULT_AUTHENTICATION_PLUGIN: "mysql_native_password",
    },
    args: ["--default-authentication-plugin=mysql_native_password"],
  },
  (port: number) => {
    const options = {
      url: `mysql://root:bun@localhost:${port}`,
      max: 1,
    };

    test("should be able to connect with mysql_native_password auth plugin", async () => {
      const sql = new SQL({ ...options, password: "bun" });
      const result = await sql`select 1 as x`;
      expect(result).toEqual([{ x: 1 }]);
      await sql.end();
    });

    test("should be able to switch auth plugin", async () => {
      {
        const sql = new SQL({ ...options, password: "bun" });

        await sql`CREATE USER caching@'%' IDENTIFIED WITH caching_sha2_password BY 'bunbun';
              GRANT ALL PRIVILEGES ON mysql.* TO caching@'%';
            FLUSH PRIVILEGES;`.simple();
      }
      const sql = new SQL(`mysql://caching:bunbun@localhost:${port}`);
      const result = await sql`select 1 as x`;
      expect(result).toEqual([{ x: 1 }]);
      await sql.end();
    });
  },
);
