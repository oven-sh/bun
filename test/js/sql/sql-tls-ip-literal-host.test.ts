// The TLS name Bun.SQL derives from an IP-literal host (PostgreSQL and MySQL):
// the bare address for certificate verification, and no SNI.
//
// `URL.hostname` keeps the brackets of an IPv6 literal ("[::1]"). That text is
// not an IP address to the certificate check, so it was compared against the
// certificate's DNS names and never against its IP SAN entries.
//
// These need a server that listens on ::1 and presents a certificate with a
// matching IP SAN, which the shared containers cannot do, so both adapters talk
// to a minimal mock that upgrades to TLS and accepts the login. All
// wire-protocol bytes come from test/js/sql/wire-frames.ts.

import { SQL } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isIPv6, tls as localhostTls } from "harness";
import type net from "node:net";
import tls from "node:tls";
import {
  MYSQL_CLIENT_SSL,
  MYSQL_DEFAULT_CAPABILITIES,
  listeningServer,
  mysqlAckSessionSetup,
  mysqlHandshakeV10,
  mysqlOkPacket,
  mysqlReadPackets,
  pgAuthenticationOk,
  pgCommandComplete,
  pgReadFrontendMessages,
  pgReadyForQuery,
  pgSSLResponse,
} from "./wire-frames";

type MockServer = {
  port: number;
  /** SNI of every completed TLS handshake, in order; `false` when the client sent none. */
  servernames: (string | false)[];
  close(): void;
};

/**
 * Wraps `rawSocket` in a server-side TLSSocket once the plaintext prelude is
 * done. Bytes already buffered past the prelude are TLS records: hand them to
 * the TLS engine instead of the plaintext parser. The certificate is the
 * harness one: SAN DNS:localhost, IP:127.0.0.1, IP:::1, self-signed.
 */
function upgrade(rawSocket: net.Socket, leftover: Buffer, servernames: (string | false)[]) {
  rawSocket.pause();
  if (leftover.length) rawSocket.unshift(leftover);
  const socket = new tls.TLSSocket(rawSocket, { isServer: true, key: localhostTls.key, cert: localhostTls.cert });
  socket.on("secure", () => servernames.push(socket.servername || false));
  socket.on("error", () => {});
  return socket;
}

/** Answers SSLRequest with 'S', upgrades, accepts any StartupMessage, then acks each simple query (LISTEN is one). */
async function postgresServer(host: string): Promise<MockServer> {
  const servernames: (string | false)[] = [];
  const { server, port } = await listeningServer(rawSocket => {
    rawSocket.on("error", () => {});
    rawSocket.once("data", (chunk: Buffer) => {
      // SSLRequest is Int32(8) Int32(80877103); the client sends nothing else
      // until it has the one-byte answer.
      rawSocket.write(pgSSLResponse("S"));
      const socket = upgrade(rawSocket, chunk.subarray(8), servernames);
      socket.once("data", () => {
        socket.write(Buffer.concat([pgAuthenticationOk(), pgReadyForQuery()]));
        let buffered = Buffer.alloc(0);
        socket.on("data", (data: Buffer) => {
          buffered = pgReadFrontendMessages(Buffer.concat([buffered, data]), (type, body) => {
            if (type !== 0x51 /* Query: "VERB ...\0" */) return;
            const verb = body.toString("utf8", 0, body.indexOf(0x20));
            socket.write(Buffer.concat([pgCommandComplete(verb), pgReadyForQuery()]));
          });
        });
      });
    });
  }, host);
  return { port, servernames, close: () => server.close() };
}

/** Advertises CLIENT_SSL, upgrades after the SSLRequest packet, then accepts the login. */
async function mysqlServer(host: string): Promise<MockServer> {
  const servernames: (string | false)[] = [];
  const { server, port } = await listeningServer(rawSocket => {
    rawSocket.on("error", () => {});
    rawSocket.write(mysqlHandshakeV10({ capabilities: MYSQL_DEFAULT_CAPABILITIES | MYSQL_CLIENT_SSL }));
    let buffered = Buffer.alloc(0);
    const onPlainData = (chunk: Buffer) => {
      buffered = Buffer.concat([buffered, chunk]);
      if (buffered.length < 4) return;
      const length = buffered[0] | (buffered[1] << 8) | (buffered[2] << 16);
      if (buffered.length < 4 + length) return;
      // The SSLRequest packet; the ClientHello may already follow it.
      const leftover = buffered.subarray(4 + length);
      buffered = Buffer.alloc(0);
      rawSocket.removeListener("data", onPlainData);
      const socket = upgrade(rawSocket, leftover, servernames);
      let authed = false;
      socket.on("data", (chunk: Buffer) => {
        buffered = mysqlReadPackets(Buffer.concat([buffered, chunk]), (seq, payload) => {
          if (!authed) {
            authed = true;
            socket.write(mysqlOkPacket(seq + 1));
            return;
          }
          if (!mysqlAckSessionSetup(socket, payload)) socket.end();
        });
      });
    };
    rawSocket.on("data", onPlainData);
  }, host);
  return { port, servernames, close: () => server.close() };
}

