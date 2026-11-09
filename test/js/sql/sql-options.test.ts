// Where the server is: adapter-env-var-precedence.test.ts. Which file is opened: sqlite-url-parsing.test.ts.
import { SQL } from "bun";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import assert from "node:assert";
import path from "node:path";
import util from "node:util";
import {
  closedPort,
  listeningServer,
  pgCommandComplete,
  pgCopyData,
  pgCopyDone,
  pgCopyOutResponse,
  pgDataRow,
  pgErrorResponse,
  pgMockServer,
  pgReadyForQuery,
  pgRowDescription,
} from "./wire-frames";

const SQL_VARIABLE = /^(PG|POSTGRES_|MYSQL|MARIADB|SQLITE|TLS_|DATABASE_?URL$)/;
const originalEnv = { ...process.env };
beforeEach(() => {
  for (const name in process.env) if (SQL_VARIABLE.test(name)) delete process.env[name];
});
afterEach(() => {
  for (const name in process.env) if (SQL_VARIABLE.test(name)) delete process.env[name];
  for (const name in originalEnv) if (SQL_VARIABLE.test(name)) process.env[name] = originalEnv[name];
});

// `sql.options` also has what the public types leave out: `query`, `sslMode`.
const optionsOf = (...args: unknown[]) => new SQL(...(args as [string])).options as Record<string, any>;

const startup = (parameters: Record<string, string>) =>
  Object.entries(parameters)
    .map(([key, value]) => `${key}\0${value}\0`)
    .join("");

describe("the query of a postgres:// URL", () => {
  test.each<[string, Record<string, unknown>]>([
    ["connect_timeout=7", { connectionTimeout: 7000 }],
    ["idle_timeout=3", { idleTimeout: 3000 }],
    ["max_lifetime=60", { maxLifetime: 60000 }],
    ["max=3", { max: 3 }],
    ["prepare=false", { prepare: false }],
    ["prepare=0", { prepare: false }],
    ["prepare=true", { prepare: true }],
    [
      "host=qh&port=99&user=qu&password=qp&dbname=qd",
      { hostname: "qh", port: 99, username: "qu", password: "qp", database: "qd" },
    ],
    ["channel_binding=require", { channelBinding: "require" }],
    ["sslmode=require&channel_binding=require", { sslMode: 2, channelBinding: "require" }],
    ["sslrootcert=/x/ca.pem", { sslMode: 4, tls: { caFile: "/x/ca.pem", serverName: "uh" } }],
    [
      "sslmode=verify-ca&sslrootcert=/x/ca.pem&sslcert=/x/c.pem&sslkey=/x/k.pem&sslpassword=s",
      { sslMode: 3, tls: { caFile: "/x/ca.pem", certFile: "/x/c.pem", keyFile: "/x/k.pem", passphrase: "s" } },
    ],
    ["sslcert=/x/c.pem&sslkey=/x/k.pem", { sslMode: 2, tls: { certFile: "/x/c.pem", keyFile: "/x/k.pem" } }],
    ["sslrootcert=system", { sslMode: 4, tls: { rejectUnauthorized: true } }],
    ["sslmode=require&sslrootcert=system", { sslMode: 4 }],
    [
      "keepalives=1&keepalives_idle=5&keepalives_interval=5&keepalives_count=3&tcp_user_timeout=1000" +
        "&target_session_attrs=read-write&load_balance_hosts=random&fallback_application_name=x" +
        "&sslnegotiation=postgres&sslcompression=0&gssencmode=disable",
      { hostname: "uh", sslMode: 0 },
    ],
  ])("?%s is for the client and is not sent to the server", (query, expected) => {
    expect(optionsOf(`postgres://uu:up@uh:1/ud?${query}`)).toMatchObject({ ...expected, query: "" });
  });

  test("a key without a value is not given", () => {
    const { options } = new SQL("postgres://uu@uh/ud?connect_timeout=&max=&host=&sslrootcert=&channel_binding=");
    expect(options).toMatchObject({ hostname: "uh", max: 10, sslMode: 0, channelBinding: "disable", query: "" });
    expect(options.connectionTimeout).toBeUndefined();
    expect(options.tls).toBeUndefined();
  });

  test("every other key is a startup parameter", () => {
    const parameters = { application_name: "app", search_path: "a,b", options: "-c geqo=off", client_encoding: "UTF8" };
    expect(optionsOf(`postgres://uh/ud?${new URLSearchParams(parameters)}`).query).toBe(startup(parameters));
  });

  test.each([
    "require_auth=scram-sha-256",
    "gssencmode=require",
    "requirepeer=postgres",
    "sslcrl=/x/crl.pem",
    "sslcertmode=require",
    "ssl_min_protocol_version=TLSv1.3",
    "hostaddr=10.0.0.1",
    "service=prod",
  ])("?%s restricts the connection in a way Bun cannot, and is not dropped", query => {
    expect(optionsOf(`postgres://uh/ud?${query}`).query).toBe(query.replace("=", "\0") + "\0");
  });

  test("an option is above the query, the query is above the environment", () => {
    process.env.PGCONNECT_TIMEOUT = "9";
    expect(optionsOf("postgres://uh/ud").connectionTimeout).toBe(9000);

    const url =
      "postgres://uh/ud?connect_timeout=7&idle_timeout=7&max_lifetime=7&max=7&prepare=false&sslrootcert=/url.pem";
    expect(optionsOf(url).connectionTimeout).toBe(7000);
    expect(
      optionsOf(url, {
        connectionTimeout: 0,
        idleTimeout: 1,
        maxLifetime: 1,
        max: 1,
        prepare: true,
        tls: { caFile: "/option.pem" },
      }),
    ).toMatchObject({
      connectionTimeout: 0,
      idleTimeout: 1000,
      maxLifetime: 1000,
      max: 1,
      prepare: true,
      tls: { caFile: "/option.pem" },
    });
  });

  test.each<[SQL.Options, number, unknown]>([
    [{ tls: false }, 0, undefined],
    [{ tls: "disable" }, 0, undefined],
    [{ tls: "verify-ca" }, 3, expect.objectContaining({ caFile: "/url.pem" })],
    [{ tls: true }, 4, expect.objectContaining({ caFile: "/url.pem" })],
    [{ tls: { rejectUnauthorized: false } }, 2, expect.objectContaining({ caFile: "/url.pem" })],
  ])("?sslrootcert= next to %j", (options, sslMode, tls) => {
    expect(optionsOf("postgres://uh/ud?sslrootcert=/url.pem", options)).toMatchObject({ sslMode, tls });
  });

  test("invalid values throw as the options do", () => {
    for (const query of ["connect_timeout=-1", "idle_timeout=x", "max=0", "port=0", "channel_binding=bogus"]) {
      expect(() => new SQL(`postgres://uh/ud?${query}`)).toThrow(
        expect.objectContaining({ code: "ERR_INVALID_ARG_VALUE" }),
      );
    }
  });

  test("startup parameters: `connection` is above the URL, the URL is above PGAPPNAME and PGOPTIONS", () => {
    Object.assign(process.env, { PGAPPNAME: "env", PGOPTIONS: "-c geqo=off" });
    const query = (...args: unknown[]) => optionsOf(...args).query;

    expect(query("postgres://uh/ud")).toBe(startup({ application_name: "env", options: "-c geqo=off" }));
    expect(query({ hostname: "uh" })).toBe(startup({ application_name: "env", options: "-c geqo=off" }));
    expect(query("postgres://uh/ud?application_name=url")).toBe(
      startup({ application_name: "url", options: "-c geqo=off" }),
    );
    expect(query("postgres://uh/ud?application_name=url", { connection: { application_name: "option", a: 1 } })).toBe(
      startup({ application_name: "option", options: "-c geqo=off", a: "1" }),
    );
    expect(query("mysql://uh/ud")).toBe("");
  });
});

