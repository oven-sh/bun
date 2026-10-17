// Where the server is: adapter-env-var-precedence.test.ts. Which file is opened: sqlite-url-parsing.test.ts.
import { SQL } from "bun";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tls as harnessTls, isWindows, tempDir } from "harness";
import fs from "node:fs";
import type net from "node:net";
import path from "node:path";
import tls from "node:tls";
import util from "node:util";
import {
  MYSQL_CLIENT_SSL,
  MYSQL_DEFAULT_CAPABILITIES,
  closedPort,
  listeningServer,
  loopbackFence,
  mysqlErrPacket,
  mysqlHandshakeV10,
  mysqlParseHandshakeResponse41,
  pgAuthenticationCleartextPassword,
  pgErrorResponse,
  pgParseStartupMessage,
  pgReadFrontendMessages,
  pgSSLRequest,
  pgSSLResponse,
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

describe("an option that the caller did not set", () => {
  // Self-signed, for 127.0.0.1, in no trust store.
  const selfSigned = { key: harnessTls.key, cert: harnessTls.cert };
  // Signed by ca1, for no name that is dialed.
  const fixtures = path.join(import.meta.dirname, "..", "node", "tls", "fixtures");
  const agent1File = { key: path.join(fixtures, "agent1-key.pem"), cert: path.join(fixtures, "agent1-cert.pem") };
  const otherName = { key: fs.readFileSync(agent1File.key, "utf8"), cert: fs.readFileSync(agent1File.cert, "utf8") };
  const ca1File = path.join(fixtures, "ca1-cert.pem");
  const ca1 = fs.readFileSync(ca1File, "utf8");
  const childEnv = Object.fromEntries(Object.entries(bunEnv).filter(([name]) => !SQL_VARIABLE.test(name)));

  type Certificate = typeof selfSigned;
  /** What a server saw of its client, and how the client ended. */
  type Outcome = {
    asksForTLS: boolean;
    inClear?: Record<string, string>;
    insideTLS?: Record<string, string>;
    clientCertificate?: string;
    result?: string;
  };
  type Case = {
    /** What `Object.prototype` has while the client is made and dials. */
    polluted?: Record<string, unknown>;
    env?: Record<string, string>;
    /** The arguments of `new SQL()`. <port> is the port of the server of this case, <elsewhere> one that nobody may dial. */
    args?: unknown[];
    /**
     * The last argument has its keys from the getters of a class, or from the object that it was created from. Or it is
     * a Proxy: of the object, or of an empty one with a `get` that answers for the object.
     */
    inherits?: "class" | "Object.create" | "Proxy" | "get";
    /** `Bun.sql` in place of `new SQL()`. */
    lazy?: boolean;
    /** The query writes. */
    writes?: boolean;
    mysql?: boolean;
    /** The server offers TLS, with this. */
    certificate?: Certificate;
  };

  function upgrade(raw: net.Socket, certificate: Certificate, leftover: Buffer, seen: Outcome) {
    raw.pause();
    if (leftover.length) raw.unshift(leftover);
    const options = { isServer: true, requestCert: true, rejectUnauthorized: false, ...certificate };
    const socket = new tls.TLSSocket(raw, options);
    socket.on("secure", () => {
      const name = socket.getPeerCertificate()?.subject?.CN;
      if (name) seen.clientCertificate = name;
    });
    socket.on("error", () => {});
    return socket;
  }

  /** It asks for the password as it is, and refuses the login. */
  function servePostgres(socket: net.Socket, seen: Outcome, certificate: Certificate | undefined) {
    const where = socket instanceof tls.TLSSocket ? "insideTLS" : "inClear";
    let buffered: Buffer = Buffer.alloc(0);
    let started = false;
    const onData = (chunk: Buffer) => {
      buffered = Buffer.concat([buffered, chunk]);
      if (!started) {
        if (buffered.length < 8) return;
        if (buffered.subarray(0, 8).equals(pgSSLRequest())) {
          seen.asksForTLS = true;
          socket.write(pgSSLResponse(certificate ? "S" : "N"));
          const leftover = buffered.subarray(8);
          buffered = Buffer.alloc(0);
          if (!certificate) return;
          socket.off("data", onData);
          return servePostgres(upgrade(socket, certificate, leftover, seen), seen, certificate);
        }
        const startup = pgParseStartupMessage(buffered);
        if (!startup) return;
        started = true;
        buffered = startup.rest;
        seen[where] = startup.params;
        socket.write(pgAuthenticationCleartextPassword());
      }
      buffered = pgReadFrontendMessages(buffered, (type, body) => {
        if (type !== 0x70 /* 'p' */) return;
        seen[where]!.password = body.toString("utf8", 0, body.length - 1);
        socket.end(pgErrorResponse({ S: "FATAL", C: "28P01", M: "refused" }));
      });
    };
    socket.on("error", () => {});
    socket.on("data", onData);
  }

  function serveMySQL(socket: net.Socket, seen: Outcome, certificate: Certificate | undefined) {
    const inside = socket instanceof tls.TLSSocket;
    if (!inside) {
      const capabilities = MYSQL_DEFAULT_CAPABILITIES | (certificate ? MYSQL_CLIENT_SSL : 0);
      socket.write(mysqlHandshakeV10({ capabilities }));
    }
    let buffered: Buffer = Buffer.alloc(0);
    const onData = (chunk: Buffer) => {
      buffered = Buffer.concat([buffered, chunk]);
      if (buffered.length < 4 || buffered.length < 4 + buffered.readUIntLE(0, 3)) return;
      const payload = buffered.subarray(4, 4 + buffered.readUIntLE(0, 3));
      socket.off("data", onData);
      // SSLRequest: the head of the login, and nothing behind it
      if (!inside && certificate && payload.length === 32) {
        seen.asksForTLS = true;
        return serveMySQL(upgrade(socket, certificate, buffered.subarray(36), seen), seen, certificate);
      }
      seen[inside ? "insideTLS" : "inClear"] = { user: mysqlParseHandshakeResponse41(payload).username };
      socket.end(mysqlErrPacket(buffered[3] + 1, 1045, "28000", "refused"));
    };
    socket.on("error", () => {});
    socket.on("data", onData);
  }

  const client = `
    const results = [];
    for (const { polluted = {}, env = {}, args = [], inherits, lazy, writes } of JSON.parse(process.env.CASES)) {
      Object.assign(process.env, env);
      if (inherits === "Object.create") args.push(Object.create(args.pop()));
      if (inherits === "class") {
        const values = args.pop();
        class Config {}
        for (const key of Object.keys(values)) Object.defineProperty(Config.prototype, key, { get: () => values[key] });
        args.push(new Config());
      }
      if (inherits === "Proxy") args.push(new Proxy(args.pop(), {}));
      if (inherits === "get") {
        const values = args.pop();
        args.push(new Proxy({}, { get: (_, key) => values[key] }));
      }
      Object.assign(Object.prototype, polluted);
      let result;
      try {
        const sql = lazy ? Bun.sql : new Bun.SQL(...args);
        result = await (writes ? sql\`PRAGMA user_version = 1\` : sql\`select 1\`).then(() => "done", error => error.code);
        await sql.close({ timeout: 0 });
      } catch (error) {
        result = "throws " + error.code;
      }
      for (const key of Object.keys(polluted)) delete Object.prototype[key];
      for (const key of Object.keys(env)) delete process.env[key];
      results.push(result);
    }
    process.stdout.write(JSON.stringify(results));
  `;

  // [name, value] of every client whose sql.options is not that of the same call without the name
  const parser = `
    const { env = {}, args = [], names, values } = JSON.parse(process.env.CASES);
    const print = sql =>
      JSON.stringify(sql.options, (_, value) => (value === undefined ? "undefined" : typeof value === "function" ? "function" : value));
    Object.assign(process.env, env);
    const clean = print(new Bun.SQL(...args));
    const differs = [];
    for (const name of names) {
      for (const value of values) {
        Object.prototype[name] = value;
        let polluted;
        try {
          polluted = print(new Bun.SQL(...args));
        } catch (error) {
          polluted = "throws " + error.code;
        }
        delete Object.prototype[name];
        if (polluted !== clean) differs.push([name, value]);
      }
    }
    process.stdout.write(JSON.stringify(differs));
  `;

  /** One process for all of them, one after the other, and a server for each. ca1 is a CA that the process trusts. */
  async function run(cases: Case[]): Promise<Outcome[]> {
    let elsewhere = 0;
    const nobody = await listeningServer(socket => {
      elsewhere++;
      socket.destroy();
    });
    const outcomes = cases.map((): Outcome => ({ asksForTLS: false }));
    const servers = await Promise.all(
      cases.map(({ mysql, certificate }, i) =>
        listeningServer(socket => (mysql ? serveMySQL : servePostgres)(socket, outcomes[i], certificate)),
      ),
    );
    try {
      const filled = cases.map(({ certificate, mysql, ...rest }, i) =>
        JSON.parse(
          JSON.stringify(rest).replaceAll("<port>", `${servers[i].port}`).replaceAll("<elsewhere>", `${nobody.port}`),
        ),
      );
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", client],
        env: { ...childEnv, NODE_EXTRA_CA_CERTS: ca1File, CASES: JSON.stringify(filled) },
        stdout: "pipe",
        stderr: "inherit",
      });
      const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
      await loopbackFence();
      (JSON.parse(stdout) as string[]).forEach((result, i) => (outcomes[i].result = result));
      expect(exitCode).toBe(0);
      expect(elsewhere).toBe(0);
      return outcomes;
    } finally {
      nobody.server.close();
      for (const { server } of servers) server.close();
    }
  }

  /**
   * Each call once as it is, which has to end as `clean` says, and once for each `polluted`, which has to end as the
   * first did. Gives how the first of each ended.
   */
  async function expectAsClean(rows: [call: Case, clean: Outcome, polluted: Record<string, unknown>[]][]) {
    const cases = rows.flatMap(([call, , polluted]) => [call, ...polluted.map(polluted => ({ ...call, polluted }))]);
    const outcomes = await run(cases);
    const actual: Record<string, Outcome> = {};
    const expected: Record<string, Outcome> = {};
    const firsts: Outcome[] = [];
    let i = 0;
    for (const [{ args, env }, clean, polluted] of rows) {
      const first = outcomes[i++];
      firsts.push(first);
      expect(first).toMatchObject(clean);
      expect(Object.keys(first).sort()).toEqual(Object.keys({ ...clean, result: "" }).sort());
      for (const keys of polluted) {
        const title = `${JSON.stringify(keys).slice(0, 60)} ${JSON.stringify(args ?? env).slice(0, 120)}`;
        actual[title] = outcomes[i++];
        expected[title] = first;
      }
    }
    expect(actual).toEqual(expected);
    return firsts;
  }

  // `max=1`: a pool dials up to `max` times for the first query.
  const postgres = (query = "") => `postgres://app:s3cret@127.0.0.1:<port>/prod?max=1${query}`;
  const mysql = (query = "", scheme = "mysql") => `${scheme}://app:s3cret@127.0.0.1:<port>/prod?max=1${query}`;
  const login = { user: "app", password: "s3cret" };
  const elsewhere = "postgres://127.0.0.1:<elsewhere>/prod";

  // As an option, and as a parameter of the URL in a spelling that the URL does not have.
  const lessTLS: Record<string, unknown>[] = [
    { tls: false },
    { ssl: false },
    { ssl: "disable" },
    { ssl: "prefer" },
    { "ssl-mode": "disable" },
    { SSLMODE: "prefer" },
    { Tls: "0" },
  ];
  const noTLS: Outcome = { asksForTLS: true, result: "ERR_POSTGRES_TLS_NOT_AVAILABLE" };

  test.concurrent("does not lower the sslmode of a URL", async () => {
    await expectAsClean([
      [{ args: [postgres("&sslmode=require")] }, noTLS, lessTLS],
      [{ args: [postgres("&sslmode=verify-full")] }, noTLS, lessTLS],
    ]);
  });

  test.concurrent.each(["mysql", "mariadb"])("does not lower the ssl-mode of a %s:// URL", async scheme => {
    const call = { args: [mysql("&ssl-mode=REQUIRED", scheme)], mysql: true };
    const polluted = [...lessTLS, { sslmode: "disable" }];
    await expectAsClean([
      [call, { asksForTLS: false, result: "ERR_MYSQL_AUTHENTICATION_FAILED" }, polluted],
      [{ ...call, certificate: selfSigned }, { asksForTLS: true, insideTLS: { user: "app" } }, polluted],
    ]);
  });

  test.concurrent("does not lower what the environment asks for", async () => {
    await expectAsClean([
      [
        { env: { DATABASE_URL: postgres(), PGSSLMODE: "verify-full" } },
        noTLS,
        // `Bun.env` inherits as well.
        [
          ...lessTLS,
          { sslmode: "disable" },
          { PG_SSLMODE: "disable" },
          { PG_PORT: "<elsewhere>" },
          { POSTGRES_URL: elsewhere },
        ],
      ],
      [{ env: { TLS_POSTGRES_DATABASE_URL: postgres() } }, noTLS, lessTLS],
      [
        { env: { TLS_MYSQL_DATABASE_URL: mysql() }, mysql: true, certificate: selfSigned },
        { asksForTLS: true, insideTLS: { user: "app" } },
        lessTLS,
      ],
    ]);
  });

  test.concurrent("does not lower channel_binding=require", async () => {
    // The server asks for the password as it is, and the client leaves.
    const leaves: Outcome = {
      asksForTLS: false,
      inClear: { user: "app" },
      result: "ERR_POSTGRES_CHANNEL_BINDING_REQUIRED",
    };
    const polluted = [
      { channelBinding: "disable" },
      { channelBinding: "prefer" },
      { channel_binding: "disable" },
      { CHANNEL_BINDING: "prefer" },
    ];
    const firsts = await expectAsClean([
      [{ args: [postgres("&channel_binding=require")] }, leaves, polluted],
      [{ env: { DATABASE_URL: postgres(), PGCHANNELBINDING: "require" } }, leaves, polluted],
    ]);
    for (const { inClear } of firsts) expect(inClear).not.toHaveProperty("password");
  });

  // The default client is made once in a process.
  test.concurrent.each<[Record<string, unknown>, Record<string, string>]>([
    [{ tls: false }, { DATABASE_URL: postgres() }],
    [{ "ssl-mode": "disable" }, { DATABASE_URL: postgres() }],
    [{ DATABASE_URL: elsewhere }, { PGHOST: "127.0.0.1", PGPORT: "<port>", PGUSER: "app", PGPASSWORD: "s3cret" }],
  ])("Bun.sql: %j", async (polluted, env) => {
    const [outcome] = await run([{ lazy: true, env: { ...env, PGSSLMODE: "verify-full" }, polluted }]);
    expect(outcome).toEqual(noTLS);
  });

  describe("what the caller sets", () => {
    const url = postgres("&sslmode=verify-full");
    const lowered = [{ tls: false }, { ssl: false }, { ssl: "disable" }, { ssl: "prefer" }];
    const expectLowered = (outcomes: Outcome[]) =>
      outcomes.forEach((outcome, i) => {
        expect(outcome).toMatchObject({ asksForTLS: i % 4 === 3, inClear: login, result: "ERR_POSTGRES_SERVER_ERROR" });
      });

    test.concurrent("counts as before: its own, from a class, from Object.create() and from a Proxy", async () => {
      const inherited = lowered.map(options => ({ args: [url, { adapter: "postgres", ...options }] }));
      expectLowered(
        await run([
          ...lowered.map(options => ({ args: [url, options] })),
          ...inherited.map(call => ({ ...call, inherits: "class" as const })),
          ...inherited.map(call => ({ ...call, inherits: "Object.create" as const })),
          ...inherited.map(call => ({ ...call, inherits: "Proxy" as const })),
          ...inherited.map(call => ({ ...call, inherits: "get" as const })),
        ]),
      );
      const [outcome] = await run([{ args: [postgres(), { adapter: "postgres", tls: true }], inherits: "get" }]);
      expect(outcome).toEqual(noTLS);
    });

    test.concurrent("is read from a Proxy that names a new prototype each time it is asked", async () => {
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          `
          const endless = own => new Proxy(own, { getPrototypeOf: () => endless({}) });
          console.log(new Bun.SQL("postgres://localhost:1/db", endless({ max: 3 })).options.max);
        `,
        ],
        env: childEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({ stdout, stderr, exitCode }).toEqual({ stdout: "3\n", stderr: "", exitCode: 0 });
    });

    test.concurrent("counts alone", async () => {
      const polluted = { tls: true, ssl: "verify-full" };
      expectLowered(await run(lowered.map(options => ({ args: [url, options], polluted }))));
      await expectAsClean([
        [{ args: [postgres(), { tls: true }] }, noTLS, lessTLS],
        [{ args: [url, { adapter: "postgres" }], inherits: "Proxy" }, noTLS, lessTLS],
        [{ args: [url, { adapter: "postgres" }], inherits: "get" }, noTLS, lessTLS],
      ]);
    });
  });

  test.concurrent("is not dialed, is not logged in with, and is not sent to the server", async () => {
    const inClear: Outcome = { asksForTLS: false, inClear: { ...login, database: "prod" } };
    const polluted: Record<string, unknown>[] = [
      { host: "127.0.0.2" },
      { hostname: "127.0.0.2" },
      { port: "<elsewhere>" },
      { PORT: "<elsewhere>" },
      { path: "/nonexistent/elsewhere.sock" },
      { socket: "/nonexistent/elsewhere.sock" },
      { url: "postgres://evil:evil@127.0.0.1:<elsewhere>/evil" },
      { user: "evil" },
      { password: "evil" },
      { dbname: "evil" },
      { options: "-c search_path=evil" },
      { search_path: "evil" },
      { anything: "evil" },
      { connection: { search_path: "evil" } },
    ];
    await expectAsClean([
      [{ args: [postgres()] }, inClear, polluted],
      [{ args: [postgres(), { connection: { application_name: "mine" } }] }, inClear, [{ search_path: "evil" }]],
      [{ args: [mysql()], mysql: true }, { asksForTLS: false, inClear: { user: "app" } }, polluted.slice(0, 8)],
    ]);
  });

  describe("a client that verifies its server", () => {
    const refuses = (result: string): Outcome => ({ asksForTLS: true, result });
    const fromEnvironment: Case = { env: { DATABASE_URL: postgres(), PGSSLMODE: "verify-full" } };
    // These never counted: the object that the TLS options are read from inherits nothing.
    const tlsOptions = [{ rejectUnauthorized: false }, { ca: selfSigned.cert }, { NODE_TLS_REJECT_UNAUTHORIZED: "0" }];

    test.concurrent("refuses a certificate of a CA that it does not trust", async () => {
      using dir = tempDir("sql-options-ca", { "ca.pem": selfSigned.cert });
      const file = path.join(String(dir), "ca.pem");
      const refused = refuses("DEPTH_ZERO_SELF_SIGNED_CERT");
      const otherCA = [{ sslrootcert: file }, { SSLROOTCERT: file }];
      const weaker = [
        { sslmode: "require" },
        { "ssl-mode": "require" },
        { SSLMODE: "prefer" },
        { ssl_mode: "disable" },
      ];
      const rows = (
        [
          [{ args: [postgres("&sslmode=verify-full")] }, [...otherCA, ...weaker, ...tlsOptions]],
          [{ args: [postgres("&sslmode=verify-ca")] }, [...otherCA, ...weaker]],
          [{ args: [postgres(`&sslmode=verify-full&sslrootcert=${ca1File}`)] }, otherCA],
          [{ args: [postgres(), { tls: { ca: ca1 } }] }, [...otherCA, ...tlsOptions]],
          [{ args: [postgres(), { ssl: "verify-full" }] }, otherCA],
          [{ args: [postgres(), { tls: { rejectUnauthorized: true } }] }, otherCA],
          [fromEnvironment, [...otherCA, ...weaker]],
          [{ args: [mysql("&ssl-mode=VERIFY_IDENTITY")], mysql: true }, [...weaker, ...tlsOptions]],
          [{ args: [mysql(), { tls: { ca: ca1 } }], mysql: true }, tlsOptions],
        ] as [Case, Record<string, unknown>[]][]
      ).map(([call, polluted]): Parameters<typeof expectAsClean>[0][number] => [
        { ...call, certificate: selfSigned },
        refused,
        polluted,
      ]);
      await expectAsClean(rows);
    });

    test.concurrent("refuses a certificate for another name", async () => {
      const refused = refuses("ERR_TLS_CERT_ALTNAME_INVALID");
      const polluted = [
        { sslmode: "verify-ca" },
        { "ssl-mode": "verify-ca" },
        { servername: "agent1" },
        { serverName: "agent1" },
      ];
      await expectAsClean(
        (
          [
            { args: [postgres("&sslmode=verify-full")] },
            { args: [postgres(), { tls: { ca: ca1 } }] },
            { args: [postgres(), { tls: { rejectUnauthorized: true } }] },
            fromEnvironment,
            { args: [mysql("&ssl-mode=VERIFY_IDENTITY")], mysql: true },
            { args: [mysql(), { tls: { ca: ca1 } }], mysql: true },
          ] as Case[]
        ).map(call => [{ ...call, certificate: otherName }, refused, polluted]),
      );
    });

    test.concurrent("shows no certificate of its own", async () => {
      await expectAsClean([
        [
          { args: [postgres("&sslmode=require")], certificate: selfSigned },
          { asksForTLS: true, insideTLS: login },
          [
            { sslcert: agent1File.cert, sslkey: agent1File.key },
            { SSLCERT: agent1File.cert, SSLKEY: agent1File.key },
            { certFile: agent1File.cert, keyFile: agent1File.key },
          ],
        ],
      ]);
    });
  });

  test.concurrent("does not open a read-only SQLite database for writing, or another one", async () => {
    using dir = tempDir("sql-options-sqlite", {});
    const file = path.join(String(dir), "db.sqlite");
    await using sql = new SQL(`sqlite://${file}`);
    await sql`create table t (a)`;
    const polluted = [{ readonly: false }, { readonly: 0 }, { filename: ":memory:" }, { url: "sqlite://:memory:" }];
    const readOnly: Outcome = { asksForTLS: false, result: "SQLITE_READONLY" };
    await expectAsClean([
      [{ args: [`sqlite://${file}?mode=ro`], writes: true }, readOnly, polluted],
      [
        { args: [{ adapter: "sqlite", filename: file, readwrite: false }], writes: true },
        readOnly,
        polluted.slice(0, 2),
      ],
    ]);
  });

  describe("leaves sql.options as it is, under every name that is read anywhere", () => {
    /** As it is written, in capitals, and in between. */
    const spellings = (name: string) => [name, name.toUpperCase(), name[0].toUpperCase() + name.slice(1)];
    const prefixes = ["PG", "PG_", "MYSQL", "MYSQL_", "MARIADB", "MARIADB_"];
    const names = [
      // options
      ...["adapter", "filename", "url", "hostname", "host", "port", "username", "user", "password", "pass"],
      ...["database", "db", "path", "socket", "tls", "ssl", "connection", "max", "bigint", "prepare", "transform"],
      ...[
        "idleTimeout",
        "idle_timeout",
        "connectionTimeout",
        "connection_timeout",
        "connectTimeout",
        "connect_timeout",
      ],
      ...[
        "maxLifetime",
        "max_lifetime",
        "allowPublicKeyRetrieval",
        "foundRows",
        "channelBinding",
        "onconnect",
        "onclose",
      ],
      // what the result has
      ...["query", "sslMode"],
      // TLS options
      ...["rejectUnauthorized", "ca", "caFile", "cert", "certFile", "key", "keyFile", "passphrase", "servername"],
      ...["serverName", "checkServerIdentity"],
      // parameters of the URL, whose names are read in any case
      ...["sslmode", "ssl-mode", "ssl_mode", "ssl", "tls", "path", "socket", "connect_timeout", "idle_timeout"].flatMap(
        spellings,
      ),
      ...["max_lifetime", "max", "prepare", "foundrows", "channel_binding", "host", "port", "user", "password"].flatMap(
        spellings,
      ),
      ...["dbname", "sslrootcert", "sslcert", "sslkey", "sslpassword", "options", "search_path", "anything"].flatMap(
        spellings,
      ),
      // variables
      ...[
        "DATABASE_URL",
        "DATABASEURL",
        "TLS_DATABASE_URL",
        "POSTGRES_URL",
        "PGURL",
        "PG_URL",
        "MYSQL_URL",
        "MYSQLURL",
      ],
      ...[
        "TLS_POSTGRES_DATABASE_URL",
        "TLS_MYSQL_DATABASE_URL",
        "TLS_MARIADB_DATABASE_URL",
        "MARIADB_URL",
        "MARIADBURL",
      ],
      ...["SQLITE_URL", "SQLITEURL", "PGUSERNAME", "PGAPPNAME", "PGOPTIONS", "PGCONNECT_TIMEOUT", "PGCHANNELBINDING"],
      ...prefixes.flatMap(prefix =>
        ["HOST", "PORT", "USER", "PASSWORD", "DATABASE", "SSLMODE"].map(name => prefix + name),
      ),
    ];
    const everything =
      "sslmode=verify-full&sslrootcert=/ca&sslcert=/c&sslkey=/k&host=h&port=1&user=u&password=p&dbname=d";

    test.concurrent.each<{ args?: unknown[]; env?: Record<string, string> }>([
      { args: ["postgres://u:p@h:1/d?sslmode=verify-full"] },
      {
        args: [`postgres://h?${everything}&path=/s&connect_timeout=1&idle_timeout=1&max_lifetime=1&max=1&prepare=true`],
      },
      { args: ["postgres://u:p@h:1/d", { tls: { ca: "ca" }, connection: { search_path: "s" }, transform: {} }] },
      { args: [{ url: "postgres://u:p@h:1/d?ssl=true&channel_binding=require" }] },
      { args: ["mysql://u:p@h:1/d?ssl-mode=VERIFY_IDENTITY&foundrows=false"] },
      { env: { DATABASE_URL: "postgres://u:p@h:1/d", PGSSLMODE: "verify-full" } },
    ])("%j", async call => {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", parser],
        env: {
          ...childEnv,
          CASES: JSON.stringify({ ...call, names: [...new Set(names)], values: [false, "disable"] }),
        },
        stdout: "pipe",
        stderr: "inherit",
      });
      const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
      expect(JSON.parse(stdout)).toEqual([]);
      expect(exitCode).toBe(0);
    });
  });

  test.each([
    [
      "postgres://h/d",
      ["idleTimeout", "connectionTimeout", "maxLifetime", "onconnect", "onclose", "transform", "path"],
    ],
    ["mysql://h/d", ["idleTimeout", "connectionTimeout", "maxLifetime", "onconnect", "onclose", "transform", "path"]],
    ["sqlite://:memory:", ["readonly", "create", "safeIntegers", "strict", "transform", "onconnect", "onclose"]],
  ])("%s: what is read from sql.options by name later is there, set or not", (url, names) => {
    const options = optionsOf(url);
    expect(names.filter(name => !Object.hasOwn(options, name))).toEqual([]);
    expect(names.filter(name => options[name] !== undefined)).toEqual([]);
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
    "sslMode negative": "ERR_INVALID_ARG_TYPE",
    "sslMode out of range": "ERR_INVALID_ARG_TYPE",
    "sslMode fraction": "ERR_INVALID_ARG_TYPE",
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