/** "CONNECTED", or the error that `connect()` rejected with. */
async function connect(url: string, tlsOptions: Bun.TLSOptions): Promise<unknown> {
  const sql = new SQL({ url: `${url}?sslmode=verify-full`, tls: tlsOptions, max: 1, idleTimeout: 1 });
  try {
    await sql.connect();
    return "CONNECTED";
  } catch (e) {
    return e;
  } finally {
    await sql.close({ timeout: 0 }).catch(() => {});
  }
}

const adapters = [
  ["PostgreSQL", "postgres", postgresServer],
  ["MySQL", "mysql", mysqlServer],
] as const;

describe.concurrent.each(adapters)("%s TLS to an IP-literal host", (_, scheme, startServer) => {
  async function withServer<T>(host: string, fn: (server: MockServer) => Promise<T>): Promise<T> {
    const server = await startServer(host);
    try {
      return await fn(server);
    } finally {
      server.close();
    }
  }

  // Skipped where the machine has no IPv6 loopback (see `isIPv6` in harness.ts).
  test.skipIf(!isIPv6())(
    "a bracketed IPv6 URL host is verified against the IP SAN and is not sent as SNI",
    async () => {
      await withServer("::1", async server => {
        expect(await connect(`${scheme}://u@[::1]:${server.port}/db`, { ca: localhostTls.cert })).toBe("CONNECTED");
        expect(server.servernames).toEqual([false]);
      });
    },
  );

  test("an IPv4 literal host is verified against the IP SAN and is not sent as SNI", async () => {
    await withServer("127.0.0.1", async server => {
      expect(await connect(`${scheme}://u@127.0.0.1:${server.port}/db`, { ca: localhostTls.cert })).toBe("CONNECTED");
      expect(server.servernames).toEqual([false]);
    });
  });

  // Dials 127.0.0.1, so it needs no IPv6 loopback: only the TLS name is ::1.
  test("a bracketed IPv6 literal in tls.serverName is verified against the IP SAN and is not sent as SNI", async () => {
    await withServer("127.0.0.1", async server => {
      const url = `${scheme}://u@127.0.0.1:${server.port}/db`;
      expect(await connect(url, { ca: localhostTls.cert, serverName: "[::1]" })).toBe("CONNECTED");
      expect(server.servernames).toEqual([false]);
    });
  });

  test("a DNS name in tls.serverName is still sent as SNI", async () => {
    await withServer("127.0.0.1", async server => {
      const url = `${scheme}://u@127.0.0.1:${server.port}/db`;
      expect(await connect(url, { ca: localhostTls.cert, serverName: "localhost" })).toBe("CONNECTED");
      expect(server.servernames).toEqual(["localhost"]);
    });
  });
});

// A `tls` option with no sslmode string (`tls: true`, `tls: {}`, an object with no
// `serverName`) reaches the native connection with no server name. The connection then
// names the host it dials: as SNI when the host is a DNS name, and as the name that
// verify-full matches. The mocks listen on 127.0.0.1 and the clients dial "localhost".

type Options = Bun.SQL.PostgresOrMySQLOptions;

/** The SNI of each TLS handshake that `use(sql)` makes against a new mock on `host`. */
async function servernamesOf(
  startServer: (host: string) => Promise<MockServer>,
  create: (port: number) => SQL,
  use: (sql: SQL) => Promise<unknown> = sql => sql.connect(),
  host = "127.0.0.1",
) {
  const server = await startServer(host);
  try {
    const sql = create(server.port);
    try {
      await use(sql);
    } finally {
      await sql.close({ timeout: 0 }).catch(() => {});
    }
    return server.servernames;
  } finally {
    server.close();
  }
}

/** Runs `script` in a child process and returns what it printed. A build that aborts on the script then fails one test only. */
async function runInChild(script: string, env: Record<string, string>) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: { ...bunEnv, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout: stdout.trim(), exitCode };
}