describe.each(["mysql", "mariadb"] as const)("the query of a %s:// URL", adapter => {
  test("Bun's own options are read, libpq's keywords are not", () => {
    expect(
      optionsOf(`${adapter}://uu:up@uh:1/ud?connect_timeout=7&idle_timeout=3&max_lifetime=60&max=3`),
    ).toMatchObject({ connectionTimeout: 7000, idleTimeout: 3000, maxLifetime: 60000, max: 3 });
    expect(optionsOf(`${adapter}://uu:up@uh:1/ud?host=qh&port=99&user=qu&password=qp&dbname=qd`)).toMatchObject({
      hostname: "uh",
      port: 1,
      username: "uu",
      password: "up",
      database: "ud",
    });
  });

  test("foundRows", () => {
    const foundRows = (...args: unknown[]) => optionsOf(...args).foundRows;
    expect(foundRows({ adapter })).toBe(false);
    expect(foundRows({ adapter, foundRows: true })).toBe(true);
    expect(foundRows({ adapter, foundRows: undefined })).toBe(false);
    expect(foundRows(`${adapter}://uh/ud?foundRows=true`)).toBe(true);
    expect(foundRows(`${adapter}://uh/ud?foundRows=1`)).toBe(true);
    expect(foundRows(`${adapter}://uh/ud?foundRows=false`)).toBe(false);
    expect(foundRows(`${adapter}://uh/ud?foundRows=true`, { foundRows: false })).toBe(false);
    expect(optionsOf(`${adapter}://uh/ud?foundRows=true`).query).toBe("");
  });

  test("prepare: false: the mysql adapter refuses the option, and nothing else reads it", () => {
    if (adapter === "mysql") {
      expect(() => new SQL({ adapter, prepare: false })).toThrow(
        expect.objectContaining({ code: "ERR_INVALID_ARG_VALUE" }),
      );
    } else {
      expect(optionsOf({ adapter, prepare: false }).prepare).toBe(false);
    }
    expect(optionsOf(`${adapter}://uh/ud?prepare=false`).prepare).toBe(true);
    expect(optionsOf({ adapter, prepare: true }).prepare).toBe(true);
  });
});

describe("channelBinding", () => {
  const channelBinding = (...args: unknown[]) => optionsOf(...args).channelBinding;

  test("option > URL > PGCHANNELBINDING > disable", () => {
    expect(channelBinding("postgres://uh/ud")).toBe("disable");
    process.env.PGCHANNELBINDING = "prefer";
    expect(channelBinding("postgres://uh/ud")).toBe("prefer");
    expect(channelBinding("postgres://uh/ud?channel_binding=require")).toBe("require");
    expect(channelBinding("postgres://uh/ud?channel_binding=require", { channelBinding: "prefer" })).toBe("prefer");
    expect(channelBinding("mysql://uh/ud")).toBe("disable");
  });

  test("any other value throws", () => {
    const invalid = expect.objectContaining({
      code: "ERR_INVALID_ARG_VALUE",
      message: expect.stringContaining("must be one of: disable, prefer, require"),
    });
    expect(() => channelBinding({ channelBinding: "required" })).toThrow(invalid);
    expect(() => channelBinding({ channelBinding: true })).toThrow(invalid);
    expect(() => channelBinding("postgres://uh/ud?channel_binding=Require")).toThrow(invalid);
    expect(() => channelBinding("mysql://uh/ud?channel_binding=bogus")).toThrow(invalid);
    process.env.PGCHANNELBINDING = "bogus";
    expect(() => channelBinding("postgres://uh/ud")).toThrow(invalid);
  });

  describe.each(["mysql", "mariadb", "sqlite"])("%s has none", adapter => {
    const url = adapter === "sqlite" ? "sqlite://:memory:" : `${adapter}://uh/ud`;

    test.each<[string, unknown[]]>([
      ["the options", [{ adapter, channelBinding: "require" }]],
      ["the URL", [`${url}?channel_binding=require`]],
      ["the options next to a URL", [url, { channelBinding: "require" }]],
    ])('"require" in %s throws', (_, args) => {
      expect(() => optionsOf(...args)).toThrow(
        expect.objectContaining({
          name: "TypeError",
          code: "ERR_INVALID_ARG_VALUE",
          message: `The argument 'channelBinding' is not supported by the ${adapter} adapter: channel binding is a PostgreSQL feature. Received 'require'`,
        }),
      );
    });

    test.each(["prefer", "disable"])('"%s" asks for nothing and is accepted', value => {
      expect(channelBinding({ adapter, channelBinding: value })).toBe(value);
      // SQLite keeps no option that only its URL names
      expect(channelBinding(`${url}?channel_binding=${value}`)).toBe(adapter === "sqlite" ? undefined : value);
      expect(channelBinding(`${url}?channel_binding=require`, { channelBinding: value })).toBe(value);
    });

    test("PGCHANNELBINDING is not read", () => {
      process.env.PGCHANNELBINDING = "require";
      expect(channelBinding(url)).toBe(adapter === "sqlite" ? undefined : "disable");
    });
  });
});

