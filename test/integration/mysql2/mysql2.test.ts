import { expect, test } from "bun:test";
import { describeWithContainer } from "harness";
import type { Connection, ConnectionOptions } from "mysql2/promise";
import { createConnection } from "mysql2/promise";

const tests: {
  label: string;
  database: {
    image: string;
    env?: Record<string, string>;
  };
  client: ConnectionOptions;
}[] = [
  {
    label: "mysql:8 with root user and password",
    database: {
      image: "mysql:8",
      env: {
        MYSQL_ROOT_PASSWORD: "bun",
      },
    },
    client: {
      user: "root",
      password: "bun",
    },
  },
  {
    label: "mysql:8 with root user and empty password",
    database: {
      image: "mysql:8",
      env: {
        MYSQL_ALLOW_EMPTY_PASSWORD: "yes",
      },
    },
    client: {
      user: "root",
      password: "",
    },
  },
];

for (const { label, client, database } of tests) {
  describeWithContainer(label, database, (port: number) => {
    let sql: Connection;
    test("can connect to database", async () => {
      sql = await createConnection({
        ...client,
        port,
      });
    });
    test("can query database", async () => {
      const result = await sql?.query("SELECT 1");
      expect(result).toBeArrayOfSize(2);
      const [rows, fields] = result;
      expect(rows).toBeArrayOfSize(1);
      const [row] = rows as any[];
      expect(row).toMatchObject({ "1": 1 });
    });
    test("can close database", async () => {
      await sql?.end();
    });
  });
}
