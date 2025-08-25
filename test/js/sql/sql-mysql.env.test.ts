import { test } from "bun:test";
import { bunEnv, bunRun, describeWithContainer } from "harness";
import { join } from "path";
describeWithContainer(
  "mysql",
  {
    image: "mysql:8",
    env: {
      MYSQL_ROOT_PASSWORD: "bun",
    },
  },
  (port: number) => {
    test("should be able to connect with mysql using environment variables", async () => {
      bunRun(join(import.meta.dirname, "mysql-fixture-env.ts"), {
        ...bunEnv,
        POSTGRES_URL: "",
        PGURL: "",
        PG_URL: "",
        PGHOST: "",
        DATABASE_URL: "",
        TLS_POSTGRES_DATABASE_URL: "",
        TLS_DATABASE_URL: "",
        PGPORT: "",
        PGUSER: "",
        PGUSERNAME: "",
        PGPASSWORD: "",
        MYSQL_URL: "",
        MYSQL_PASSWORD: "bun",
        MYSQL_HOST: "localhost",
        MYSQL_USER: "root",
        MYSQL_DATABASE: "mysql",
        MYSQL_PORT: port.toString(),
      });
    });

    test("should be able to connect with mysql using url environment variable", async () => {
      bunRun(join(import.meta.dirname, "mysql-fixture-env.ts"), {
        ...bunEnv,
        POSTGRES_URL: "",
        PGURL: "",
        PG_URL: "",
        PGHOST: "",
        DATABASE_URL: "",
        TLS_POSTGRES_DATABASE_URL: "",
        TLS_DATABASE_URL: "",
        PGPORT: "",
        PGUSER: "",
        PGUSERNAME: "",
        PGPASSWORD: "",
        MYSQL_PASSWORD: "",
        MYSQL_HOST: "",
        MYSQL_USER: "",
        MYSQL_DATABASE: "",
        MYSQL_PORT: "",
        MYSQL_URL: `mysql://root:bun@localhost:${port}`,
      });
    });
  },
);