describe("what the options object inherits", () => {
  const inheriting = (inherited: object, own: object = {}) => Object.assign(Object.create(inherited), own);
  const servers = ["postgres", "mysql", "mariadb"] as const;
  const fields = { hostname: "ih", port: 7, username: "iu", password: "ip", database: "id", max: 3 };

  describe.each(servers)("%s", adapter => {
    const url = `${adapter}://uu@uh/ud`;

    // An options object that stands alone behind a URL, or behind nothing, and `adapter` in it.
    test.each<[string, object, number]>([
      ["tls: true", { tls: true }, 2],
      ['ssl: "verify-full"', { ssl: "verify-full" }, 4],
      ["tls: { ca }", { tls: { ca: "x" } }, 4],
      ["tls: false", { tls: false }, 0],
    ])("%s counts behind a URL and behind nothing", (_, inherited, sslMode) => {
      const query = sslMode === 0 ? "?sslmode=require" : "";
      expect(optionsOf(url + query, inheriting(inherited, { adapter })).sslMode).toBe(sslMode);
      expect(optionsOf(new URL(url + query), inheriting(inherited, { adapter })).sslMode).toBe(sslMode);
      expect(optionsOf(undefined, inheriting(inherited, { adapter, url: url + query })).sslMode).toBe(sslMode);
      expect(optionsOf(url + query, inheriting({ ...inherited, adapter })).sslMode).toBe(sslMode);
    });

    test("a getter on the class counts", () => {
      class Config {
        adapter = adapter;
        get tls() {
          return true;
        }
        get password() {
          return "secret";
        }
      }
      expect(optionsOf(url, new Config())).toMatchObject({ sslMode: 2, password: "secret" });
    });

    test("hostname, port, username, password, database and max count", () => {
      expect(optionsOf(url, inheriting(fields, { adapter }))).toMatchObject(fields);
      expect(optionsOf(undefined, inheriting(fields, { adapter }))).toMatchObject(fields);
    });

    test("an own key hides the inherited one, undefined too", () => {
      expect(
        optionsOf(url, inheriting({ tls: true, password: "ip" }, { adapter, tls: undefined, password: "op" })),
      ).toMatchObject({ sslMode: 0, password: "op" });
    });

    test("nothing but adapter, filename and url counts where only the scheme gives the adapter", () => {
      const fromUrl = { hostname: "uh", username: "uu", password: "", database: "ud", max: 10 };
      expect(optionsOf(url, inheriting({ ...fields, tls: true }))).toMatchObject({ ...fromUrl, sslMode: 0 });
      expect(optionsOf(new URL(url), inheriting({ ...fields, tls: true }))).toMatchObject({ ...fromUrl, sslMode: 0 });
      expect(optionsOf(`${url}?sslmode=require`, inheriting({ tls: false })).sslMode).toBe(2);
      expect(optionsOf(undefined, inheriting({ ...fields, tls: true, url }))).toMatchObject({ ...fromUrl, sslMode: 0 });
    });

    test("nothing counts in the first argument", () => {
      expect(optionsOf(inheriting({ ...fields, tls: true }, { adapter, url }))).toMatchObject({
        hostname: "uh",
        username: "uu",
        password: "",
        database: "ud",
        max: 10,
        sslMode: 0,
      });
      expect(optionsOf(inheriting({ adapter: "sqlite" }, { url })).adapter).toBe(adapter);
      expect(optionsOf({ adapter, url }, inheriting({ tls: true })).sslMode).toBe(0);
    });
  });

  test("the name of a variable gives the adapter as `adapter` does, the scheme of its URL does not", () => {
    process.env.POSTGRES_URL = "postgres://eu@eh/ed";
    expect(optionsOf(undefined, inheriting({ tls: true, password: "ip" }))).toMatchObject({
      hostname: "eh",
      password: "ip",
      sslMode: 2,
    });
    delete process.env.POSTGRES_URL;
    process.env.DATABASE_URL = "postgres://eu@eh/ed";
    expect(optionsOf(undefined, inheriting({ tls: true, password: "ip" }))).toMatchObject({
      hostname: "eh",
      password: "",
      sslMode: 0,
    });
  });

  test("adapter, filename and url", () => {
    expect(optionsOf("uh/ud", inheriting({ adapter: "mysql" }))).toMatchObject({ adapter: "mysql", hostname: "uh" });
    expect(optionsOf(undefined, inheriting({ adapter: "mysql" })).adapter).toBe("mysql");
    expect(optionsOf(undefined, inheriting({ url: "mysql://uh/ud" }))).toMatchObject({
      adapter: "mysql",
      hostname: "uh",
    });
    expect(optionsOf(undefined, inheriting({ adapter: "sqlite", filename: ":memory:" }))).toMatchObject({
      adapter: "sqlite",
      filename: ":memory:",
    });
  });

  // [environment, the inherited key, the own keys, what both spellings give]
  test.each<[Record<string, string>, object, object, object]>([
    [{ DATABASE_URL: "x" }, { hostname: "h" }, { adapter: "mysql" }, { hostname: "h", port: 7 }],
    [{ DATABASE_URL: "x" }, { host: "h" }, { adapter: "mysql" }, { hostname: "h", port: 7 }],
    [{ DATABASE_URL: "x" }, { path: "/run/x.sock" }, { adapter: "mysql" }, { path: "/run/x.sock" }],
    [{ DATABASE_URL: "x" }, { socket: "/run/x.sock" }, { adapter: "mysql" }, { path: "/run/x.sock" }],
    [{ POSTGRES_URL: "x" }, { hostname: "h" }, {}, { hostname: "h", port: 7 }],
  ])("%j fills in what an inherited %j leaves out, as next to an own one", (env, key, own, expected) => {
    for (const name in env) process.env[name] = "postgres://eu:ep@eh:7/ed?sslmode=require";
    const resolved = { ...expected, username: "eu", password: "ep", database: "ed", sslMode: 2 };
    expect(optionsOf(undefined, { ...key, ...own })).toMatchObject(resolved);
    expect(optionsOf(undefined, inheriting(key, own))).toMatchObject(resolved);
  });

  test.each([
    ["postgres://uu@uh/ud", { adapter: "postgres" }],
    ["mysql://uu@uh/ud", { adapter: "mysql" }],
    [":memory:", { adapter: "sqlite" }],
    ["postgres://uu@uh/ud", {}],
    ["sqlite://:memory:", {}],
    [undefined, { adapter: "postgres" }],
  ])("new SQL(%j, %j) reads every key once and writes none", async (first, own) => {
    const reads: string[] = [];
    const writes: PropertyKey[] = [];
    const logged = new Proxy(own, {
      get(target, key, receiver) {
        if (typeof key === "string") reads.push(key);
        return Reflect.get(target, key, receiver);
      },
      has(target, key) {
        if (typeof key === "string") reads.push(key);
        return Reflect.has(target, key);
      },
      set(_, key) {
        writes.push(key);
        return false;
      },
      defineProperty(_, key) {
        writes.push(key);
        return false;
      },
    });
    await using sql = new SQL(first as string, logged);
    expect(sql.options.adapter).toBeString();
    expect(reads).toEqual([...new Set(reads)]);
    expect(reads.slice(0, 3).toSorted()).toEqual(["adapter", "filename", "url"]);
    expect(writes).toEqual([]);
  });
});

