import { test, expect, describe } from "bun:test";
import { SQL } from "bun";

describe("SQL adapter environment variable precedence", () => {
  const originalEnv = { ...process.env };

  function cleanEnv() {
    // Clean all SQL-related env vars
    delete process.env.DATABASE_URL;
    delete process.env.POSTGRES_URL;
    delete process.env.PGURL;
    delete process.env.PG_URL;
    delete process.env.MYSQL_URL;
    delete process.env.PGHOST;
    delete process.env.PGPORT;
    delete process.env.PGUSER;
    delete process.env.PGUSERNAME;
    delete process.env.PGPASSWORD;
    delete process.env.PGDATABASE;
    delete process.env.USER;
    delete process.env.USERNAME;
  }

  function restoreEnv() {
    // Restore original env
    Object.assign(process.env, originalEnv);
  }

  test("should not prioritize DATABASE_URL over explicit options (issue #22147)", () => {
    cleanEnv();
    process.env.DATABASE_URL = "foo_url";

    const options = new SQL({
      hostname: "bar_url",
      username: "postgres",  
      password: "postgres",
      port: 5432,
    });

    expect(options.options.hostname).toBe("bar_url");
    expect(options.options.port).toBe(5432);
    expect(options.options.username).toBe("postgres");
    restoreEnv();
  });

  test("should only read PostgreSQL env vars when adapter is postgres", () => {
    cleanEnv();
    process.env.PGHOST = "pg-host";
    process.env.PGUSER = "pg-user";
    process.env.PGPASSWORD = "pg-pass";
    process.env.MYSQL_URL = "mysql://mysql-host/db";

    const options = new SQL({
      adapter: "postgres"
    });

    expect(options.options.hostname).toBe("pg-host");
    expect(options.options.username).toBe("pg-user");
    expect(options.options.password).toBe("pg-pass");
    // Should not use MYSQL_URL
    expect(options.options.hostname).not.toBe("mysql-host");
    restoreEnv();
  });

  test("should only read MySQL env vars when adapter is mysql", () => {
    cleanEnv();
    process.env.PGHOST = "pg-host";
    process.env.PGUSER = "pg-user"; 
    process.env.MYSQL_URL = "mysql://mysql-host/db";

    const options = new SQL({
      adapter: "mysql"
    });

    // Should use MYSQL_URL and not read PostgreSQL env vars
    expect(options.options.hostname).toBe("mysql-host");
    expect(options.options.username).not.toBe("pg-user");
    restoreEnv();
  });

  test("should infer postgres adapter from postgres:// protocol", () => {
    cleanEnv();
    const options = new SQL("postgres://user:pass@host:5432/db");
    expect(options.options.adapter).toBe("postgres");
    restoreEnv();
  });

  test("should infer mysql adapter from mysql:// protocol", () => {
    cleanEnv();
    const options = new SQL("mysql://user:pass@host:3306/db");
    expect(options.options.adapter).toBe("mysql");
    restoreEnv();
  });

  test("should default to postgres when no protocol specified", () => {
    cleanEnv();
    const options = new SQL("user:pass@host/db");
    expect(options.options.adapter).toBe("postgres");
    restoreEnv();
  });

  test("should support unix:// with explicit adapter", () => {
    cleanEnv();
    const options = new SQL("unix:///tmp/mysql.sock", {
      adapter: "mysql"
    });
    
    expect(options.options.adapter).toBe("mysql");
    expect(options.options.path).toBe("/tmp/mysql.sock");
    restoreEnv();
  });

  test("should validate adapter matches protocol", () => {
    cleanEnv();
    expect(() => {
      new SQL("mysql://host/db", { adapter: "postgres" });
    }).toThrow(/mysql.*postgres/i);
    restoreEnv();
  });

  test("adapter-specific env vars should take precedence over generic ones", () => {
    cleanEnv();
    process.env.USER = "generic-user";
    process.env.PGUSER = "postgres-user";

    const options = new SQL({
      adapter: "postgres"
    });

    expect(options.options.username).toBe("postgres-user");
    restoreEnv();
  });
});