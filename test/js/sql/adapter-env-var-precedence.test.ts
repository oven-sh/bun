import { SQL } from "bun";
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { isWindows, tempDir } from "harness";

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
    'PGHOST', 'PGUSER', 'PGPASSWORD', 'PGDATABASE', 'PGPORT', 'PGUSERNAME',
    'PG_HOST', 'PG_USER', 'PG_PASSWORD', 'PG_DATABASE', 'PG_PORT',
    'PGSSLMODE', 'PG_SSLMODE',
    'PGAPPNAME', 'PGOPTIONS', 'PGCONNECT_TIMEOUT', 'PGCHANNELBINDING',
    'MYSQL_HOST', 'MYSQL_USER', 'MYSQL_PASSWORD', 'MYSQL_DATABASE', 'MYSQL_PORT',
    'MYSQLHOST', 'MYSQLUSER', 'MYSQLPASSWORD', 'MYSQLDATABASE', 'MYSQLPORT',
    'MARIADB_HOST', 'MARIADB_USER', 'MARIADB_PASSWORD', 'MARIADB_DATABASE', 'MARIADB_PORT',
    'MARIADBHOST', 'MARIADBUSER', 'MARIADBPASSWORD', 'MARIADBDATABASE', 'MARIADBPORT',
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

    for (const key of [...SQL_ENV_VARS, "USER", "USERNAME", "PASSWORD"]) {
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

  test.each([
    ["mysql", "mysql"],
    ["mariadb", ""],
  ] as const)("%s: the default database is %p", (adapter, database) => {
    expect(new SQL({ adapter, hostname: "localhost" }).options.database).toBe(database);
    expect(new SQL(`${adapter}://root@localhost/`).options.database).toBe(database);
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
        expect((fromUrl.options as any).query).toBe("");
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

    // The name of the variable asks for at least `require`.
    describe.each(["TLS_DATABASE_URL", "TLS_POSTGRES_DATABASE_URL"])("next to a URL from %s", urlVariable => {
      test.each([
        ["PGSSLMODE", "verify-ca", 3],
        ["PG_SSLMODE", "verify-full", 4],
      ])("%s=%s selects sslMode %d", (modeVariable, mode, expected) => {
        process.env[urlVariable] = "postgres://user@host:5432/db";
        process.env[modeVariable] = mode;

        expect(new SQL().options).toMatchObject({
          adapter: "postgres",
          sslMode: expected,
          tls: { serverName: "host" },
        });
      });

      test("PGSSLMODE=verify-ca is kept when the options give a CA", () => {
        process.env[urlVariable] = "postgres://user@host:5432/db";
        process.env.PGSSLMODE = "verify-ca";

        expect(new SQL({ tls: { ca: "x" } }).options.sslMode).toBe(3);
      });

      test("an invalid PGSSLMODE throws", () => {
        process.env[urlVariable] = "postgres://user@host:5432/db";
        process.env.PGSSLMODE = "bogus";

        expect(() => new SQL()).toThrow(
          expect.objectContaining({ code: "ERR_INVALID_ARG_VALUE", message: expect.stringContaining("sslmode") }),
        );
      });
    });

    test.each([
      ["TLS_DATABASE_URL", "postgres"],
      ["TLS_POSTGRES_DATABASE_URL", "postgres"],
      ["TLS_DATABASE_URL", "mysql"],
      ["TLS_MYSQL_DATABASE_URL", "mysql"],
      ["TLS_MARIADB_DATABASE_URL", "mariadb"],
    ])("a mode in the URL or in the options replaces the `require` of %s=%s://", (urlVariable, scheme) => {
      const resolved = (query: string, options?: SQL.Options) => {
        process.env[urlVariable] = `${scheme}://user@host/db${query}`;
        const { sslMode, tls } = new SQL(options).options;
        return [sslMode, tls];
      };
      const off = [0, undefined];
      const opportunistic = [1, { serverName: "host" }];
      const encrypted = [2, { serverName: "host" }];
      expect({
        "": resolved(""),
        "?sslmode=disable": resolved("?sslmode=disable"),
        "?sslmode=allow": resolved("?sslmode=allow"),
        "?sslmode=prefer": resolved("?sslmode=prefer"),
        "?ssl=false": resolved("?ssl=false"),
        "?tls=0": resolved("?tls=0"),
        "tls: false": resolved("", { tls: false }),
        "ssl: false": resolved("", { ssl: false }),
        'tls: "disable"': resolved("", { tls: "disable" }),
        'ssl: "prefer"': resolved("", { ssl: "prefer" }),
        "?sslmode=verify-ca": resolved("?sslmode=verify-ca"),
        "?sslmode=disable, tls: true": resolved("?sslmode=disable", { tls: true }),
      }).toEqual({
        "": encrypted,
        "?sslmode=disable": off,
        "?sslmode=allow": opportunistic,
        "?sslmode=prefer": opportunistic,
        "?ssl=false": off,
        "?tls=0": off,
        "tls: false": off,
        "ssl: false": off,
        'tls: "disable"': off,
        'ssl: "prefer"': opportunistic,
        "?sslmode=verify-ca": [3, { serverName: "host" }],
        "?sslmode=disable, tls: true": encrypted,
      });
    });

    test("a PostgreSQL unix socket has no TLS, from a TLS_* variable too", () => {
      process.env.TLS_DATABASE_URL = "postgres://user@host/db?path=/run/postgresql/.s.PGSQL.5432";
      expect(new SQL().options).toMatchObject({ path: "/run/postgresql/.s.PGSQL.5432", sslMode: 0, tls: undefined });
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
      expect((options.options as any).query).toBe("");
      expect(options.options.sslMode).toBe(expectedMode);
      expect(options.options.tls).toEqual(expectedTls);
    });

    test.each(["mysql://u:p@h/db?ssl=true", "mysql://u:p@h/db?ssl=1", "postgres://u@h:5432/db?tls=TRUE"])(
      "%s requires an encrypted connection",
      url => {
        const options = new SQL(url);
        expect((options.options as any).query).toBe("");
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
        expect((options.options as any).query).toBe("");
        expect(options.options.sslMode).toBe(0);
        expect(options.options.tls).toBeUndefined();
      },
    );

    test.each(["postgres://u@h:5432/db?ssl=false", "postgres://u@h:5432/db?tls=0"])(
      "%s disables a mode selected by PGSSLMODE",
      url => {
        process.env.PGSSLMODE = "verify-full";

        const options = new SQL(url);
        expect((options.options as any).query).toBe("");
        expect(options.options.sslMode).toBe(0);
        expect(options.options.tls).toBeUndefined();
      },
    );

    test("an empty ?tls= is treated as unset and keeps the mode selected by PGSSLMODE", () => {
      process.env.PGSSLMODE = "require";

      const options = new SQL("postgres://u@h:5432/db?tls=");
      expect((options.options as any).query).toBe("");
      expect(options.options.sslMode).toBe(2);
      expect(options.options.tls).toEqual({ serverName: "h" });
    });

    test("an explicit tls option takes priority over ?ssl=false", () => {
      const options = new SQL("postgres://u@h:5432/db?ssl=false", { tls: true });
      expect(options.options.sslMode).toBe(2);
      expect(options.options.tls).toEqual({ serverName: "h" });
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

  describe("tls given as a BunFile", () => {
    test("tls: Bun.file(path) is the CA to verify the server against, like tls: { ca }", () => {
      using dir = tempDir("sql-tls-bunfile", { "ca.pem": "" });
      const ca = Bun.file(`${dir}/ca.pem`);

      for (const key of ["tls", "ssl"] as const) {
        const options = new SQL({ adapter: "postgres", hostname: "h", [key]: ca });
        expect(options.options.sslMode).toBe(4); // SSLMode.verify_full
        expect(options.options.tls).toEqual({ ca, serverName: "h" });
        expect((options.options.tls as Bun.TLSOptions).ca).toBe(ca);
      }

      const mysqlOptions = new SQL("mysql://u:p@h/db", { tls: ca });
      expect(mysqlOptions.options.adapter).toBe("mysql");
      expect(mysqlOptions.options.sslMode).toBe(4);
      expect((mysqlOptions.options.tls as Bun.TLSOptions).ca).toBe(ca);

      // An sslmode that already verifies the chain is kept; the file is still the CA.
      const fromUrl = new SQL("postgres://u@h:5432/db?sslmode=verify-ca", { tls: ca });
      expect(fromUrl.options.sslMode).toBe(3);
      expect(fromUrl.options.tls).toEqual({ ca, serverName: "h" });
      expect((fromUrl.options.tls as Bun.TLSOptions).ca).toBe(ca);
    });
  });

  describe("the tls option object", () => {
    test.each([true, {}, { rejectUnauthorized: false }])("tls: %p names the host, like tls: 'require'", tls => {
      for (const adapter of ["postgres", "mysql"] as const) {
        const { options } = new SQL({ adapter, hostname: "h", tls });
        expect(options.sslMode).toBe(2);
        expect(options.tls).toEqual({ ...(tls as object), serverName: "h" });
      }
    });

    test.each([
      ["rejectUnauthorized", false],
      ["serverName", "other.example"],
    ])("an inherited %s is not read", (key, value) => {
      Object.defineProperty(Object.prototype, key, { value, configurable: true, enumerable: true });
      try {
        const { options } = new SQL({ adapter: "postgres", hostname: "h", tls: { ca: "x" } });
        expect(options.sslMode).toBe(4);
        expect({ ...(options.tls as object) }).toEqual({ ca: "x", serverName: "h" });
        expect(Object.getPrototypeOf(options.tls)).toBeNull();
      } finally {
        delete Object.prototype[key];
      }
    });
  });

  describe("the SSL mode stated in two places", () => {
    const MODES = ["disable", "allow", "prefer", "require", "verify-ca", "verify-full"] as const;
    const RESOLVED = ["disable", "prefer", "require", "verify-ca", "verify-full"] as const;
    type Mode = (typeof MODES)[number];
    type Setting = {
      label: string;
      // The mode the setting names. Without one it only asks for TLS.
      mode?: Mode;
      env?: Record<string, string>;
      urlVariable?: string;
      query?: string;
      options?: SQL.Options;
    };
    const option = (key: "ssl" | "tls"): Setting[] => [
      ...MODES.map(mode => ({ label: mode, mode, options: { [key]: mode } })),
      { label: "true", options: { [key]: true } },
      { label: "{}", options: { [key]: {} } },
    ];
    // From the lowest priority to the highest.
    const SOURCES: [string, Setting[]][] = [
      ["PGSSLMODE", MODES.map(mode => ({ label: mode, mode, env: { PGSSLMODE: mode } }))],
      ["URL variable", [{ label: "TLS_DATABASE_URL", urlVariable: "TLS_DATABASE_URL" }]],
      [
        "URL query",
        [
          ...MODES.map(mode => ({ label: mode, mode, query: `?sslmode=${mode}` })),
          { label: "ssl=true", query: "?ssl=true" },
        ],
      ],
      ["ssl", option("ssl")],
      ["tls", option("tls")],
    ];

    function resolve(scheme: "postgres" | "mysql", ...settings: Setting[]) {
      const { env, urlVariable = "DATABASE_URL", query = "" } = Object.assign({}, ...settings) as Setting;
      const options = Object.assign({}, ...settings.map(setting => setting.options));
      Object.assign(process.env, env, { [urlVariable]: `${scheme}://u@h/db${query}` });
      try {
        return RESOLVED[new SQL(options).options.sslMode!];
      } finally {
        for (const key of [...Object.keys(env ?? {}), urlVariable]) delete process.env[key];
      }
    }

    function table(scheme: "postgres" | "mysql", sources = SOURCES) {
      let out = "";
      sources.forEach(([rowSource, rows], i) => {
        for (const [columnSource, columns] of sources.slice(i + 1)) {
          out +=
            `\n${`${rowSource} \\ ${columnSource}`.padEnd(26)}${columns.map(c => c.label.padEnd(12)).join("")}`.trimEnd();
          for (const row of rows) {
            out +=
              `\n${row.label.padEnd(26)}${columns.map(c => resolve(scheme, row, c).padEnd(12)).join("")}`.trimEnd();
          }
          out += "\n";
        }
      });
      return out;
    }

    test("every pair of places", () => {
      expect(table("postgres")).toMatchInlineSnapshot(`
        "
        PGSSLMODE \\ URL variable  TLS_DATABASE_URL
        disable                   require
        allow                     require
        prefer                    require
        require                   require
        verify-ca                 verify-ca
        verify-full               verify-full

        PGSSLMODE \\ URL query     disable     allow       prefer      require     verify-ca   verify-full ssl=true
        disable                   disable     prefer      prefer      require     verify-ca   verify-full require
        allow                     disable     prefer      prefer      require     verify-ca   verify-full require
        prefer                    disable     prefer      prefer      require     verify-ca   verify-full require
        require                   disable     prefer      prefer      require     verify-ca   verify-full require
        verify-ca                 disable     prefer      prefer      require     verify-ca   verify-full verify-ca
        verify-full               disable     prefer      prefer      require     verify-ca   verify-full verify-full

        PGSSLMODE \\ ssl           disable     allow       prefer      require     verify-ca   verify-full true        {}
        disable                   disable     prefer      prefer      require     verify-ca   verify-full require     require
        allow                     disable     prefer      prefer      require     verify-ca   verify-full require     require
        prefer                    disable     prefer      prefer      require     verify-ca   verify-full require     require
        require                   disable     prefer      prefer      require     verify-ca   verify-full require     require
        verify-ca                 disable     prefer      prefer      require     verify-ca   verify-full verify-ca   verify-ca
        verify-full               disable     prefer      prefer      require     verify-ca   verify-full verify-full verify-full

        PGSSLMODE \\ tls           disable     allow       prefer      require     verify-ca   verify-full true        {}
        disable                   disable     prefer      prefer      require     verify-ca   verify-full require     require
        allow                     disable     prefer      prefer      require     verify-ca   verify-full require     require
        prefer                    disable     prefer      prefer      require     verify-ca   verify-full require     require
        require                   disable     prefer      prefer      require     verify-ca   verify-full require     require
        verify-ca                 disable     prefer      prefer      require     verify-ca   verify-full verify-ca   verify-ca
        verify-full               disable     prefer      prefer      require     verify-ca   verify-full verify-full verify-full

        URL variable \\ URL query  disable     allow       prefer      require     verify-ca   verify-full ssl=true
        TLS_DATABASE_URL          disable     prefer      prefer      require     verify-ca   verify-full require

        URL variable \\ ssl        disable     allow       prefer      require     verify-ca   verify-full true        {}
        TLS_DATABASE_URL          disable     prefer      prefer      require     verify-ca   verify-full require     require

        URL variable \\ tls        disable     allow       prefer      require     verify-ca   verify-full true        {}
        TLS_DATABASE_URL          disable     prefer      prefer      require     verify-ca   verify-full require     require

        URL query \\ ssl           disable     allow       prefer      require     verify-ca   verify-full true        {}
        disable                   disable     prefer      prefer      require     verify-ca   verify-full require     require
        allow                     disable     prefer      prefer      require     verify-ca   verify-full require     require
        prefer                    disable     prefer      prefer      require     verify-ca   verify-full require     require
        require                   disable     prefer      prefer      require     verify-ca   verify-full require     require
        verify-ca                 disable     prefer      prefer      require     verify-ca   verify-full verify-ca   verify-ca
        verify-full               disable     prefer      prefer      require     verify-ca   verify-full verify-full verify-full
        ssl=true                  disable     prefer      prefer      require     verify-ca   verify-full require     require

        URL query \\ tls           disable     allow       prefer      require     verify-ca   verify-full true        {}
        disable                   disable     prefer      prefer      require     verify-ca   verify-full require     require
        allow                     disable     prefer      prefer      require     verify-ca   verify-full require     require
        prefer                    disable     prefer      prefer      require     verify-ca   verify-full require     require
        require                   disable     prefer      prefer      require     verify-ca   verify-full require     require
        verify-ca                 disable     prefer      prefer      require     verify-ca   verify-full verify-ca   verify-ca
        verify-full               disable     prefer      prefer      require     verify-ca   verify-full verify-full verify-full
        ssl=true                  disable     prefer      prefer      require     verify-ca   verify-full require     require

        ssl \\ tls                 disable     allow       prefer      require     verify-ca   verify-full true        {}
        disable                   disable     prefer      prefer      require     verify-ca   verify-full require     require
        allow                     prefer      prefer      prefer      require     verify-ca   verify-full require     require
        prefer                    prefer      prefer      prefer      require     verify-ca   verify-full require     require
        require                   require     require     require     require     verify-ca   verify-full require     require
        verify-ca                 verify-ca   verify-ca   verify-ca   verify-ca   verify-ca   verify-full verify-ca   verify-ca
        verify-full               verify-full verify-full verify-full verify-full verify-full verify-full verify-full verify-full
        true                      disable     prefer      prefer      require     verify-ca   verify-full require     require
        {}                        disable     prefer      prefer      require     verify-ca   verify-full require     require
        "
      `);

      // MySQL resolves the same modes, and does not read PGSSLMODE.
      const [[, pgsslmode], ...others] = SOURCES;
      expect(table("mysql", others)).toBe(table("postgres", others));
      for (const [, settings] of others) {
        for (const setting of settings) {
          for (const env of pgsslmode) expect(resolve("mysql", setting, env)).toBe(resolve("mysql", setting));
        }
      }
    });

    test("a setting that only asks for TLS never lowers the mode another one names", () => {
      const lowered: string[] = [];
      for (const [weakSource, weakSettings] of SOURCES) {
        for (const weak of weakSettings.filter(setting => !setting.mode)) {
          for (const [source, settings] of SOURCES.filter(([source]) => source !== weakSource)) {
            for (const named of settings.filter(setting => setting.mode)) {
              const resolved = resolve("postgres", weak, named);
              if (RESOLVED.indexOf(resolved) < RESOLVED.indexOf(resolve("postgres", named))) {
                lowered.push(`${source} ${named.label} + ${weakSource} ${weak.label} = ${resolved}`);
              }
            }
          }
        }
      }
      expect(lowered).toEqual([]);
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
      const options = new SQL("sqlite:///tmp/test.db", { adapter: "sqlite", readonly: true });
      expect(options.options.adapter).toBe("sqlite");
      expect(options.options.filename).toBe("/tmp/test.db");
    });

    test("should work with sqlite:// protocol without adapter", () => {
      const options = new SQL("sqlite:///tmp/test.db", { readonly: true });
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

  // [title, environment, arguments of `new SQL()`, what `sql.options` has]
  type Row = [string, Record<string, string>, [(string | SQL.Options)?, SQL.Options?], Record<string, unknown>];
  function expectOptions(...[, env, args, expected]: Row) {
    Object.assign(process.env, env);
    expect(new SQL(...(args as [string, SQL.Options])).options).toMatchObject(expected);
  }

  describe("a connection URL from the environment", () => {
    const envUrl = "postgres://envuser:ENVSECRET@envhost:7/envdb";
    const byUrl = { url: "postgres://appuser:apppw@apphost:1/appdb" };
    const app = { adapter: "postgres", hostname: "apphost", port: 1, username: "appuser", password: "apppw" };

    const rest = { port: 7, username: "envuser", password: "ENVSECRET", database: "envdb" };
    const five = { hostname: "apphost", port: 1, username: "appuser", password: "apppw", database: "appdb" };
    test.each<Row>([
      ...["hostname", "host"].flatMap(key =>
        ["DATABASE_URL", "POSTGRES_URL"].map((name): Row => [
          key,
          { [name]: envUrl },
          [{ [key]: "apphost" }],
          { hostname: "apphost", ...rest },
        ]),
      ),
      ["hostname", { DATABASE_URL: `${envUrl}?sslmode=verify-full` }, [{ hostname: "apphost" }], { sslMode: 4 }],
      ["hostname", { DATABASE_URL: `${envUrl}?sslmode=verify-full` }, [five], { ...five, sslMode: 4 }],
      ["hostname", { DATABASE_URL: `${envUrl}?sslmode=verify-full` }, [{ ...five, tls: true }], { sslMode: 4 }],
      ["hostname", { DATABASE_URL: `${envUrl}?sslmode=verify-full` }, [{ ...five, tls: false }], { sslMode: 0 }],
      ["hostname", { TLS_DATABASE_URL: envUrl }, [{ hostname: "apphost" }], { hostname: "apphost", sslMode: 2 }],
      [
        "hostname",
        { MYSQL_URL: "mysql://x:y@envhost:9/x" },
        [{ hostname: "apphost" }],
        { adapter: "mysql", hostname: "apphost", port: 9, username: "x", password: "y", database: "x" },
      ],
      [
        "hostname",
        { DATABASE_URL: "mysql://x:y@envhost:9/x?sslmode=require" },
        [{ adapter: "postgres", hostname: "apphost" }],
        { adapter: "postgres", hostname: "apphost", port: 9, username: "x", password: "y", database: "x", sslMode: 2 },
      ],
    ])("fills in what options with `%s` leave out (%j, %j)", expectOptions);

    test.each(["path", "socket"])("fills in what options with `%s` leave out", key => {
      process.env.MYSQL_URL = "mysql://envuser:ENVSECRET@envhost:7/envdb";
      expect(new SQL({ [key]: "/run/app.sock" } as SQL.Options).options).toMatchObject({
        adapter: "mysql",
        path: "/run/app.sock",
        username: "envuser",
        password: "ENVSECRET",
        database: "envdb",
      });
    });

    test("is above the per-field variables next to a host too, except for the database", () => {
      Object.assign(process.env, { DATABASE_URL: envUrl, PGUSER: "pguser", PGPASSWORD: "pgpw", PGDATABASE: "pgdb" });
      expect(new SQL({ hostname: "apphost" }).options).toMatchObject({
        hostname: "apphost",
        username: "envuser",
        password: "ENVSECRET",
        database: "pgdb",
      });
    });

    // Of the variable only the name counts: for the adapter, where the URL in the options names none, and TLS_.
    test.each<Row>([
      ["TLS_", { TLS_DATABASE_URL: envUrl }, [byUrl], { ...app, database: "appdb", sslMode: 2 }],
      ["TLS_", { TLS_POSTGRES_DATABASE_URL: envUrl }, [byUrl], { ...app, database: "appdb", sslMode: 2 }],
      ["no ?sslmode=", { DATABASE_URL: `${envUrl}?sslmode=verify-full` }, [byUrl], { ...app, sslMode: 0 }],
      [
        "the adapter",
        { MYSQL_URL: "mysql://x:y@envhost:9/x" },
        [{ url: "appuser:apppw@apphost:1/appdb" }],
        { ...app, adapter: "mysql", database: "appdb" },
      ],
      [
        "the adapter, between mysql and mariadb",
        { MARIADB_URL: "mariadb://x:y@envhost:9/x" },
        [{ url: "mysql://appuser:apppw@apphost:1/appdb" }],
        { ...app, adapter: "mariadb", database: "appdb" },
      ],
    ])("next to `url` in the options: %s (%j)", expectOptions);

    test.each<Row>([
      ["TLS_DATABASE_URL", { TLS_DATABASE_URL: envUrl }, [byUrl.url], { ...app, sslMode: 0 }],
      ["MYSQL_URL", { MYSQL_URL: "mysql://x:y@envhost:9/x" }, ["appuser:apppw@apphost:1/appdb"], app],
      ["DATABASE_URL", { DATABASE_URL: envUrl }, [""], { hostname: "localhost", port: 5432, password: "" }],
    ])("is not read next to a string as the first argument (%s)", expectOptions);

    test.each<Row>([
      ["MYSQL_URL", { MYSQL_URL: "mysql://x:y@envhost:9/x" }, [byUrl], { ...app, database: "appdb" }],
      ["SQLITE_URL", { SQLITE_URL: "sqlite://:memory:" }, [byUrl], { ...app, database: "appdb" }],
      ["DATABASE_URL", { DATABASE_URL: "mysql://x:y@envhost:9/x" }, [byUrl], { ...app, database: "appdb" }],
      [
        "POSTGRES_URL",
        { POSTGRES_URL: envUrl },
        [{ url: "mysql://appuser:apppw@apphost:1/appdb" }],
        { ...app, adapter: "mysql" },
      ],
    ])("the scheme of `url` in the options wins over the name %s", expectOptions);

    test.each<Row>([
      ["hostname", { DATABASE_URL: ":memory:" }, [{ hostname: "apphost" }], { adapter: "postgres" }],
      ["host", { DATABASE_URL: "sqlite://app.db" }, [{ host: "apphost" }], { adapter: "postgres" }],
      ["path", { SQLITE_URL: "sqlite://:memory:" }, [{ path: "/run/app.sock" }], { adapter: "postgres" }],
      [
        "hostname",
        { DATABASE_URL: ":memory:", POSTGRES_URL: envUrl },
        [{ hostname: "apphost" }],
        { hostname: "apphost", ...rest },
      ],
    ])("an SQLite URL counts as not set next to `%s` (%j)", expectOptions);

    test.each<Row>([
      ["{ username, password, database }", {}, [{ username: "u", password: "p", database: "d" }], {}],
      ["{ port }", {}, [{ port: 5433 }], {}],
      ["{ tls }", {}, [{ tls: true }], {}],
      ["{ max }", {}, [{ max: 1 }], {}],
    ])("an SQLite URL is read next to %s", (title, env, args) => {
      expectOptions(title, { ...env, DATABASE_URL: ":memory:" }, args, { adapter: "sqlite", filename: ":memory:" });
    });

    test.each(["MYSQL_URL", "PGURL", "TLS_POSTGRES_DATABASE_URL"])("an SQLite URL in %s is an SQLite URL", name => {
      process.env[name] = "sqlite://:memory:";
      expect(new SQL().options).toMatchObject({ adapter: "sqlite", filename: ":memory:" });
    });

    const fromEnv = { hostname: "envhost", port: 7, username: "envuser", password: "ENVSECRET", database: "envdb" };
    test.each<Row>([
      ["no argument", {}, [], fromEnv],
      ["{ adapter }", {}, [{ adapter: "postgres" }], fromEnv],
      ["{ max }", {}, [{ max: 1 }], fromEnv],
      ["{ tls }", {}, [{ tls: true }], { ...fromEnv, sslMode: 2 }],
      ["{ port }", {}, [{ port: 9 }], { ...fromEnv, port: 9 }],
      ["{ database }", {}, [{ database: "appdb" }], { ...fromEnv, database: "appdb" }],
      ["{ username, password }", {}, [{ username: "u", password: "p" }], { ...fromEnv, username: "u", password: "p" }],
    ])("is read with %s", (title, env, args, expected) => {
      expectOptions(title, { ...env, DATABASE_URL: envUrl }, args, expected);
    });

    const pg = "postgres://pu:pp@pghost:1/pd";
    const my = "mysql://mu:mp@myhost:2/md";
    test.each<Row>([
      ["DATABASE_URL before POSTGRES_URL", { DATABASE_URL: envUrl, POSTGRES_URL: pg }, [], { hostname: "envhost" }],
      [
        "DATABASE_URL before MYSQL_URL",
        { DATABASE_URL: pg, MYSQL_URL: my },
        [],
        { adapter: "postgres", hostname: "pghost" },
      ],
      [
        "DATABASE_URL before SQLITE_URL",
        { DATABASE_URL: pg, SQLITE_URL: "sqlite://x.db" },
        [],
        { adapter: "postgres", hostname: "pghost" },
      ],
      [
        "DATABASE_URL before TLS_POSTGRES_DATABASE_URL",
        { DATABASE_URL: envUrl, TLS_POSTGRES_DATABASE_URL: pg },
        [],
        { hostname: "envhost", sslMode: 0 },
      ],
      [
        "{ adapter: 'postgres' }: DATABASE_URL before POSTGRES_URL",
        { DATABASE_URL: envUrl, POSTGRES_URL: pg },
        [{ adapter: "postgres" }],
        { hostname: "envhost" },
      ],
      [
        "POSTGRES_URL before MYSQL_URL",
        { POSTGRES_URL: pg, MYSQL_URL: my },
        [],
        { adapter: "postgres", hostname: "pghost" },
      ],
      [
        "{ adapter: 'mysql' }: MYSQL_URL, not the PostgreSQL DATABASE_URL",
        { DATABASE_URL: pg, MYSQL_URL: my },
        [{ adapter: "mysql" }],
        { adapter: "mysql", hostname: "myhost", port: 2, username: "mu", password: "mp", database: "md" },
      ],
      [
        "{ adapter: 'postgres' }: POSTGRES_URL, not the MySQL DATABASE_URL",
        { DATABASE_URL: my, POSTGRES_URL: pg },
        [{ adapter: "postgres" }],
        { adapter: "postgres", hostname: "pghost", port: 1, username: "pu", password: "pp", database: "pd" },
      ],
      [
        "{ adapter: 'mysql' }: a PostgreSQL DATABASE_URL counts as not set",
        { DATABASE_URL: pg },
        [{ adapter: "mysql" }],
        { adapter: "mysql", hostname: "localhost", port: 3306, username: "root", password: "", database: "mysql" },
      ],
      [
        "{ adapter: 'postgres' }: a MySQL TLS_DATABASE_URL counts as not set, except for the TLS in its name",
        { TLS_DATABASE_URL: my },
        [{ adapter: "postgres" }],
        { adapter: "postgres", hostname: "localhost", password: "", sslMode: 2 },
      ],
      [
        "{ adapter: 'postgres' }: a MySQL URL without a host names no other server, and fills in",
        { DATABASE_URL: "mysql://mu:mp@/md?ssl-mode=VERIFY_IDENTITY" },
        [{ adapter: "postgres" }],
        { adapter: "postgres", hostname: "localhost", port: 5432, username: "mu", database: "md", sslMode: 4 },
      ],
      [
        "{ adapter: 'mysql' }: so does a PostgreSQL URL without a host",
        { DATABASE_URL: "postgres:///pd?sslmode=require" },
        [{ adapter: "mysql" }],
        { adapter: "mysql", hostname: "localhost", port: 3306, database: "pd", sslMode: 2 },
      ],
      [
        "{ adapter: 'postgres' }: the next generic variable is read after a foreign one",
        { DATABASE_URL: my, DATABASEURL: pg },
        [{ adapter: "postgres" }],
        { adapter: "postgres", hostname: "pghost" },
      ],
      [
        "{ adapter: 'mariadb' }: mysql:// is the same family",
        { DATABASE_URL: my },
        [{ adapter: "mariadb" }],
        { adapter: "mariadb", hostname: "myhost" },
      ],
      [
        "{ adapter: 'mysql' }: a URL without a scheme names no other adapter",
        { DATABASE_URL: "mu@myhost:2/md" },
        [{ adapter: "mysql" }],
        { adapter: "mysql", hostname: "myhost", port: 2 },
      ],
    ])("%s", expectOptions);

    // `adapter` passes over the URL of another adapter's server. The server is not dialed and gets no credentials,
    // but the connection is as well protected as that URL asks for.
    const localPostgres = { adapter: "postgres", hostname: "localhost", port: 5432, password: "" };
    const localMySQL = { adapter: "mysql", hostname: "localhost", port: 3306, password: "", database: "mysql" };
    const postgres = [{ adapter: "postgres" }] as Row[2];
    const mysql = [{ adapter: "mysql" }] as Row[2];
    test.each<Row>([
      ["", { DATABASE_URL: "mysql://localhost/db?ssl-mode=REQUIRED" }, postgres, { ...localPostgres, sslMode: 2 }],
      ["", { DATABASE_URL: "mysql://u:p@localhost/db?ssl-mode=REQUIRED" }, postgres, { ...localPostgres, sslMode: 2 }],
      [
        "",
        { DATABASE_URL: "mysql://127.0.0.1/db?ssl-mode=VERIFY_IDENTITY" },
        postgres,
        { ...localPostgres, sslMode: 4 },
      ],
      ["", { DATABASE_URL: "postgres://localhost/db?sslmode=require" }, mysql, { ...localMySQL, sslMode: 2 }],
      [
        "",
        { DATABASE_URL: "postgres://u:p@localhost:5432/db?sslmode=verify-full" },
        mysql,
        { ...localMySQL, sslMode: 4 },
      ],
      ["", { DATABASE_URL: "mysql://other.example/db?ssl-mode=REQUIRED" }, postgres, { ...localPostgres, sslMode: 2 }],
      ["", { DATABASE_URL: "postgres://other.example/db?sslmode=require" }, mysql, { ...localMySQL, sslMode: 2 }],
      ["", { DATABASE_URL: "postgres://localhost/db?ssl=true" }, mysql, { ...localMySQL, sslMode: 2 }],
      ["", { DATABASE_URL: "postgres://localhost/db?sslmode=prefer" }, mysql, { ...localMySQL, sslMode: 1 }],
      ["", { DATABASE_URL: "postgres://localhost/db" }, mysql, { ...localMySQL, sslMode: 0 }],
      ["", { TLS_DATABASE_URL: "postgres://localhost/db" }, mysql, { ...localMySQL, sslMode: 2 }],
      ["", { TLS_DATABASE_URL: "postgres://localhost/db?sslmode=disable" }, mysql, { ...localMySQL, sslMode: 0 }],
      // without a host it is not passed over
      ["", { DATABASE_URL: "mysql://?ssl-mode=VERIFY_IDENTITY" }, postgres, { ...localPostgres, sslMode: 4 }],
      ["", { DATABASE_URL: "postgres://?sslmode=require" }, mysql, { ...localMySQL, sslMode: 2 }],
      ["", { DATABASE_URL: "postgres:///pd?sslmode=require" }, mysql, { ...localMySQL, database: "pd", sslMode: 2 }],
      // its own adapter's
      [
        "",
        { DATABASE_URL: "postgres://localhost/db?sslmode=require" },
        postgres,
        { ...localPostgres, database: "db", sslMode: 2 },
      ],
    ])("the mode of the URL that `adapter` passes over%s: %j %j", expectOptions);

    const verified = { DATABASE_URL: "postgres://localhost/db?sslmode=verify-full" };
    test.each<Row>([
      ["tls: false replaces it", verified, [{ adapter: "mysql", tls: false }], { sslMode: 0 }],
      ['ssl: "require" replaces it', verified, [{ adapter: "mysql", ssl: "require" }], { sslMode: 2 }],
      ["tls: true does not", verified, [{ adapter: "mysql", tls: true }], { sslMode: 4 }],
      ["a tls object does not", verified, [{ adapter: "mysql", tls: {} }], { sslMode: 4 }],
      [
        "it does not keep tls: { ca } from verify-full",
        { DATABASE_URL: "postgres://localhost/db?sslmode=verify-ca" },
        [{ adapter: "mysql", tls: { ca: "x" } }],
        { sslMode: 4 },
      ],
      // The adapter's own URL speaks for its server itself.
      [
        "not next to the adapter's own URL, on the same host either",
        { DATABASE_URL: "postgres://localhost/db?sslmode=require", MYSQL_URL: "mysql://localhost/db" },
        mysql,
        { hostname: "localhost", port: 3306, database: "db", sslMode: 0 },
      ],
      [
        "not next to the adapter's own URL",
        { DATABASE_URL: "postgres://pghost/db?sslmode=verify-full", MYSQL_URL: my },
        mysql,
        { hostname: "myhost", port: 2, username: "mu", password: "mp", database: "md", sslMode: 0 },
      ],
      [
        "not over the mode of the adapter's own URL",
        { DATABASE_URL: "postgres://pghost/db?sslmode=require", MYSQL_URL: `${my}?ssl-mode=DISABLED` },
        mysql,
        { hostname: "myhost", sslMode: 0 },
      ],
      [
        "nor under it",
        { DATABASE_URL: "postgres://pghost/db?sslmode=require", MYSQL_URL: `${my}?ssl-mode=VERIFY_IDENTITY` },
        mysql,
        { hostname: "myhost", sslMode: 4 },
      ],
      [
        "nor the TLS_ in its name",
        { TLS_DATABASE_URL: "postgres://pghost/db", MYSQL_URL: my },
        mysql,
        { hostname: "myhost", sslMode: 0 },
      ],
      [
        "the TLS_ in the name of the adapter's own URL is as ever",
        { DATABASE_URL: "postgres://pghost/db?sslmode=verify-full", TLS_MYSQL_DATABASE_URL: my },
        mysql,
        { hostname: "myhost", sslMode: 2 },
      ],
      [
        "a PostgreSQL unix socket has no TLS all the same",
        { DATABASE_URL: "mysql://myhost/db?ssl-mode=REQUIRED", PGHOST: "/run/pg" },
        postgres,
        { path: "/run/pg/.s.PGSQL.5432", sslMode: 0 },
      ],
    ])("the mode of the URL that `adapter` passes over: %s", expectOptions);
  });

  describe.each([
    ["postgres", "PG", "PG_", 5432, "postgres"],
    ["mysql", "MYSQL", "MYSQL_", 3306, "root"],
    ["mariadb", "MARIADB", "MARIADB_", 3306, "root"],
  ] as const)("%s: option > URL > environment > default", (adapter, prefix, underscored, defaultPort, defaultUser) => {
    const fields = ({ options: o }: InstanceType<typeof SQL>) => [
      o.hostname,
      o.port,
      o.username,
      o.password,
      o.database,
    ];
    const url = `${adapter}://uu:up@uh:2222/ud`;
    const setEnv = (prefix: string, tag: string) =>
      Object.assign(process.env, {
        [`${prefix}HOST`]: `${tag}h`,
        [`${prefix}PORT`]: "1111",
        [`${prefix}USER`]: `${tag}u`,
        [`${prefix}PASSWORD`]: `${tag}p`,
        [`${prefix}DATABASE`]: `${tag}d`,
      });

    test("every field", () => {
      expect(fields(new SQL({ adapter }))).toEqual([
        "localhost",
        defaultPort,
        defaultUser,
        "",
        adapter === "postgres" ? defaultUser : adapter === "mysql" ? "mysql" : "",
      ]);

      setEnv(prefix, "e");
      expect(fields(new SQL({ adapter }))).toEqual(["eh", 1111, "eu", "ep", "ed"]);
      expect(fields(new SQL(`${adapter}://uh`))).toEqual(["uh", 1111, "eu", "ep", "ed"]);
      // the database is the one field whose variable is above the URL
      for (const sql of [new SQL(url), new SQL({ url }), new SQL({ adapter, url }), new SQL(new URL(url) as never)]) {
        expect(fields(sql)).toEqual(["uh", 2222, "uu", "up", "ed"]);
      }
      const options = { hostname: "oh", port: 3333, username: "ou", password: "op", database: "od" };
      expect(fields(new SQL(url, options))).toEqual(["oh", 3333, "ou", "op", "od"]);

      setEnv(underscored, "x");
      expect(fields(new SQL({ adapter }))).toEqual(["xh", 1111, "xu", "xp", "xd"]);
    });

    test("a URL from the environment is above the per-field variables, except for the database", () => {
      setEnv(prefix, "e");
      process.env.DATABASE_URL = url;
      expect(fields(new SQL())).toEqual(["uh", 2222, "uu", "up", "ed"]);
    });

    test("the URL is percent-decoded, and only where it is used", () => {
      expect(fields(new SQL(`${adapter}://u%40u:p%2Fp@uh/u%20d`)).slice(2)).toEqual(["u@u", "p/p", "u d"]);
      expect(() => new SQL(`${adapter}://uu@uh/d%`)).toThrow(URIError);
      expect(new SQL(`${adapter}://uu:p%@uh/d%`, { password: "p%", database: "d%" }).options).toMatchObject({
        password: "p%",
        database: "d%",
      });
    });

    test("an option wins over its deprecated alias, with and without a URL", () => {
      const both = {
        hostname: "hostname",
        host: "host",
        username: "username",
        user: "user",
        password: "password",
        pass: "pass",
        database: "database",
        db: "db",
      };
      const expected = ["hostname", defaultPort, "username", "password", "database"];
      expect(fields(new SQL({ adapter, ...both }))).toEqual(expected);
      expect(fields(new SQL(`${adapter}://uu:up@uh/ud`, both))).toEqual(expected);
    });

    test("the user name falls back to $USER, then $USERNAME", () => {
      process.env.USERNAME = "windows-user";
      expect(new SQL({ adapter }).options.username).toBe("windows-user");
      process.env.USER = "unix-user";
      expect(new SQL({ adapter }).options.username).toBe("unix-user");
    });

    test("$PASSWORD is not the database password", () => {
      process.env.PASSWORD = "unrelated secret";
      expect(new SQL({ adapter }).options.password).toBe("");
      expect(new SQL(`${adapter}://uu@uh/ud`).options.password).toBe("");
    });
  });

  test("PGUSERNAME is read before PGUSER, after the URL, and only by postgres", () => {
    process.env.PGUSERNAME = "pgusername";
    expect(new SQL({ adapter: "postgres" }).options).toMatchObject({ username: "pgusername", database: "pgusername" });
    process.env.PGUSER = "pguser";
    expect(new SQL({ adapter: "postgres" }).options.username).toBe("pgusername");
    expect(new SQL("postgres://urluser@h/d").options.username).toBe("urluser");
    expect(new SQL({ adapter: "mysql" }).options.username).toBe("root");
  });

  describe("unix socket path", () => {
    const adapters = ["postgres", "mysql", "mariadb"] as const;

    test.each(adapters)("%s: a path is used as given, whether or not it exists", adapter => {
      const path = "/nonexistent/dir/db.sock";
      const expected = { adapter, path, hostname: "dbhost", database: "db" };
      expect(new SQL({ adapter, path, hostname: "dbhost", database: "db" }).options).toMatchObject(expected);
      expect(new SQL({ adapter, socket: path, hostname: "dbhost", database: "db" } as never).options).toMatchObject(
        expected,
      );
      for (const key of ["path", "socket"]) {
        const { options } = new SQL(`${adapter}://u:p@dbhost/db?${key}=${path}`);
        expect(options).toMatchObject({ ...expected, query: "" });
      }
    });

    test.each<Row>([
      ["path over socket", {}, [{ path: "/a", socket: "/b" } as never], { path: "/a" }],
      [
        "the option over the URL",
        {},
        ["mysql://h/d?path=/url.sock", { path: "/option.sock" }],
        { path: "/option.sock" },
      ],
      ["socket over the URL", {}, ["mysql://h/d?path=/url.sock", { socket: "/b" } as never], { path: "/b" }],
      ["the first of ?path= and ?socket=", {}, ["mysql://h/d?socket=/b&path=/a"], { path: "/b" }],
    ])("%s", expectOptions);

    test("a `socket` that is not a string (postgres.js: a function) is not a path", () => {
      const { options } = new SQL({ adapter: "postgres", hostname: "dbhost", socket: () => null } as never);
      expect(options.hostname).toBe("dbhost");
      expect(options.path).toBeUndefined();
    });

    test.each(adapters)("%s: the environment variable wins over the database of a URL", adapter => {
      process.env[adapter === "postgres" ? "PGDATABASE" : `${adapter.toUpperCase()}_DATABASE`] = "envdb";
      expect(new SQL(`${adapter}://user@dbhost/urldb`).options.database).toBe("envdb");
      expect(new SQL(`${adapter}://user@dbhost`).options.database).toBe("envdb");
      expect(new SQL(`${adapter}://user@dbhost/urldb`, { database: "optdb" }).options.database).toBe("optdb");
    });

    test.each(adapters)("%s: the pathname of a unix:// URL is the socket, not the database", adapter => {
      process.env[adapter === "postgres" ? "PGDATABASE" : `${adapter.toUpperCase()}_DATABASE`] = "envdb";
      expect(new SQL("unix:///run/db.sock", { adapter }).options).toMatchObject({
        adapter,
        path: "/run/db.sock",
        hostname: "localhost",
        database: "envdb",
      });
    });

    test.skipIf(isWindows).each(adapters)(
      "%s: the pathname of any other URL is the database, whatever is on the disk",
      adapter => {
        using dir = tempDir("sql-url-pathname", { placeholder: "" });
        const { options } = new SQL(`${adapter}://${dir}`);
        expect(options).toMatchObject({ adapter, hostname: "localhost", database: String(dir).slice(1) });
        expect(options.path).toBeUndefined();
      },
    );

    test("postgres: a directory gets the name of the socket file, with the resolved port", () => {
      using dir = tempDir("sql-pg-socket-dir", { "custom.sock": "" });
      expect(new SQL({ path: String(dir) }).options.path).toBe(`${dir}/.s.PGSQL.5432`);
      expect(new SQL({ path: String(dir), port: 5433 }).options.path).toBe(`${dir}/.s.PGSQL.5433`);
      expect(new SQL(`postgres://dbhost:5434/db?path=${dir}`).options.path).toBe(`${dir}/.s.PGSQL.5434`);
      expect(new SQL({ path: `${dir}/custom.sock` }).options.path).toBe(`${dir}/custom.sock`);
      expect(new SQL({ adapter: "mysql", path: String(dir) }).options.path).toBe(String(dir));
    });

    const pgSocket = { adapter: "postgres", hostname: "localhost", path: "/run/pg/.s.PGSQL.5433" };
    test.each<Row>([
      ["hostname", {}, [{ hostname: "/run/pg", port: 5433 }], pgSocket],
      ["host", {}, [{ host: "/run/pg", port: 5433 }], pgSocket],
      ["PGHOST", { PGHOST: "/run/pg" }, [{ port: 5433 }], pgSocket],
      ["?host=", {}, ["postgres:///db?host=/run/pg&port=5433"], { ...pgSocket, database: "db", query: "" }],
      ["a %2F host", {}, ["postgres://%2Frun%2Fpg:5433/db"], { ...pgSocket, database: "db" }],
      ["the socket file itself", {}, [{ hostname: "/run/pg/.s.PGSQL.5433" }], pgSocket],
      [
        "mysql",
        {},
        [{ adapter: "mysql", hostname: "/run/mysqld.sock" }],
        { hostname: "localhost", path: "/run/mysqld.sock" },
      ],
    ])("a host that starts with / is the socket (%s)", expectOptions);

    test.each<Row>([
      [
        "postgres://user:pw@/db?host=/cloudsql/p:r:i",
        {},
        [],
        { username: "user", password: "pw", database: "db", path: "/cloudsql/p:r:i/.s.PGSQL.5432", query: "" },
      ],
      ["postgres://user:pw@/db", { PGHOST: "envhost" }, [], { username: "user", password: "pw", hostname: "envhost" }],
      ["postgres://user@:5433/db", {}, [], { username: "user", hostname: "localhost", port: 5433, database: "db" }],
      [
        "mysql://user:pass@/database?socket=/var/run/mysqld/mysqld.sock",
        {},
        [],
        {
          adapter: "mysql",
          username: "user",
          password: "pass",
          database: "database",
          path: "/var/run/mysqld/mysqld.sock",
        },
      ],
    ])("credentials without a host: %s", (url, env, _, expected) => {
      expectOptions(url, env, [url], expected);
    });

    test("a URL that is invalid for another reason still throws", () => {
      expect(() => new SQL("postgres://user@:port/db")).toThrow(expect.objectContaining({ code: "ERR_INVALID_URL" }));
      expect(() => new SQL("postgres://h1:1,h2:2/db")).toThrow(expect.objectContaining({ code: "ERR_INVALID_URL" }));
    });

    test.each<Row>([
      ["ssl: 'require'", {}, [{ path: "/run/pg.sock", ssl: "require" }], {}],
      ["tls: { ca }", {}, [{ path: "/run/pg.sock", tls: { ca: "x" } }], {}],
      ["?sslmode=verify-full", {}, ["postgres://h/d?sslmode=verify-full&path=/run/pg.sock"], {}],
      ["PGSSLMODE=verify-full", { PGSSLMODE: "verify-full" }, [{ hostname: "/run/pg" }], {}],
    ])("postgres does not negotiate TLS on a unix socket (%s)", (title, env, args) => {
      expectOptions(title, env, args, { adapter: "postgres", sslMode: 0 });
      expect(new SQL(...(args as [string])).options.tls).toBeUndefined();
    });

    test("mysql keeps the SSL mode on a unix socket", () => {
      expect(new SQL({ adapter: "mysql", path: "/run/mysqld.sock", ssl: "require" }).options.sslMode).toBe(2);
    });
  });

  describe("certificate verification", () => {
    test.each(["postgres", "mysql"] as const)(
      "%s: rejectUnauthorized is what the option says, so that without it NODE_TLS_REJECT_UNAUTHORIZED is asked",
      adapter => {
        const tlsOf = (options: SQL.Options) => new SQL({ adapter, hostname: "h", ...options } as SQL.Options).options;
        for (const options of [
          { ssl: "verify-ca" },
          { ssl: "verify-full" },
          { tls: { ca: "x" } },
          { ssl: "verify-full", tls: {} },
          { ssl: "prefer" },
          { ssl: "require" },
          { tls: true },
          { tls: {} },
        ] as SQL.Options[]) {
          expect(tlsOf(options).tls).not.toHaveProperty("rejectUnauthorized");
        }
        expect(tlsOf({ tls: { rejectUnauthorized: true } })).toMatchObject({
          sslMode: 4,
          tls: { rejectUnauthorized: true },
        });
        expect(tlsOf({ ssl: "verify-full", tls: { rejectUnauthorized: false } })).toMatchObject({
          sslMode: 4,
          tls: { rejectUnauthorized: false },
        });
      },
    );

    test("the caller's tls object is not written to", () => {
      const tls = { ca: "x" };
      new SQL({ hostname: "h", tls });
      expect(tls).toEqual({ ca: "x" });
    });

    test("tls.checkServerIdentity asks for verification, like tls.ca", () => {
      const checkServerIdentity = () => undefined;
      const tlsOf = (tls: object, url = "postgres://h/d") => new SQL(url, { tls } as SQL.Options).options;

      expect(tlsOf({ checkServerIdentity })).toMatchObject({
        sslMode: 4,
        tls: { checkServerIdentity, serverName: "h" },
      });
      expect(tlsOf({ checkServerIdentity }, "mysql://h/d").sslMode).toBe(4);
      expect(tlsOf({ checkServerIdentity }, "postgres://h/d?sslmode=verify-ca").sslMode).toBe(3);
      expect(tlsOf({ checkServerIdentity, rejectUnauthorized: false }).sslMode).toBe(2);
      expect(() => tlsOf({ checkServerIdentity: "localhost" })).toThrow(
        expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" }),
      );
    });
  });
});