describe("the error for a connection URL that cannot be parsed", () => {
  const marker = "Hunter2Marker";

  /** All that a program, a log or the print of an uncaught error can show of it, in lower case. */
  function everythingIn(error: any): string {
    const parts: unknown[] = [];
    for (let e = error; e != null && parts.length < 100; e = e.cause) {
      parts.push(String(e), e.message, e.stack, Bun.inspect(e), util.inspect(e), JSON.stringify(e));
      for (const key of Reflect.ownKeys(Object(e))) parts.push(Bun.inspect(e[key]));
    }
    return parts.join("\n").toLowerCase();
  }
  function errorOf(make: () => unknown): any {
    try {
      make();
    } catch (error) {
      return error;
    }
  }

  const adapters = [
    ["postgres", "POSTGRES_URL"],
    ["mysql", "MYSQL_URL"],
    ["mariadb", "MARIADB_URL"],
  ] as const;

  /** Every way a connection string gets to the parser. `rest` is what stands behind the scheme. */
  function waysIn(adapter: (typeof adapters)[number][0], variable: string, rest: string): (() => unknown)[] {
    const url = `${adapter}://${rest}`;
    const fromEnvironment = (name: string, options?: object) => {
      process.env[name] = url;
      try {
        return new SQL(options as never);
      } finally {
        delete process.env[name];
      }
    };
    return [
      () => new SQL(url),
      () => new SQL(url, { adapter }),
      () => new SQL(rest, { adapter }),
      () => new SQL({ url }),
      () => new SQL({ adapter, url: rest }),
      () => fromEnvironment("DATABASE_URL"),
      () => fromEnvironment("TLS_DATABASE_URL", { max: 1 }),
      () => fromEnvironment(variable),
      () => fromEnvironment("DATABASE_URL", { hostname: "other.example" }),
    ];
  }

  // [what is in the way, the URL behind its scheme]
  const urls: [string, string][] = [
    ["a port that is none", `user:${marker}@db.example:port/db`],
    ["a port that is too high", `user:${marker}@db.example:99999/db`],
    ["a space in the host", `user:${marker}@db example/db`],
    ["a / in the password", `user:ab/${marker}@db.example:5432/db`],
    ["a # in the password", `user:ab#${marker}@db.example:5432/db`],
    ["a ? in the password", `user:ab?${marker}@db.example:5432/db`],
    ["an @ in the password", `user:ab@${marker}@db.example:port/db`],
    ["an @ in the password and no host", `user:ab@${marker}^`],
    ["a space in the password", `user:ab ${marker}@db.example:port/db`],
    ["a % in the password", `user:ab%${marker}@db.example:port/db`],
    ["?password=", `user@db.example:port/db?password=${marker}`],
    ["?sslpassword=", `user@db.example:port/db?sslpassword=${marker}`],
    ["an @ in ?password=", `db example/db?password=ab@${marker}`],
    ["an @ in ?sslpassword=", `user:ab@db.example:port/db?sslpassword=ab@${marker}`],
    ["& in place of ?", `user@db.example:port/db&password=${marker}`],
    ["a fragment", `user@db.example:port/db#${marker}`],
    ["an @ in the fragment", `db example/db#ab@${marker}`],
    ["?password= and no user", `db.example:port/db?password=${marker}`],
    ["no @ behind the password", `user:${marker}%40db.example/db`],
    ["nothing behind the password", `user:${marker}`],
    ["nothing in front of the password", `:${marker}`],
    ["only a database behind the password", `:${marker}/db`],
    ["keywords and values", `host=db.example user=user password=${marker} dbname=db`],
    ["keywords and values, an @ in the password", `host=db.example user=user password=ab@${marker} dbname=db`],
    ["no user and no password", "db example/db"],
  ];

  describe.each(adapters)("%s", (adapter, variable) => {
    test.each(urls)("%s", (_, rest) => {
      for (const make of waysIn(adapter, variable, rest)) {
        const error = errorOf(make);
        expect(error).toBeInstanceOf(TypeError);
        expect({ ...error, name: error.name, message: error.message, cause: error.cause }).toEqual({
          name: "TypeError",
          message: "Invalid URL",
          code: "ERR_INVALID_URL",
          input: `${adapter}://[REDACTED]`,
          cause: undefined,
        });
        expect(everythingIn(error)).not.toContain(marker.toLowerCase());
      }
    });
  });

  // "~" is the secret and "HOST" a host that cannot be parsed.
  test.each([
    "user:~@HOST/db",
    "~@HOST/db",
    ":~@HOST/db",
    "user:~",
    ":~/db",
    "HOST/db?password=~",
    "user:ab@HOST/db?sslpassword=~&a=b",
    "HOST/db#~",
    "HOST/~",
    "HOST/db&password=~",
    "host=HOST user=user password=~ dbname=db",
  ])("%s, with every separator in and around ~", position => {
    // In two words, so that a part of it is seen as well.
    const words = [marker.toLowerCase(), "zebra9marker"];
    let turn = 0;
    let errors = 0;
    for (const host of position.includes("HOST") ? ["db.example:port", "db example", "[::1"] : [""]) {
      for (const separator of "@/?#:% []") {
        for (const secret of [separator + words[0], words.join(separator), words[0] + separator]) {
          // Each in one of the 27 ways, in turn.
          const [adapter, variable] = adapters[Math.floor(turn / 9) % adapters.length];
          const ways = waysIn(adapter, variable, position.replace("HOST", host).replace("~", secret));
          const error = errorOf(ways[turn++ % ways.length]);
          // "user:?" is a host and an empty port.
          if (!error) continue;
          errors++;
          const everything = everythingIn(error);
          for (const word of words) expect(everything).not.toContain(word);
        }
      }
    }
    expect(errors).toBeGreaterThan(0);
  });

  test("is the error of new URL() in all but the input", () => {
    const expected = errorOf(() => new URL("http://a b"));
    const error = errorOf(() => new SQL("postgres://a b"));
    expect(String(error)).toBe(String(expected));
    expect(Object.keys(error)).toEqual(Object.keys(expected));
    expect(JSON.stringify(error)).toBe(JSON.stringify({ ...expected, input: "postgres://[REDACTED]" }));
    expect(Object.getPrototypeOf(error)).toBe(Object.getPrototypeOf(expected));
  });

  // [what the error names, the adapter, the URL]
  test.each([
    ["sqlite://[REDACTED]", "postgres", `sqlite://user:${marker}@db example/db`],
    ["sqlite://[REDACTED]", "mysql", `sqlite://user:ab/${marker}@db.example/db`],
    ["postgres://[REDACTED]", "mariadb", `postgres://user:${marker}@db.example:port/sqlite?password=${marker}`],
    ["postgres://[REDACTED]", "postgres", `postgres://db example/sqlite?password=ab@${marker}`],
    ["sqlite://:memory:", "postgres", "sqlite://:memory:"],
    ["sqlite://:memory:", "mysql", `sqlite://:memory:?mode=ro#${marker}`],
  ] as const)("the hint at the sqlite adapter names %s", (named, adapter, url) => {
    const error = errorOf(() => new SQL(url, { adapter }));
    expect(error.message).toBe(
      `Invalid URL '${named}' for ${adapter}. Did you mean to specify \`{ adapter: "sqlite" }\`?`,
    );
    expect(error.cause).toBeUndefined();
    expect(everythingIn(error)).not.toContain(marker.toLowerCase());
  });

  // [what is in front of the `://`, what the error names, the URL]
  test.each([
    [
      "a user, a password, a host and a query",
      "[REDACTED]",
      `user:${marker}@db.example/db?redirect=https://example.com`,
    ],
    ["a user and a part of the password", "[REDACTED]", `user:${marker}://x@db.example/db`],
    ["a user, a host and a query", "[REDACTED]", `${marker}@db.example/db?redirect=https://example.com`],
    ["a scheme", "mongodb", `mongodb://user:${marker}@db.example/db`],
  ])("a protocol that is not supported: %s", (_, named, url) => {
    for (const error of [errorOf(() => new SQL(url)), errorOf(() => new SQL({ url }))]) {
      expect(error.message).toBe(
        `Unsupported protocol: ${named}. Supported adapters: "postgres", "sqlite", "mysql", "mariadb"`,
      );
      expect(everythingIn(error)).not.toContain(marker.toLowerCase());
    }
  });

  test.each<[string, unknown[]]>([
    ["options.password", [`mysql://user@db.example/db?password=${marker}%00`]],
    ["options.sslpassword", [`mariadb://user@db.example/db?sslpassword=${marker}%00`]],
    ["options.anything", [`postgres://user@db.example/db?anything=${marker}%00`]],
    ["options.connection.password", ["postgres://user@db.example/db", { connection: { password: `${marker}\0` } }]],
  ])("a NUL in the startup parameter %s", (name, args) => {
    const error = errorOf(() => new SQL(...(args as [string])));
    expect(error).toMatchObject({
      code: "ERR_INVALID_ARG_VALUE",
      message: `The property '${name}' must not contain null bytes. Received '[REDACTED]'`,
    });
    expect(everythingIn(error)).not.toContain(marker.toLowerCase());
  });

  test("when nothing catches it", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", "new Bun.SQL();"],
      env: { ...bunEnv, DATABASE_URL: `postgres://user:ab/${marker}@db.example:5432/db?password=${marker}` },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout).toBe("");
    expect(stderr).toContain("ERR_INVALID_URL");
    expect(stderr).toContain('input: "postgres://[REDACTED]"');
    expect(stderr.toLowerCase()).not.toContain(marker.toLowerCase());
    expect(exitCode).toBe(1);
  });
});

