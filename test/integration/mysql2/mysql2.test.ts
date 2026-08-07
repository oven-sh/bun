import { beforeEach, expect, test } from "bun:test";
import { describeWithContainer } from "harness";
import type { Connection, ConnectionOptions } from "mysql2/promise";
import { createConnection } from "mysql2/promise";

const tests: {
  label: string;
  database: {
    image: string;
  };
  client: ConnectionOptions;
}[] = [
  {
    label: "mysql_native_password with root user and password",
    database: {
      image: "mysql_native_password",
    },
    client: {
      user: "root",
      password: "bun",
    },
  },
  {
    label: "mysql_plain with root user and empty password",
    database: {
      image: "mysql_plain",
    },
    client: {
      user: "root",
      password: "",
    },
  },
];

for (const { label, client, database } of tests) {
  describeWithContainer(label, database, container => {
    let sql: Connection;

    beforeEach(async () => {
      await container.ready;
    });

    test("can connect to database", async () => {
      sql = await createConnection({
        ...client,
        port: container.port,
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