describe.concurrent.each(adapters)("%s TLS with no serverName in the options", (_, adapter, startServer) => {
  const options = (port: number, hostname = "localhost"): Options => ({
    adapter,
    hostname,
    port,
    username: "u",
    database: "db",
    max: 1,
  });

  test.each([
    ["tls: true", { tls: true }],
    ["ssl: true", { ssl: true }],
    ["tls: {}", { tls: {} }],
    ["tls: { rejectUnauthorized: false }", { tls: { rejectUnauthorized: false } }],
  ] as [string, Options][])("%s sends the host as SNI", async (_, tlsOptions) => {
    const servernames = await servernamesOf(startServer, port => new SQL({ ...options(port), ...tlsOptions }));
    expect(servernames).toEqual(["localhost"]);
  });

  test("tls: true next to a connection URL sends the URL host as SNI", async () => {
    const servernames = await servernamesOf(
      startServer,
      port => new SQL(`${adapter}://u@localhost:${port}/db`, { tls: true, max: 1 }),
    );
    expect(servernames).toEqual(["localhost"]);
  });

  test("each connection of a pool sends the host as SNI", async () => {
    const servernames = await servernamesOf(
      startServer,
      port => new SQL({ ...options(port), max: 3, tls: true }),
      async sql => {
        const reserved = await Promise.all([sql.reserve(), sql.reserve(), sql.reserve()]);
        for (const connection of reserved) connection.release();
      },
    );
    expect(servernames).toEqual(["localhost", "localhost", "localhost"]);
  });

  test("tls: true assigned to sql.options after construction sends the host as SNI", async () => {
    const servernames = await servernamesOf(startServer, port => {
      const sql = new SQL({ ...options(port), tls: "require" });
      sql.options.tls = true;
      return sql;
    });
    expect(servernames).toEqual(["localhost"]);
  });

  test.each(["serverName", "servername"])("an own tls.%s is sent in place of the host", async key => {
    const servernames = await servernamesOf(
      startServer,
      port => new SQL({ ...options(port), tls: { [key]: "db.example" } }),
    );
    expect(servernames).toEqual(["db.example"]);
  });

  test("an empty tls.serverName sends no SNI", async () => {
    const servernames = await servernamesOf(
      startServer,
      port => new SQL({ ...options(port), tls: { serverName: "" } }),
    );
    expect(servernames).toEqual([false]);
  });

  test("an IPv4 literal host is not sent as SNI", async () => {
    const servernames = await servernamesOf(startServer, port => new SQL({ ...options(port, "127.0.0.1"), tls: true }));
    expect(servernames).toEqual([false]);
  });

  test.skipIf(!isIPv6())("a bracketed IPv6 URL host is not sent as SNI", async () => {
    const servernames = await servernamesOf(
      startServer,
      port => new SQL(`${adapter}://u@[::1]:${port}/db`, { tls: true, max: 1 }),
      undefined,
      "::1",
    );
    expect(servernames).toEqual([false]);
  });

  // The next two cases run in a child process: a debug build that does not
  // name the host aborts on each of them.
  const child = (body: string) => `
    const { ADAPTER: adapter, PORT: port, CA: ca } = process.env;
    const options = { adapter, hostname: "localhost", port: Number(port), username: "u", database: "db", max: 1 };
    let sql;
    ${body}
    try {
      await sql.connect();
      console.log("CONNECTED");
    } catch (e) {
      console.log(e.message);
    }
    await sql.close({ timeout: 0 });
  `;

  test("verify-full matches the certificate against the host when the tls object has no serverName", async () => {
    const server = await startServer("127.0.0.1");
    try {
      const { stdout, exitCode } = await runInChild(
        child(`sql = new Bun.SQL({ ...options, tls: "verify-full" }); sql.options.tls = { ca };`),
        { ADAPTER: adapter, PORT: String(server.port), CA: localhostTls.cert },
      );
      expect(stdout).toBe("CONNECTED");
      expect(server.servernames).toEqual(["localhost"]);
      expect(exitCode).toBe(0);
    } finally {
      server.close();
    }
  });

  test("a host with a NUL byte is rejected before it becomes the TLS name", async () => {
    const { stdout, exitCode } = await runInChild(
      child(`sql = new Bun.SQL({ ...options, hostname: "local\\0host", tls: true });`),
      { ADAPTER: adapter, PORT: "1" },
    );
    expect(stdout).toBe("hostname must not contain null bytes");
    expect(exitCode).toBe(0);
  });
});

describe.concurrent("TLS with no serverName in the options", () => {
  const options = (adapter: "mariadb" | "postgres", port: number): Options => ({
    adapter,
    hostname: "localhost",
    port,
    username: "u",
    database: "db",
    max: 1,
    tls: true,
  });

  test("the mariadb adapter sends the host as SNI", async () => {
    const servernames = await servernamesOf(mysqlServer, port => new SQL(options("mariadb", port)));
    expect(servernames).toEqual(["localhost"]);
  });

  test("the sql.listen() connection sends the host as SNI", async () => {
    const servernames = await servernamesOf(
      postgresServer,
      port => new SQL(options("postgres", port)),
      sql => sql.listen("channel", () => {}),
    );
    expect(servernames).toEqual(["localhost"]);
  });
});