test("options.connection also gives what it inherits", () => {
  expect(optionsOf("postgres://db.example/app", { connection: Object.create({ search_path: "s" }) }).query).toBe(
    "search_path\0s\0",
  );
});

test("the traps of a Proxy are asked for no more than the options", () => {
  const asked: string[] = [];
  const trap = (name: string) => () => {
    asked.push(name);
    throw new Error(name);
  };
  const options = new Proxy({}, { getPrototypeOf: trap("getPrototypeOf"), getOwnPropertyDescriptor: trap("own") });
  expect(optionsOf("postgres://db.example/app", Object.create(options)).hostname).toBe("db.example");
  expect(asked).toEqual([]);
});

test.each(["postgres", "mysql", "sqlite"])("%s: what is on Object.prototype is not an option", async adapter => {
  using dir = tempDir("sql-options-prototype", {});
  const socket = path.join(String(dir), "evil.sock");
  const nobodyListens = await closedPort();
  // The pool reads the parsed options again for every connection.
  const dial =
    adapter === "sqlite" || isWindows
      ? ""
      : `
    using listener = Bun.listen({
      unix: ${JSON.stringify(socket)},
      socket: {
        open() {
          console.log("dialed the path of Object.prototype");
          process.exit(1);
        },
        data() {},
      },
    });
    await new Bun.SQL("${adapter}://user:secret@127.0.0.1:${nobodyListens}/app", { max: 1 }).unsafe("select 1").catch(() => {});

    // A server that is still starting is dialed again, for as long as the connection timeout says.
    let dials = 0;
    const third = Promise.withResolvers();
    using starting = Bun.listen({
      hostname: "127.0.0.1",
      port: 0,
      socket: {
        open(socket) {
          if (++dials === 3) third.resolve("dials again");
          socket.end();
        },
        data() {},
      },
    });
    const patient = new Bun.SQL("${adapter}://user:secret@127.0.0.1:" + starting.port + "/app", { max: 1 });
    console.log(await Promise.race([third.promise, patient.unsafe("select 1").catch(error => "gave up: " + error.code)]));
    await patient.close({ timeout: 0 });`;
  const src = `
    const args = {
      postgres: ["postgres://user:secret@db.example:5433/app?sslmode=verify-full&sslrootcert=/ca.pem&application_name=a", { max: 2, connection: { search_path: "s" } }],
      mysql: ["mysql://user:secret@db.example:3307/app?ssl-mode=required", { max: 2 }],
      sqlite: ["sqlite://app.db?mode=ro", {}],
    }[${JSON.stringify(adapter)}];
    const observed = async () => {
      await using memory = new Bun.SQL(":memory:");
      const fromVariables = new Bun.SQL({ adapter: ${JSON.stringify(adapter)} }).options;
      const inherited = new Bun.SQL(args[0], Object.create({ adapter: ${JSON.stringify(adapter)}, username: "heir", readonly: true })).options;
      return JSON.stringify([new Bun.SQL(...args).options, fromVariables, inherited,
        new Bun.SQL(args[0], new Proxy({}, { getPrototypeOf: () => null })).options, await memory\`select \${undefined} as a_b\`]);
    };
    const clean = await observed();
    Object.assign(Object.prototype, {
      helper() {},
      adapter: "mysql",
      url: "postgres://evil.example/evil",
      filename: "evil.db",
      hostname: "evil.example",
      host: "evil.example",
      port: 1,
      path: ${JSON.stringify(socket)},
      username: "evil",
      password: "evil",
      database: "evil",
      tls: false,
      ssl: false,
      sslmode: "disable",
      rejectUnauthorized: false,
      readonly: false,
      create: true,
      connection: { evil: "1" },
      transform: { undefined: "evil", column: name => name.toUpperCase() },
      connectionTimeout: 30,
      onclose: 5,
      DATABASE_URL: "postgres://evil.example:1",
      MYSQL_URL: "mysql://evil.example:1",
      SQLITE_URL: "evil.db",
      PGOPTIONS: "-c search_path=evil",
    });
    const planted = await observed();
    console.log(planted === clean ? "the same" : planted + " <- " + clean);

    ${dial}
  `;
  const variables = { HOST: "db.example", USER: "user", PASSWORD: "secret", DATABASE: "app" };
  const prefix = adapter === "postgres" ? "PG" : "MYSQL_";
  const env = {
    ...bunEnv,
    ...Object.fromEntries(Object.entries(variables).map(([name, value]) => [prefix + name, value])),
  };
  await using proc = Bun.spawn({ cmd: [bunExe(), "-e", src], env, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout: stdout.trim(), stderr, exitCode }).toEqual({
    stdout: dial ? "the same\ndials again" : "the same",
    stderr: "",
    exitCode: 0,
  });
});

