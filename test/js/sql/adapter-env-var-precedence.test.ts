import { SQL } from "bun";
import { describe, expect, test } from "bun:test";

describe("SQL adapter environment variable precedence", () => {
  const originalEnv = { ...process.env };

  function cleanEnv() {
    // Clean all SQL-related env vars
    delete process.env.DATABASE_URL;
    delete process.env.POSTGRES_URL;
    delete process.env.PGURL;
    delete process.env.PG_URL;
    delete process.env.MYSQL_URL;
    delete process.env.TLS_DATABASE_URL;
    delete process.env.TLS_POSTGRES_DATABASE_URL;
    delete process.env.TLS_MYSQL_DATABASE_URL;
    delete process.env.PGHOST;
    delete process.env.PGPORT;
    delete process.env.PGUSER;
    delete process.env.PGUSERNAME;
    delete process.env.PGPASSWORD;
    delete process.env.PGDATABASE;
    delete process.env.MYSQL_HOST;
    delete process.env.MYSQL_PORT;
    delete process.env.MYSQL_USER;
    delete process.env.MYSQL_PASSWORD;
    delete process.env.MYSQL_DATABASE;
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
      adapter: "postgres",
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
      adapter: "mysql",
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
      adapter: "mysql",
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
      adapter: "postgres",
    });

    expect(options.options.username).toBe("postgres-user");
    restoreEnv();
  });

  test("should infer mysql adapter from MYSQL_URL env var", () => {
    cleanEnv();
    process.env.MYSQL_URL = "mysql://user:pass@host:3306/db";

    const options = new SQL();
    expect(options.options.adapter).toBe("mysql");
    expect(options.options.hostname).toBe("host");
    expect(options.options.port).toBe(3306);
    restoreEnv();
  });

  test("should default to port 3306 for MySQL when no port specified", () => {
    cleanEnv();
    process.env.MYSQL_URL = "mysql://user:pass@host/db";

    const options = new SQL();
    expect(options.options.adapter).toBe("mysql");
    expect(options.options.hostname).toBe("host");
    expect(options.options.port).toBe(3306); // Should default to MySQL port
    restoreEnv();
  });

  test("should default to port 3306 for explicit MySQL adapter", () => {
    cleanEnv();
    const options = new SQL({
      adapter: "mysql",
      hostname: "localhost",
    });

    expect(options.options.adapter).toBe("mysql");
    expect(options.options.port).toBe(3306); // Should default to MySQL port
    restoreEnv();
  });

  test("should infer postgres adapter from POSTGRES_URL env var", () => {
    cleanEnv();
    process.env.POSTGRES_URL = "postgres://user:pass@host:5432/db";

    const options = new SQL();
    expect(options.options.adapter).toBe("postgres");
    expect(options.options.hostname).toBe("host");
    expect(options.options.port).toBe(5432);
    restoreEnv();
  });

  test("POSTGRES_URL should take precedence over MYSQL_URL", () => {
    cleanEnv();
    process.env.POSTGRES_URL = "postgres://pg-host:5432/pgdb";
    process.env.MYSQL_URL = "mysql://mysql-host:3306/mysqldb";

    const options = new SQL();
    expect(options.options.adapter).toBe("postgres");
    expect(options.options.hostname).toBe("pg-host");
    expect(options.options.port).toBe(5432);
    restoreEnv();
  });

  test("should infer mysql from MYSQL_URL even without protocol", () => {
    cleanEnv();
    process.env.MYSQL_URL = "root@localhost:3306/test";

    const options = new SQL();
    expect(options.options.adapter).toBe("mysql");
    expect(options.options.hostname).toBe("localhost");
    expect(options.options.port).toBe(3306);
    expect(options.options.username).toBe("root");
    restoreEnv();
  });

  test("should infer postgres from POSTGRES_URL even without protocol", () => {
    cleanEnv();
    process.env.POSTGRES_URL = "user@localhost:5432/test";

    const options = new SQL();
    expect(options.options.adapter).toBe("postgres");
    expect(options.options.hostname).toBe("localhost");
    expect(options.options.port).toBe(5432);
    expect(options.options.username).toBe("user");
    restoreEnv();
  });

  test("environment variable name should override protocol (PGURL with mysql protocol should be postgres)", () => {
    cleanEnv();
    process.env.PGURL = "mysql://host:3306/db";

    const options = new SQL();
    expect(options.options.adapter).toBe("postgres");
    expect(options.options.hostname).toBe("host");
    expect(options.options.port).toBe(3306);
    restoreEnv();
  });

  test("environment variable name should override protocol (MYSQL_URL with postgres protocol should be mysql)", () => {
    cleanEnv();
    process.env.MYSQL_URL = "postgres://host:5432/db";

    const options = new SQL();
    expect(options.options.adapter).toBe("mysql");
    expect(options.options.hostname).toBe("host");
    expect(options.options.port).toBe(5432);
    restoreEnv();
  });
  test("should use MySQL-specific environment variables", () => {
    cleanEnv();
    process.env.MYSQL_HOST = "mysql-server";
    process.env.MYSQL_PORT = "3307";
    process.env.MYSQL_USER = "admin";
    process.env.MYSQL_PASSWORD = "secret";
    process.env.MYSQL_DATABASE = "production";

    const options = new SQL({ adapter: "mysql" });
    expect(options.options.adapter).toBe("mysql");
    expect(options.options.hostname).toBe("mysql-server");
    expect(options.options.port).toBe(3307);
    expect(options.options.username).toBe("admin");
    expect(options.options.password).toBe("secret");
    expect(options.options.database).toBe("production");
    restoreEnv();
  });

  test("MySQL-specific env vars should take precedence over generic ones", () => {
    cleanEnv();
    process.env.USER = "generic-user";
    process.env.MYSQL_USER = "mysql-user";

    const options = new SQL({ adapter: "mysql" });
    expect(options.options.username).toBe("mysql-user");
    restoreEnv();
  });

  test("should default to database name 'mysql' for MySQL adapter", () => {
    cleanEnv();
    
    const options = new SQL({ adapter: "mysql", hostname: "localhost" });
    expect(options.options.adapter).toBe("mysql");
    expect(options.options.database).toBe("mysql");
    restoreEnv();
  });

  test("should default to username as database name for PostgreSQL adapter", () => {
    cleanEnv();
    
    const options = new SQL({ adapter: "postgres", hostname: "localhost", username: "testuser" });
    expect(options.options.adapter).toBe("postgres");
    expect(options.options.database).toBe("testuser");
    restoreEnv();
  });

  test("should infer mysql adapter from TLS_MYSQL_DATABASE_URL", () => {
    cleanEnv();
    process.env.TLS_MYSQL_DATABASE_URL = "mysql://user:pass@host:3306/db";

    const options = new SQL();
    expect(options.options.adapter).toBe("mysql");
    expect(options.options.hostname).toBe("host");
    expect(options.options.port).toBe(3306);
    expect(options.options.sslMode).toBe(2); // SSLMode.require
    restoreEnv();
  });

  test("should infer postgres adapter from TLS_POSTGRES_DATABASE_URL", () => {
    cleanEnv();
    process.env.TLS_POSTGRES_DATABASE_URL = "postgres://user:pass@host:5432/db";

    const options = new SQL();
    expect(options.options.adapter).toBe("postgres");
    expect(options.options.hostname).toBe("host");
    expect(options.options.port).toBe(5432);
    expect(options.options.sslMode).toBe(2); // SSLMode.require
    restoreEnv();
  });

  test("should infer adapter from TLS_DATABASE_URL using protocol", () => {
    cleanEnv();
    process.env.TLS_DATABASE_URL = "mysql://user:pass@host:3306/db";

    const options = new SQL();
    expect(options.options.adapter).toBe("mysql");
    expect(options.options.hostname).toBe("host");
    expect(options.options.port).toBe(3306);
    expect(options.options.sslMode).toBe(2); // SSLMode.require
    restoreEnv();
  });

  describe("Adapter-Protocol Validation", () => {
    test("should work with explicit adapter and URL without protocol", () => {
      cleanEnv();
      
      const options = new SQL("user:pass@host:3306/db", { adapter: "mysql" });
      expect(options.options.adapter).toBe("mysql");
      expect(options.options.hostname).toBe("host");
      expect(options.options.port).toBe(3306);
      restoreEnv();
    });

    test("should work with explicit adapter and matching protocol", () => {
      cleanEnv();
      
      const options = new SQL("mysql://user:pass@host:3306/db", { adapter: "mysql" });
      expect(options.options.adapter).toBe("mysql");
      expect(options.options.hostname).toBe("host");
      expect(options.options.port).toBe(3306);
      restoreEnv();
    });

    test("should throw error when adapter conflicts with protocol (mysql adapter with postgres protocol)", () => {
      cleanEnv();
      
      expect(() => {
        new SQL("postgres://user:pass@host:5432/db", { adapter: "mysql" });
      }).toThrow(/Protocol 'postgres' is not compatible with adapter 'mysql'/);
      restoreEnv();
    });

    test("should throw error when adapter conflicts with protocol (postgres adapter with mysql protocol)", () => {
      cleanEnv();
      
      expect(() => {
        new SQL("mysql://user:pass@host:3306/db", { adapter: "postgres" });
      }).toThrow(/Protocol 'mysql' is not compatible with adapter 'postgres'/);
      restoreEnv();
    });

    test("should throw error when sqlite adapter used with mysql protocol", () => {
      cleanEnv();
      
      expect(() => {
        new SQL("mysql://user:pass@host:3306/db", { adapter: "sqlite" });
      }).toThrow(/Protocol 'mysql' is not compatible with adapter 'sqlite'/);
      restoreEnv();
    });

    test("should throw error when mysql adapter used with postgres protocol", () => {
      cleanEnv();
      
      expect(() => {
        new SQL("postgres://user:pass@host:5432/db", { adapter: "mysql" });
      }).toThrow(/Protocol 'postgres' is not compatible with adapter 'mysql'/);
      restoreEnv();
    });

    test("should work with unix:// protocol and explicit adapter", () => {
      cleanEnv();
      
      const options = new SQL("unix:///tmp/mysql.sock", { adapter: "mysql" });
      expect(options.options.adapter).toBe("mysql");
      expect(options.options.path).toBe("/tmp/mysql.sock");
      restoreEnv();
    });

    test("should work with sqlite:// protocol and sqlite adapter", () => {
      cleanEnv();
      
      const options = new SQL("sqlite:///tmp/test.db", { adapter: "sqlite" });
      expect(options.options.adapter).toBe("sqlite");
      expect(options.options.filename).toBe("/tmp/test.db");
      restoreEnv();
    });
  });
});
