import { SQL } from "bun";
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { isWindows, tempDir, tmpdirSync } from "harness";
import { join } from "node:path";
import { unlinkSync } from "js/node/fs/export-star-from";

declare module "bun" {
  namespace SQL {
    export interface PostgresOrMySQLOptions {
      sslMode?: number;
    }
  }
}

describe("SQL adapter environment variable precedence", () => {
  const originalEnv = { ...process.env };

  // prettier-ignore
  const SQL_ENV_VARS = [
    'DATABASE_URL', 'DATABASEURL',
    'TLS_DATABASE_URL',
    'POSTGRES_URL', 'PGURL', 'PG_URL',
    'TLS_POSTGRES_DATABASE_URL',
    'MYSQL_URL', 'MYSQLURL',
    'TLS_MYSQL_DATABASE_URL',
    'MARIADB_URL', 'MARIADBURL',
    'TLS_MARIADB_DATABASE_URL',
    'SQLITE_URL', 'SQLITEURL',
    'PGHOST', 'PGUSER', 'PGPASSWORD', 'PGDATABASE', 'PGPORT',
    'PGSSLMODE', 'PG_SSLMODE',
    'MYSQL_HOST', 'MYSQL_USER', 'MYSQL_PASSWORD', 'MYSQL_DATABASE', 'MYSQL_PORT'
  ];

  beforeEach(() => {
    for (const key of Object.keys(process.env).concat(...Object.keys(Bun.env), ...Object.keys(import.meta.env))) {
      delete process.env[key];
      delete Bun.env[key];
      delete import.meta.env[key];
    }

    for (const key in originalEnv) {
      process.env[key] = originalEnv[key];
      Bun.env[key] = originalEnv[key];
      import.meta.env[key] = originalEnv[key];
    }

    for (const key of SQL_ENV_VARS) {
      delete process.env[key];
      delete Bun.env[key];
      delete import.meta.env[key];
    }
  });

  afterAll(() => {
    for (const key of Object.keys(process.env).concat(...Object.keys(Bun.env), ...Object.keys(import.meta.env))) {
      delete process.env[key];
      delete Bun.env[key];
      delete import.meta.env[key];
    }

    for (const key in originalEnv) {
      process.env[key] = originalEnv[key];
      Bun.env[key] = originalEnv[key];
      import.meta.env[key] = originalEnv[key];
    }

    for (const key of SQL_ENV_VARS) {
      delete process.env[key];
      delete Bun.env[key];
      delete import.meta.env[key];
    }
  });

  test("should not prioritize DATABASE_URL over explicit options (issue #22147)", () => {
    process.env.DATABASE_URL = "foo_url";

    const options = new SQL({
      hostname: "bar_url",
      username: "postgres",
      password: "postgres",
      port: 5432,
    });

    expect(options.options.adapter).toBe("postgres");
    expect(options.options.hostname).toBe("bar_url");
    expect(options.options.port).toBe(5432);
    expect(options.options.username).toBe("postgres");
  });

  test("should only read PostgreSQL env vars when adapter is postgres", () => {
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
  });

  test("should only read MySQL env vars when adapter is mysql", () => {
    process.env.PGHOST = "pg-host";
    process.env.PGUSER = "pg-user";
    process.env.MYSQL_URL = "mysql://mysql-host/db";

    const options = new SQL({
      adapter: "mysql",
    });

    // Should use MYSQL_URL and not read PostgreSQL env vars
    expect(options.options.hostname).toBe("mysql-host");
    expect(options.options.username).not.toBe("pg-user");
  });

  test("should infer postgres adapter from postgres:// protocol", () => {
    const options = new SQL("postgres://user:pass@host:5432/db");
    expect(options.options.adapter).toBe("postgres");
  });

  test("should infer mysql adapter from mysql:// protocol", () => {
    const options = new SQL("mysql://user:pass@host:3306/db");
    expect(options.options.adapter).toBe("mysql");
  });

  test("should default to postgres when no protocol specified", () => {
    const options = new SQL("user:pass@host/db");
    expect(options.options.adapter).toBe("postgres");
  });

  test("adapter-specific env vars should take precedence over generic ones", () => {
    process.env.USER = "generic-user";
    process.env.PGUSER = "postgres-user";

    const options = new SQL({
      adapter: "postgres",
    });

    expect(options.options.username).toBe("postgres-user");
  });

  test("should infer mysql adapter from MYSQL_URL env var", () => {
    process.env.MYSQL_URL = "mysql://user:pass@host:3306/db";

    const options = new SQL();
    expect(options.options.adapter).toBe("mysql");
    expect(options.options.hostname).toBe("host");
    expect(options.options.port).toBe(3306);
  });

  test("should default to port 3306 for MySQL when no port specified", () => {
    process.env.MYSQL_URL = "mysql://user:pass@host/db";

    const options = new SQL();
    expect(options.options.adapter).toBe("mysql");
    expect(options.options.hostname).toBe("host");
    expect(options.options.port).toBe(3306); // Should default to MySQL port
  });

  test("should default to port 3306 for explicit MySQL adapter", () => {
    const options = new SQL({
      adapter: "mysql",
      hostname: "localhost",
    });

    expect(options.options.adapter).toBe("mysql");
    expect(options.options.port).toBe(3306); // Should default to MySQL port
  });

  test("should infer postgres adapter from POSTGRES_URL env var", () => {
    process.env.POSTGRES_URL = "postgres://user:pass@host:5432/db";

    const options = new SQL();
    expect(options.options.adapter).toBe("postgres");
    expect(options.options.hostname).toBe("host");
    expect(options.options.port).toBe(5432);
  });

  test("POSTGRES_URL should take precedence over MYSQL_URL", () => {
    process.env.POSTGRES_URL = "postgres://pg-host:5432/pgdb";
    process.env.MYSQL_URL = "mysql://mysql-host:3306/mysqldb";

    const options = new SQL();
    expect(options.options.adapter).toBe("postgres");
    expect(options.options.hostname).toBe("pg-host");
    expect(options.options.port).toBe(5432);
  });

  test("should infer mysql from MYSQL_URL even without protocol", () => {
    process.env.MYSQL_URL = "root@localhost:3306/test";

    const options = new SQL();
    expect(options.options.adapter).toBe("mysql");
    expect(options.options.hostname).toBe("localhost");
    expect(options.options.port).toBe(3306);
    expect(options.options.username).toBe("root");
  });

  test("should infer postgres from POSTGRES_URL even without protocol", () => {
    process.env.POSTGRES_URL = "user@localhost:5432/test";

    const options = new SQL();
    expect(options.options.adapter).toBe("postgres");
    expect(options.options.hostname).toBe("localhost");
    expect(options.options.port).toBe(5432);
    expect(options.options.username).toBe("user");
  });

  test("environment variable name should override protocol (PGURL with mysql protocol should be postgres)", () => {
    process.env.PGURL = "mysql://host:3306/db";

    const options = new SQL();
    expect(options.options.adapter).toBe("postgres");
    expect(options.options.hostname).toBe("host");
    expect(options.options.port).toBe(3306);
  });

  test("environment variable name should override protocol (MYSQL_URL with postgres protocol should be mysql)", () => {
    process.env.MYSQL_URL = "postgres://host:5432/db";

    const options = new SQL();
    expect(options.options.adapter).toBe("mysql");
    expect(options.options.hostname).toBe("host");
    expect(options.options.port).toBe(5432);
  });
  test("should use MySQL-specific environment variables", () => {
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
  });

  test("MySQL-specific env vars should take precedence over generic ones", () => {
    process.env.USER = "generic-user";
    process.env.MYSQL_USER = "mysql-user";

    const options = new SQL({ adapter: "mysql" });
    expect(options.options.username).toBe("mysql-user");
  });

  test("should default to database name 'mysql' for MySQL adapter", () => {
    const options = new SQL({ adapter: "mysql", hostname: "localhost" });
    expect(options.options.adapter).toBe("mysql");
    expect(options.options.database).toBe("mysql");
  });

  test("should default to username as database name for PostgreSQL adapter", () => {
    const options = new SQL({ adapter: "postgres", hostname: "localhost", username: "testuser" });
    expect(options.options.adapter).toBe("postgres");
    expect(options.options.database).toBe("testuser");
  });

  test("should infer mysql adapter from TLS_MYSQL_DATABASE_URL", () => {
    process.env.TLS_MYSQL_DATABASE_URL = "mysql://user:pass@host:3306/db";

    const options = new SQL();
    expect(options.options.adapter).toBe("mysql");
    expect(options.options.hostname).toBe("host");
    expect(options.options.port).toBe(3306);
    expect(options.options.sslMode).toBe(2); // SSLMode.require
  });

  test("should infer postgres adapter from TLS_POSTGRES_DATABASE_URL", () => {
    process.env.TLS_POSTGRES_DATABASE_URL = "postgres://user:pass@host:5432/db";

    const options = new SQL();
    expect(options.options.adapter).toBe("postgres");
    expect(options.options.hostname).toBe("host");
    expect(options.options.port).toBe(5432);
    expect(options.options.sslMode).toBe(2); // SSLMode.require
  });

  test("should infer adapter from TLS_DATABASE_URL using protocol", () => {
    process.env.TLS_DATABASE_URL = "mysql://user:pass@host:3306/db";

    const options = new SQL();
    expect(options.options.adapter).toBe("mysql");
    expect(options.options.hostname).toBe("host");
    expect(options.options.port).toBe(3306);
    expect(options.options.sslMode).toBe(2); // SSLMode.require
  });

  describe("PGSSLMODE", () => {
    test.each([
      ["disable", 0],
      ["allow", 1],
      ["prefer", 1],
      ["require", 2],
      ["verify-ca", 3],
      ["verify-full", 4],
    ])("PGSSLMODE=%s is honoured alongside PGHOST/PGPORT/...", (mode, expected) => {
      process.env.PGHOST = "pg-host";
      process.env.PGPORT = "5432";
      process.env.PGUSER = "pg-user";
      process.env.PGPASSWORD = "pg-pass";
      process.env.PGDATABASE = "pg-db";
      process.env.PGSSLMODE = mode;

      const options = new SQL({ adapter: "postgres" });
      expect(options.options).toMatchObject({
        adapter: "postgres",
        hostname: "pg-host",
        port: 5432,
        username: "pg-user",
        database: "pg-db",
        sslMode: expected,
      });
    });

    test("PGSSLMODE applies when the adapter is defaulted (no explicit adapter, no URL)", () => {
      process.env.PGHOST = "pg-host";
      process.env.PGSSLMODE = "require";

      const options = new SQL({ max: 1 });
      expect(options.options.adapter).toBe("postgres");
      expect(options.options.sslMode).toBe(2); // SSLMode.require
    });

    test("PGSSLMODE applies alongside DATABASE_URL (postgres URL without ?sslmode=)", () => {
      process.env.DATABASE_URL = "postgres://user@host:5432/db";
      process.env.PGSSLMODE = "require";

      const options = new SQL();
      expect(options.options.adapter).toBe("postgres");
      expect(options.options.hostname).toBe("host");
      expect(options.options.sslMode).toBe(2); // SSLMode.require
    });

    test("PGSSLMODE applies to an explicit URL string without ?sslmode=", () => {
      process.env.PGSSLMODE = "verify-full";

      const options = new SQL("postgres://user@host:5432/db");
      expect(options.options.sslMode).toBe(4); // SSLMode.verify_full
    });

    test("PG_SSLMODE spelling is accepted like PG_HOST et al.", () => {
      process.env.PG_SSLMODE = "verify-full";

      const options = new SQL({ adapter: "postgres" });
      expect(options.options.sslMode).toBe(4); // SSLMode.verify_full
    });

    test("URL ?sslmode= overrides PGSSLMODE", () => {
      process.env.PGSSLMODE = "require";
      process.env.POSTGRES_URL = "postgres://user@host:5432/db?sslmode=disable";

      const options = new SQL();
      expect(options.options.sslMode).toBe(0); // SSLMode.disable (URL wins)
    });

    test("PGSSLMODE does not leak into the MySQL adapter", () => {
      process.env.PGSSLMODE = "require";

      const options = new SQL({ adapter: "mysql", hostname: "localhost" });
      expect(options.options.adapter).toBe("mysql");
      expect(options.options.sslMode).toBe(0); // SSLMode.disable
    });

    test("invalid PGSSLMODE value throws", () => {
      process.env.PGSSLMODE = "bogus";
      expect(() => new SQL({ adapter: "postgres" })).toThrow("sslmode");
    });

    test("PGSSLMODE=prefer does not downgrade an explicit tls: true below require", () => {
      process.env.PGSSLMODE = "prefer";

      const options = new SQL({ adapter: "postgres", hostname: "h", tls: true });
      expect(options.options.sslMode).toBe(2); // SSLMode.require
    });

    test("PGSSLMODE=allow does not downgrade an explicit ssl: {} below require", () => {
      process.env.PGSSLMODE = "allow";

      const options = new SQL({ adapter: "postgres", hostname: "h", ssl: {} });
      expect(options.options.sslMode).toBe(2); // SSLMode.require
    });

    test("PGSSLMODE=verify-full still upgrades past an explicit tls: true", () => {
      process.env.PGSSLMODE = "verify-full";

      const options = new SQL({ adapter: "postgres", hostname: "h", tls: true });
      expect(options.options.sslMode).toBe(4); // SSLMode.verify_full
    });

    test.each([{ tls: false }, { ssl: false }, { tls: false, ssl: false }])(
      "an explicit %p disables a mode selected by PGSSLMODE or the URL",
      tlsOptions => {
        process.env.PGSSLMODE = "require";

        const fromEnv = new SQL({ adapter: "postgres", hostname: "h", ...tlsOptions });
        expect(fromEnv.options.sslMode).toBe(0);
        expect(fromEnv.options.tls).toBeUndefined();

        const fromUrl = new SQL("postgres://u@h:5432/db?sslmode=verify-full&ssl=true", tlsOptions);
        expect(fromUrl.options.query).toBe("");
        expect(fromUrl.options.sslMode).toBe(0);
        expect(fromUrl.options.tls).toBeUndefined();
      },
    );

    test("an unset tls option keeps the mode selected by PGSSLMODE", () => {
      process.env.PGSSLMODE = "require";

      const options = new SQL({ adapter: "postgres", hostname: "h", tls: undefined });
      expect(options.options.sslMode).toBe(2);
      expect(options.options.tls).toEqual({ serverName: "h" });
    });

    test("a tls object alongside ssl: false still requests an encrypted connection", () => {
      const options = new SQL({ adapter: "postgres", hostname: "h", tls: {}, ssl: false });
      expect(options.options.sslMode).toBe(2);
      expect(options.options.tls).toBeTypeOf("object");
    });
  });

  describe("TLS settings from the connection URL query string", () => {
    test.each([
      ["mysql://u:p@h/db?ssl-mode=DISABLED", 0, undefined],
      ["mysql://u:p@h/db?ssl_mode=preferred", 1, { serverName: "h" }],
      ["mysql://u:p@h/db?ssl-mode=REQUIRED", 2, { serverName: "h" }],
      ["mysql://u:p@h/db?ssl-mode=VERIFY_CA", 3, { serverName: "h" }],
      ["mysql://u:p@h/db?ssl-mode=VERIFY_IDENTITY", 4, { serverName: "h" }],
      ["postgres://u@h:5432/db?ssl=prefer", 1, { serverName: "h" }],
      ["postgres://u@h:5432/db?ssl=require", 2, { serverName: "h" }],
      ["postgres://u@h:5432/db?tls=verify-ca", 3, { serverName: "h" }],
      ["postgres://u@h:5432/db?ssl=verify-full", 4, { serverName: "h" }],
    ] as const)("%s selects sslMode %d", (url, expectedMode, expectedTls) => {
      const options = new SQL(url);
      expect(options.options.hostname).toBe("h");
      expect(options.options.query).toBe("");
      expect(options.options.sslMode).toBe(expectedMode);
      expect(options.options.tls).toEqual(expectedTls);
    });

    test.each(["mysql://u:p@h/db?ssl=true", "mysql://u:p@h/db?ssl=1", "postgres://u@h:5432/db?tls=TRUE"])(
      "%s requires an encrypted connection",
      url => {
        const options = new SQL(url);
        expect(options.options.query).toBe("");
        expect(options.options.sslMode).toBe(2);
        expect(options.options.tls).toEqual({ serverName: "h" });

        const withExplicitTls = new SQL(url, { tls: { ca: "x" } });
        expect(withExplicitTls.options.sslMode).toBe(4);
        expect(withExplicitTls.options.tls).toEqual({ ca: "x", serverName: "h" });
      },
    );

    test.each(["mysql://u:p@h/db?ssl=false", "mysql://u:p@h/db?ssl=0", "postgres://u@h:5432/db?tls="])(
      "%s leaves TLS disabled and is not forwarded as a startup parameter",
      url => {
        const options = new SQL(url);
        expect(options.options.query).toBe("");
        expect(options.options.sslMode).toBe(0);
        expect(options.options.tls).toBeUndefined();
      },
    );

    test.each(["postgres://u@h:5432/db?ssl=false", "postgres://u@h:5432/db?tls=0"])(
      "%s disables a mode selected by PGSSLMODE",
      url => {
        process.env.PGSSLMODE = "verify-full";

        const options = new SQL(url);
        expect(options.options.query).toBe("");
        expect(options.options.sslMode).toBe(0);
        expect(options.options.tls).toBeUndefined();
      },
    );

    test("an empty ?tls= is treated as unset and keeps the mode selected by PGSSLMODE", () => {
      process.env.PGSSLMODE = "require";

      const options = new SQL("postgres://u@h:5432/db?tls=");
      expect(options.options.query).toBe("");
      expect(options.options.sslMode).toBe(2);
      expect(options.options.tls).toEqual({ serverName: "h" });
    });

    test("an explicit tls option takes priority over ?ssl=false", () => {
      const options = new SQL("postgres://u@h:5432/db?ssl=false", { tls: true });
      expect(options.options.sslMode).toBe(2);
      expect(options.options.tls).toBe(true);
    });

    test.each(["mysql://u:p@h/db?ssl=bogus", 'mysql://u:p@h/db?ssl={"rejectUnauthorized":true}'])(
      "%s throws for an unrecognised ssl value",
      url => {
        expect(() => new SQL(url)).toThrow("sslmode");
      },
    );
  });

  describe("tls/ssl option given as an sslmode string", () => {
    test.each([
      ["disable", 0, undefined],
      ["allow", 1, { serverName: "h" }],
      ["prefer", 1, { serverName: "h" }],
      ["require", 2, { serverName: "h" }],
      ["verify-ca", 3, { serverName: "h" }],
      ["verify-full", 4, { serverName: "h" }],
    ] as const)("ssl: %p selects sslMode %d", (mode, expectedMode, expectedTls) => {
      const options = new SQL({ adapter: "postgres", hostname: "h", ssl: mode as any });
      expect(options.options.sslMode).toBe(expectedMode);
      expect(options.options.tls).toEqual(expectedTls);
    });

    test("tls: 'verify-full' is accepted for the mysql adapter", () => {
      const options = new SQL({ adapter: "mysql", hostname: "h", tls: "verify-full" as any });
      expect(options.options.adapter).toBe("mysql");
      expect(options.options.sslMode).toBe(4);
      expect(options.options.tls).toEqual({ serverName: "h" });
    });

    test("ssl: 'verify-full' takes priority over URL ?sslmode=require", () => {
      const options = new SQL("postgres://u@h:5432/db?sslmode=require", { ssl: "verify-full" as any });
      expect(options.options.sslMode).toBe(4);
      expect(options.options.tls).toEqual({ serverName: "h" });
    });

    test("ssl: 'verify-ca' takes priority over PGSSLMODE=require", () => {
      process.env.PGSSLMODE = "require";

      const options = new SQL({ adapter: "postgres", hostname: "h", ssl: "verify-ca" as any });
      expect(options.options.sslMode).toBe(3);
      expect(options.options.tls).toEqual({ serverName: "h" });
    });

    test("an unrecognised ssl string throws", () => {
      expect(() => new SQL({ adapter: "postgres", hostname: "h", ssl: "bogus" as any })).toThrow("sslmode");
      expect(() => new SQL("postgres://u@h:5432/db?sslmode=require", { tls: "bogus" as any })).toThrow("sslmode");
    });
  });

  describe("tls.caFile", () => {
    test("tls: { caFile } enables certificate verification like tls: { ca }", () => {
      using dir = tempDir("sql-tls-cafile", { "ca.pem": "" });
      const caFile = `${dir}/ca.pem`;

      const options = new SQL({ adapter: "postgres", hostname: "h", tls: { caFile } });
      expect(options.options.sslMode).toBe(4);
      expect(options.options.tls).toEqual({ caFile, serverName: "h" });

      const mysqlOptions = new SQL("mysql://u:p@h/db", { tls: { caFile } });
      expect(mysqlOptions.options.adapter).toBe("mysql");
      expect(mysqlOptions.options.sslMode).toBe(4);
      expect(mysqlOptions.options.tls).toEqual({ caFile, serverName: "h" });

      const optedOut = new SQL({ adapter: "postgres", hostname: "h", tls: { caFile, rejectUnauthorized: false } });
      expect(optedOut.options.sslMode).toBe(2);
      expect(optedOut.options.tls).toMatchObject({ caFile, rejectUnauthorized: false });

      const fromUrl = new SQL("postgres://u@h:5432/db?sslmode=verify-ca", { tls: { caFile } });
      expect(fromUrl.options.sslMode).toBe(3);
      expect(fromUrl.options.tls).toEqual({ caFile, serverName: "h" });
    });
  });

  describe("Adapter-Protocol Validation", () => {
    test("should work with explicit adapter and URL without protocol", () => {
      const options = new SQL("user:pass@host:3306/db", { adapter: "mysql" });
      expect(options.options.adapter).toBe("mysql");
      expect(options.options.hostname).toBe("host");
      expect(options.options.port).toBe(3306);
    });

    test("should work with explicit adapter and matching protocol", () => {
      const options = new SQL("mysql://user:pass@host:3306/db", { adapter: "mysql" });
      expect(options.options.adapter).toBe("mysql");
      expect(options.options.hostname).toBe("host");
      expect(options.options.port).toBe(3306);
    });

    test.skipIf(isWindows)("should work with unix:// protocol and explicit adapter", () => {
      // Not /tmp: the OHOS app sandbox cannot create sockets there.
      const sockPath = join(tmpdirSync(), "thisisacoolmysql.sock");
      using sock = Bun.listen({
        unix: sockPath,
        socket: {
          data: console.log,
        },
      });

      const options = new SQL(`unix://${sock.unix}`, { adapter: "mysql" });
      expect(options.options.adapter).toBe("mysql");
      expect(options.options.path).toBe(sockPath);

      unlinkSync(sock.unix);
    });

    test.skipIf(isWindows)("postgres URL with a host uses the pathname as the database name, not a socket path", () => {
      using dir = tempDir("sql-url-pathname-pg", { placeholder: "" });
      const options = new SQL(`postgres://user:pass@dbhost:5432${dir}`);
      expect(options.options.adapter).toBe("postgres");
      expect(options.options.hostname).toBe("dbhost");
      expect(options.options.port).toBe(5432);
      expect(options.options.database).toBe(String(dir).slice(1));
      expect(options.options.path).toBeUndefined();
    });

    test.skipIf(isWindows)("mysql URL with a host uses the pathname as the database name, not a socket path", () => {
      using dir = tempDir("sql-url-pathname-mysql", { placeholder: "" });
      const options = new SQL(`mysql://user:pass@dbhost:3306${dir}`);
      expect(options.options.adapter).toBe("mysql");
      expect(options.options.hostname).toBe("dbhost");
      expect(options.options.port).toBe(3306);
      expect(options.options.database).toBe(String(dir).slice(1));
      expect(options.options.path).toBeUndefined();
    });

    test("should work with sqlite:// protocol and sqlite adapter", () => {
      const options = new SQL("sqlite:///tmp/test.db", { adapter: "sqlite" });
      expect(options.options.adapter).toBe("sqlite");
      expect(options.options.filename).toBe("/tmp/test.db");
    });

    test("should work with sqlite:// protocol without adapter", () => {
      const options = new SQL("sqlite:///tmp/test.db");
      expect(options.options.adapter).toBe("sqlite");
      expect(options.options.filename).toBe("/tmp/test.db");
    });

    describe("Explicit options override URL parameters", () => {
      test("explicit hostname should override URL hostname", () => {
        const options = new SQL("postgres://urluser:urlpass@urlhost:1234/urldb", {
          hostname: "explicithost",
        });

        expect(options.options.hostname).toBe("explicithost");
        expect(options.options.port).toBe(1234); // URL port should remain
        expect(options.options.username).toBe("urluser"); // URL username should remain
        expect(options.options.database).toBe("urldb"); // URL database should remain
      });

      test("explicit port should override URL port", () => {
        const options = new SQL("postgres://urluser:urlpass@urlhost:1234/urldb", {
          port: 5432,
        });

        expect(options.options.hostname).toBe("urlhost"); // URL hostname should remain
        expect(options.options.port).toBe(5432);
        expect(options.options.username).toBe("urluser"); // URL username should remain
        expect(options.options.database).toBe("urldb"); // URL database should remain
      });

      test("explicit username should override URL username", () => {
        const options = new SQL("postgres://urluser:urlpass@urlhost:1234/urldb", {
          username: "explicituser",
        });

        expect(options.options.hostname).toBe("urlhost"); // URL hostname should remain
        expect(options.options.port).toBe(1234); // URL port should remain
        expect(options.options.username).toBe("explicituser");
        expect(options.options.database).toBe("urldb"); // URL database should remain
      });

      test("explicit password should override URL password", () => {
        const options = new SQL("postgres://urluser:urlpass@urlhost:1234/urldb", {
          password: "explicitpass",
        });

        expect(options.options.hostname).toBe("urlhost"); // URL hostname should remain
        expect(options.options.port).toBe(1234); // URL port should remain
        expect(options.options.username).toBe("urluser"); // URL username should remain
        expect(options.options.password).toBe("explicitpass");
        expect(options.options.database).toBe("urldb"); // URL database should remain
      });

      test("explicit database should override URL database", () => {
        const options = new SQL("postgres://urluser:urlpass@urlhost:1234/urldb", {
          database: "explicitdb",
        });

        expect(options.options.hostname).toBe("urlhost"); // URL hostname should remain
        expect(options.options.port).toBe(1234); // URL port should remain
        expect(options.options.username).toBe("urluser"); // URL username should remain
        expect(options.options.database).toBe("explicitdb");
      });

      test("multiple explicit options should override corresponding URL parameters", () => {
        const options = new SQL("postgres://urluser:urlpass@urlhost:1234/urldb", {
          hostname: "explicithost",
          port: 5432,
          username: "explicituser",
          password: "explicitpass",
          database: "explicitdb",
        });

        expect(options.options.hostname).toBe("explicithost");
        expect(options.options.port).toBe(5432);
        expect(options.options.username).toBe("explicituser");
        expect(options.options.password).toBe("explicitpass");
        expect(options.options.database).toBe("explicitdb");
      });

      test("should work with MySQL URLs and explicit options", () => {
        const options = new SQL("mysql://urluser:urlpass@urlhost:3306/urldb", {
          hostname: "explicithost",
          port: 3307,
          username: "explicituser",
        });

        expect(options.options.adapter).toBe("mysql");
        expect(options.options.hostname).toBe("explicithost");
        expect(options.options.port).toBe(3307);
        expect(options.options.username).toBe("explicituser");
        expect(options.options.password).toBe("urlpass"); // URL password should remain
        expect(options.options.database).toBe("urldb"); // URL database should remain
      });

      test("should work with alternative option names (user, pass, db, host)", () => {
        const options = new SQL("postgres://urluser:urlpass@urlhost:1234/urldb", {
          host: "explicithost",
          user: "explicituser",
          pass: "explicitpass",
          db: "explicitdb",
        });

        expect(options.options.hostname).toBe("explicithost");
        expect(options.options.username).toBe("explicituser");
        expect(options.options.password).toBe("explicitpass");
        expect(options.options.database).toBe("explicitdb");
      });

      test("explicit options should override URL even when environment variables are present", () => {
        process.env.PGHOST = "envhost";
        process.env.PGPORT = "9999";
        process.env.PGUSER = "envuser";

        const options = new SQL("postgres://urluser:urlpass@urlhost:1234/urldb", {
          hostname: "explicithost",
          port: 5432,
          username: "explicituser",
        });

        expect(options.options.hostname).toBe("explicithost");
        expect(options.options.port).toBe(5432);
        expect(options.options.username).toBe("explicituser");
        expect(options.options.password).toBe("urlpass"); // URL password should remain since no explicit password
        expect(options.options.database).toBe("urldb"); // URL database should remain
      });

      test("explicit options should have higher precedence than environment-specific variables", () => {
        process.env.MYSQL_HOST = "mysqlhost";
        process.env.MYSQL_USER = "mysqluser";
        process.env.MYSQL_PASSWORD = "mysqlpass";

        const options = new SQL("mysql://urluser:urlpass@urlhost:3306/urldb", {
          hostname: "explicithost",
          username: "explicituser",
        });

        expect(options.options.adapter).toBe("mysql");
        expect(options.options.hostname).toBe("explicithost");
        expect(options.options.username).toBe("explicituser");
        expect(options.options.password).toBe("urlpass"); // URL password (not env)
        expect(options.options.database).toBe("urldb"); // URL database should remain
      });
    });
  });
});