describe("inspecting sql.options", () => {
  const secret = "sekret-password";

  test.each<[string, () => InstanceType<typeof SQL>]>([
    ["postgres URL", () => new SQL(`postgres://app:${secret}@127.0.0.1:5432/db`)],
    ["mysql URL", () => new SQL(`mysql://app:${secret}@127.0.0.1:3306/db`)],
    ["options", () => new SQL({ adapter: "postgres", hostname: "127.0.0.1", username: "app", password: secret })],
    ["?password=", () => new SQL(`postgres://app@127.0.0.1/db?password=${secret}`)],
  ])("the password is not printed (%s)", (_, make) => {
    const sql = make();
    expect(sql.options.password).toBe(secret);
    expect(Object.keys(sql.options)).toContain("password");
    expect(Bun.inspect(sql.options)).toContain('password: "[REDACTED]"');
    for (const printed of [Bun.inspect(sql.options), util.inspect(sql.options), util.inspect(sql), Bun.inspect(sql)]) {
      expect(printed).not.toContain(secret);
    }
  });

  test("a password function is not called", () => {
    let calls = 0;
    const { options } = new SQL({ hostname: "127.0.0.1", password: () => (calls++, secret) });
    expect(Bun.inspect(options)).toContain('password: "[REDACTED]"');
    expect(calls).toBe(0);
  });

  test("an empty password is printed as it is", () => {
    expect(Bun.inspect(optionsOf("postgres://app@127.0.0.1/db"))).toContain('password: ""');
  });

  test("tls.key and tls.passphrase are not printed", () => {
    const key = Buffer.from("sekret-key");
    const { options } = new SQL({ hostname: "127.0.0.1", tls: { key, passphrase: "sekret-passphrase" } });
    expect(options.tls).toMatchObject({ key, passphrase: "sekret-passphrase" });
    for (const printed of [Bun.inspect(options), util.inspect(options, { depth: 4 })]) {
      expect(printed).toMatch(/passphrase: ["']\[REDACTED\]["']/);
      expect(printed).toMatch(/key: ["']\[REDACTED\]["']/);
      expect(printed).not.toContain("sekret-passphrase");
      expect(printed).not.toContain(Bun.inspect(key));
    }
  });
});

// The pool reads `sql.options` again for every connection, so what is assigned reaches the native constructor unparsed.
test.concurrent.each([
  ["postgres", "ERR_POSTGRES_CONNECTION_REFUSED"],
  ["mysql", "ERR_MYSQL_CONNECTION_REFUSED"],
])("%s: invalid values assigned to sql.options reject the next connection", async (adapter, refused) => {
  const port = await closedPort();
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const timeouts = ["idleTimeout", "connectionTimeout", "maxLifetime"];
async function attempt(assign) {
  const sql = new Bun.SQL({ url: process.env.SQL_URL, max: 1 });
  assign(sql.options);
  try {
    await sql.connect();
    return "connected";
  } catch (e) {
    return e.code ?? e.name;
  } finally {
    await sql.close({ timeout: 0 });
  }
}
const results = {};
for (const [label, value] of [["object", {}], ["string", "abc"], ["negative", -1], ["huge", 1e300], ["NaN", NaN]]) {
  results["timeouts " + label] = await attempt(options => {
    for (const key of timeouts) options[key] = value;
  });
}
for (const key of timeouts) {
  results[key + " symbol"] = await attempt(options => {
    options[key] = Symbol();
  });
  results[key + " valueOf throws"] = await attempt(options => {
    options[key] = {
      valueOf() {
        throw Object.assign(new Error("from valueOf"), { code: "FROM_VALUE_OF" });
      },
    };
  });
}
for (const [label, value] of [["object", {}], ["string", "require"], ["negative", -1], ["out of range", 5], ["fraction", 1.5]]) {
  results["sslMode " + label] = await attempt(options => {
    options.sslMode = value;
  });
}
results["port fraction"] = await attempt(options => {
  options.port += 0.5;
});
results["port NaN"] = await attempt(options => {
  options.port = NaN;
});
console.log(JSON.stringify(results));`,
    ],
    env: { ...bunEnv, SQL_URL: `${adapter}://user@127.0.0.1:${port}/db` },
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(JSON.parse(stdout)).toEqual({
    "timeouts object": refused,
    "timeouts string": refused,
    "timeouts negative": refused,
    "timeouts huge": refused,
    "timeouts NaN": refused,
    "idleTimeout symbol": "TypeError",
    "idleTimeout valueOf throws": "FROM_VALUE_OF",
    "connectionTimeout symbol": "TypeError",
    "connectionTimeout valueOf throws": "FROM_VALUE_OF",
    "maxLifetime symbol": "TypeError",
    "maxLifetime valueOf throws": "FROM_VALUE_OF",
    // A mode that cannot be mapped must not mean `disable`.
    "sslMode object": "ERR_INVALID_ARG_TYPE",
    "sslMode string": "ERR_INVALID_ARG_TYPE",
    "sslMode negative": "ERR_OUT_OF_RANGE",
    "sslMode out of range": "ERR_OUT_OF_RANGE",
    "sslMode fraction": "ERR_OUT_OF_RANGE",
    "port fraction": refused,
    "port NaN": refused,
  });
  expect(exitCode).toBe(0);
});

test.skipIf(isWindows).concurrent.each(["postgres", "mysql"] as const)(
  "%s: a unix socket that is not there fails the connection, and TCP is not dialed",
  async adapter => {
    let tcpConnections = 0;
    const { port, server } = await listeningServer(socket => {
      tcpConnections++;
      socket.destroy();
    });
    const sql = new SQL({
      adapter,
      path: "/nonexistent/dir/database.sock",
      hostname: "127.0.0.1",
      port,
      username: "user",
      database: "db",
      max: 1,
      connectionTimeout: 0.25,
    });
    try {
      expect(await sql.connect().catch(e => e)).toBeInstanceOf(Error);
      expect(tcpConnections).toBe(0);
    } finally {
      await sql.close({ timeout: 0 });
      server.close();
    }
  },
);

// util.inspect() with `customInspect: false` lists the own properties of a value and of what they hold. The message
// of a failed node:assert is made that way. The state of a query holds the pool, and the pool holds the password.
describe("a query keeps its state in private fields", () => {
  const password = "Hunter2Marker";
  const assertionMessage = (query: object) => {
    try {
      assert.strictEqual(query, 1);
    } catch (error) {
      return (error as Error).message;
    }
  };
  // `getters` also calls what Query.prototype serves to the adapters.
  const everything = { customInspect: false, showHidden: true, getters: true, depth: Infinity };
  function expectNoOwnProperty(query: object) {
    expect(Reflect.ownKeys(query)).toEqual([]);
    expect({ ...query }).toEqual({});
    expect(assertionMessage(query)).toStartWith(
      "Expected values to be strictly equal:\n+ actual - expected\n\n+ Query [Promise] {\n",
    );
    expect(assertionMessage(query)).not.toContain(password);
    expect(util.inspect(query, everything)).not.toContain(password);
  }

  test.each(["postgres", "mysql"])("%s: a query that waits for a connection, and one that failed", async adapter => {
    await using sql = new SQL(`${adapter}://user:${password}@127.0.0.1:${await closedPort()}/db`, { max: 1 });
    const query = sql`select 1`;
    expect(util.inspect(query, { customInspect: false })).toBe("Query [Promise] { <pending> }");
    expectNoOwnProperty(query);
    query.execute();
    expectNoOwnProperty(query);
    expect(await query.catch(error => error.code)).toBe(`ERR_${adapter.toUpperCase()}_CONNECTION_REFUSED`);
    expectNoOwnProperty(query);
  });

  test("sqlite: a query that ran", async () => {
    await using sql = new SQL(":memory:");
    const query = sql`select 1 as x`;
    expectNoOwnProperty(query);
    expect(await query).toEqual([{ x: 1 }]);
    expectNoOwnProperty(query);
  });

  test("postgres: a query that ran on a connection of the pool, and one with a COPY stream", async () => {
    const { port, server } = await pgMockServer((type, body) => {
      if (type !== "Q") return;
      if (body.toString().startsWith("copy")) {
        return [
          pgCopyOutResponse([0]),
          pgCopyData(Buffer.from("1\n")),
          pgCopyDone(),
          pgCommandComplete("COPY 1"),
          pgReadyForQuery(),
        ];
      }
      return [
        pgRowDescription([{ name: "x", typeOid: 23 }]),
        pgDataRow([Buffer.from("1")]),
        pgCommandComplete("SELECT 1"),
        pgReadyForQuery(),
      ];
    });
    try {
      await using sql = new SQL(`postgres://user:${password}@127.0.0.1:${port}/db`, { max: 1 });
      const query = sql`select 1 as x`.simple();
      expect(await query).toEqual([{ x: 1 }]);
      expectNoOwnProperty(query);

      const copy = sql`copy t to stdout`;
      const reader = copy.readable().getReader();
      expectNoOwnProperty(copy);
      expect(Buffer.from((await reader.read()).value!).toString()).toBe("1\n");
      expect((await reader.read()).done).toBe(true);
      await copy;
      expectNoOwnProperty(copy);

      const unstarted = sql`copy t from stdin`;
      unstarted.writable();
      expectNoOwnProperty(unstarted);
      unstarted.cancel();
    } finally {
      server.close();
    }
  });

  // As two promises are: toEqual() compares own properties.
  test("two queries are equal to toEqual()", async () => {
    await using sql = new SQL(":memory:");
    expect(Bun.deepEquals(sql`select 1`, sql`select 2`)).toBe(true);
    expect(sql`select 1`).toEqual(sql`select 2`);
    expect(util.isDeepStrictEqual(sql`select 1`, sql`select 2`)).toBe(false);
  });

  test("the members of Query.prototype answer for an object that is no query", async () => {
    await using sql = new SQL(":memory:");
    const prototype = Object.getPrototypeOf(sql`select 1`);
    for (const object of [prototype, Object.create(prototype)]) {
      const keys = Reflect.ownKeys(object);
      expect(Bun.inspect(object)).toBe("Query {  }");
      expect({ active: object.active, cancelled: object.cancelled }).toEqual({ active: false, cancelled: false });
      object.active = true;
      expect(object.simple()).toBe(object);
      expect(object.cancel()).toBe(object);
      expect({ active: object.active, cancelled: object.cancelled }).toEqual({ active: false, cancelled: false });
      expect(Reflect.ownKeys(object)).toEqual(keys);
    }
  });

  // What stands for a query and is none: a Proxy with no `get` trap, a Proxy whose trap passes itself on as the
  // receiver, and an object that inherits from the query.
  const wrappers: [string, <T extends object>(query: T) => T][] = [
    ["a Proxy of a Proxy of a query", query => new Proxy(new Proxy(query, {}), {})],
    ["a Proxy of a query with a get trap", query => new Proxy(query, { get: Reflect.get })],
    ["an object that inherits from a query", query => Object.create(query)],
    ["an object that inherits from a Proxy of a query", query => Object.create(new Proxy(query, {}))],
  ];

  test.each(wrappers)("%s is that fragment", async (_, wrap) => {
    await using sql = new SQL(":memory:");
    await sql`create table t (id int)`;
    await sql`insert into t ${sql([{ id: 1 }, { id: 2 }, { id: 3 }])}`;
    expect(await sql`select id from ${wrap(sql("t"))} where ${wrap(sql`id = 2`)}`).toEqual([{ id: 2 }]);
    expect(await sql`select id from t where ${wrap(sql`id = ${1}`)} or id = ${3} order by id`).toEqual([
      { id: 1 },
      { id: 3 },
    ]);
    const conditions = [wrap(sql`id = ${1}`), wrap(sql`or id = ${3}`)];
    expect(await sql`select id from t where ${conditions} order by id`).toEqual([{ id: 1 }, { id: 3 }]);
  });

  test("an object that inherits from Query.prototype and from no query is no fragment", async () => {
    await using sql = new SQL(":memory:");
    const prototype = Object.getPrototypeOf(sql`select 1`);
    for (const value of [Object.create(prototype), new Proxy(Object.create(prototype), {})]) {
      const error = await sql`select ${value}`.catch((error: unknown) => error);
      expect(error).toBeInstanceOf(SyntaxError);
      expect((error as Error).message).toBe("Invalid query: SQL Fragment cannot be executed or was misused");
    }
  });

  test("a prototype chain that a Proxy leads back into has no query", async () => {
    await using sql = new SQL(":memory:");
    const prototype = Object.getPrototypeOf(sql`select 1`);
    const cancelled = Object.getOwnPropertyDescriptor(prototype, "cancelled")!.get!;
    const object = {};
    Object.setPrototypeOf(object, new Proxy(new Proxy(object, {}), {}));
    expect(cancelled.call(object)).toBe(false);
    expect(prototype.cancel.call(object)).toBe(object);
    expect(prototype.simple.call(object)).toBe(object);
  });

  test("a revoked Proxy of a query gives no access to the query", async () => {
    await using sql = new SQL(":memory:");
    const query = sql`select 1 as x`;
    const prototype = Object.getPrototypeOf(query);
    const { proxy, revoke } = Proxy.revocable(query, {});
    revoke();
    expect(() => prototype.cancel.call(proxy)).toThrow(TypeError);
    expect(() => prototype.simple.call(proxy)).toThrow(TypeError);
    expect(() => Object.getOwnPropertyDescriptor(prototype, "cancelled")!.get!.call(proxy)).toThrow(TypeError);
    expect(query.cancelled).toBe(false);
    expect(await query).toEqual([{ x: 1 }]);
  });

  test.each(wrappers)("%s has the status of the query, and cancels it", async (_, wrap) => {
    await using sql = new SQL(":memory:");
    const query = sql`select 1 as x`;
    const wrapped = wrap(query);
    expect({ active: wrapped.active, cancelled: wrapped.cancelled }).toEqual({ active: false, cancelled: false });
    expect(util.inspect({ wrapped })).toBe("{ wrapped: Query {  } }");
    expect(wrapped.cancel()).toBe(wrapped);
    expect({ wrapped: wrapped.cancelled, query: query.cancelled }).toEqual({ wrapped: true, query: true });
    expect(Bun.inspect(wrapped)).toBe("Query { cancelled }");
    expect(await query.catch(error => error.code)).toBe("ERR_SQLITE_QUERY_CANCELLED");
  });

  test.each(wrappers)("simple() of %s selects the simple protocol", async (_, wrap) => {
    const seen: string[] = [];
    const { port, server } = await pgMockServer(type => {
      seen.push(type);
      if (type === "Q") {
        return [
          pgRowDescription([{ name: "x", typeOid: 23 }]),
          pgDataRow([Buffer.from("1")]),
          pgCommandComplete("SELECT 1"),
          pgReadyForQuery(),
        ];
      }
      // The extended protocol: the query fails, and does not wait.
      if (type === "P") return pgErrorResponse({ S: "ERROR", C: "0A000", M: "not the simple protocol" });
      if (type === "S") return pgReadyForQuery();
    });
    try {
      await using sql = new SQL(`postgres://user@127.0.0.1:${port}/db`, { max: 1 });
      const query = sql`select 1 as x`;
      const wrapped = wrap(query);
      expect(wrapped.simple()).toBe(wrapped);
      const rows = await query.catch(error => error.message);
      expect({ seen, rows }).toEqual({ seen: ["Q"], rows: [{ x: 1 }] });
    } finally {
      server.close();
    }
  });
});
