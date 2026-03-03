import { SQL } from "bun";
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { isWindows } from "harness";

// Regression test for https://github.com/oven-sh/bun/issues/27713
// Bun SQL was treating the Postgres URL path component (the database name)
// as a Unix domain socket path, causing FailedToOpenSocket on any URL with
// a database name.

describe("SQL should not treat URL pathname as Unix socket path (#27713)", () => {
  const originalEnv = { ...process.env };

  // prettier-ignore
  const SQL_ENV_VARS = [
    "DATABASE_URL", "DATABASEURL",
    "TLS_DATABASE_URL",
    "POSTGRES_URL", "PGURL", "PG_URL",
    "TLS_POSTGRES_DATABASE_URL",
    "MYSQL_URL", "MYSQLURL",
    "TLS_MYSQL_DATABASE_URL",
    "PGHOST", "PGUSER", "PGPASSWORD", "PGDATABASE", "PGPORT",
    "PG_HOST", "PG_USER", "PG_PASSWORD", "PG_DATABASE", "PG_PORT",
    "MYSQL_HOST", "MYSQL_USER", "MYSQL_PASSWORD", "MYSQL_DATABASE", "MYSQL_PORT",
  ];

  beforeEach(() => {
    for (const key of SQL_ENV_VARS) {
      delete process.env[key];
      delete Bun.env[key];
      delete import.meta.env[key];
    }
  });

  afterAll(() => {
    for (const key of SQL_ENV_VARS) {
      if (key in originalEnv) {
        process.env[key] = originalEnv[key]!;
        Bun.env[key] = originalEnv[key]!;
        import.meta.env[key] = originalEnv[key]!;
      } else {
        delete process.env[key];
        delete Bun.env[key];
        delete import.meta.env[key];
      }
    }
  });

  test("postgres URL with database name should not set path", () => {
    const sql = new SQL("postgres://user:pass@myhost:5432/mydb");
    expect(sql.options.hostname).toBe("myhost");
    expect(sql.options.port).toBe(5432);
    expect(sql.options.database).toBe("mydb");
    // path must not be the database name "/mydb"
    expect(sql.options.path).toBeUndefined();
  });

  test("postgres URL passed via url option should not set path", () => {
    const sql = new SQL({
      url: "postgres://user:pass@myhost:5432/mydb",
    });
    expect(sql.options.hostname).toBe("myhost");
    expect(sql.options.port).toBe(5432);
    expect(sql.options.database).toBe("mydb");
    expect(sql.options.path).toBeUndefined();
  });

  test("DATABASE_URL with database name should not set path when using explicit options", () => {
    process.env.DATABASE_URL = "postgres://user:pass@envhost:5432/envdb";

    const sql = new SQL({
      hostname: "myhost",
      port: 5432,
      username: "user",
      password: "pass",
      database: "mydb",
    });

    expect(sql.options.hostname).toBe("myhost");
    expect(sql.options.database).toBe("mydb");
    // path must not be "/envdb" from DATABASE_URL
    expect(sql.options.path).toBeUndefined();
  });

  test("DATABASE_URL with database name should not set path when used implicitly", () => {
    process.env.DATABASE_URL = "postgres://user:pass@envhost:5432/envdb";

    const sql = new SQL();
    expect(sql.options.hostname).toBe("envhost");
    expect(sql.options.port).toBe(5432);
    expect(sql.options.database).toBe("envdb");
    // path must not be "/envdb"
    expect(sql.options.path).toBeUndefined();
  });

  test("postgres URL with database name matching existing directory should not set path", () => {
    // This is the actual bug: when the URL pathname matches an existing filesystem
    // path (like /tmp), the old code would pass it as a Unix socket path.
    // The database name in postgres://.../<dbname> is "/tmp" here, which exists.
    const sql = new SQL("postgres://user:pass@myhost:5432/tmp");
    expect(sql.options.hostname).toBe("myhost");
    expect(sql.options.port).toBe(5432);
    expect(sql.options.database).toBe("tmp");
    // Before the fix, this would be "/tmp" (or "/tmp/.s.PGSQL.5432" if that exists),
    // causing the connection to use Unix domain socket instead of TCP.
    expect(sql.options.path).toBeUndefined();
  });

  test("mysql URL with database name should not set path", () => {
    const sql = new SQL("mysql://user:pass@myhost:3306/mydb");
    expect(sql.options.hostname).toBe("myhost");
    expect(sql.options.port).toBe(3306);
    expect(sql.options.database).toBe("mydb");
    expect(sql.options.path).toBeUndefined();
  });

  test.skipIf(isWindows)("unix:// protocol should still use pathname as socket path", () => {
    const socketPath = `/tmp/bun-test-27713-${process.pid}.sock`;
    using sock = Bun.listen({
      unix: socketPath,
      socket: {
        data: () => {},
      },
    });

    const sql = new SQL(`unix://${sock.unix}`, { adapter: "postgres" });
    expect(sql.options.path).toBe(socketPath);
  });
});
