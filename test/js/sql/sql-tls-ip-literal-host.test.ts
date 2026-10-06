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
import { isIPv6, tls as localhostTls } from "harness";
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
  pgReadyForQuery,
  pgSSLResponse,
} from "./wire-frames";

type MockServer = {
  port: number;
  /** SNI of every completed TLS handshake, in order; `false` when the client sent none. */
  servernames: (string | false)[];
  /** How many connections sent their login over TLS. */
  logins: number;
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

/** Answers SSLRequest with 'S', upgrades, then accepts any StartupMessage. */
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
        mock.logins++;
        socket.write(Buffer.concat([pgAuthenticationOk(), pgReadyForQuery()]));
      });
    });
  }, host);
  const mock = { port, servernames, logins: 0, close: () => server.close() };
  return mock;
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
            mock.logins++;
            socket.write(mysqlOkPacket(seq + 1));
            return;
          }
          if (!mysqlAckSessionSetup(socket, payload)) socket.end();
        });
      });
    };
    rawSocket.on("data", onPlainData);
  }, host);
  const mock = { port, servernames, logins: 0, close: () => server.close() };
  return mock;
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

describe.concurrent.each([
  ["PostgreSQL", "postgres", postgresServer],
  ["MySQL", "mysql", mysqlServer],
] as const)("%s TLS to an IP-literal host", (_, scheme, startServer) => {
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

describe.each([
  ["PostgreSQL", "postgres", postgresServer, "TLS_POSTGRES_DATABASE_URL"],
  ["MySQL", "mysql", mysqlServer, "TLS_MYSQL_DATABASE_URL"],
] as const)("%s TLS by every way of asking for it", (_, scheme, startServer, urlVariable) => {
  type Row = [query: string, options: SQL.Options, env?: Record<string, string>];

  /** Dials a new server as "localhost". With `env`, the URL is in `urlVariable` and not in the options. */
  async function dial([query, options, env]: Row) {
    const server = await startServer("127.0.0.1");
    const url = `${scheme}://u@localhost:${server.port}/db${query}`;
    const variables = { ...env, ...(env && { [urlVariable]: url }) };
    // The constructor reads the environment.
    Object.assign(process.env, variables);
    let sql: SQL;
    try {
      sql = new SQL({ ...(!env && { url }), max: 1, ...options });
    } finally {
      for (const key in variables) delete process.env[key];
    }
    try {
      const outcome = await sql.connect().then(
        () => "CONNECTED",
        e => e.code,
      );
      return { outcome, servernames: server.servernames, logins: server.logins };
    } finally {
      await sql.close({ timeout: 0 });
      server.close();
    }
  }
  const dialAll = async (rows: Row[]) =>
    Object.fromEntries(await Promise.all(rows.map(async row => [JSON.stringify(row), await dial(row)])));
  const expectAll = (rows: Row[], outcome: object) =>
    Object.fromEntries(rows.map(row => [JSON.stringify(row), outcome]));

  test("the host name is sent as SNI", async () => {
    const rows: Row[] = [
      ["", { tls: true }],
      ["", { tls: {} }],
      ["", { tls: { rejectUnauthorized: false } }],
      ["", { ssl: true }],
      ["", { tls: "require" }],
      ["?sslmode=require", {}],
      ["?ssl=true", {}],
      ["", {}, {}],
    ];
    expect(await dialAll(rows)).toEqual(
      expectAll(rows, { outcome: "CONNECTED", servernames: ["localhost"], logins: 1 }),
    );
  });

  // The certificate is self-signed, and these give no `ca`.
  test("verify-ca and verify-full refuse an untrusted certificate, wherever they are stated", async () => {
    const rows = (["verify-ca", "verify-full"] as const).flatMap((mode): Row[] => [
      [`?sslmode=${mode}`, {}],
      [`?sslmode=${mode}`, { tls: true }],
      [`?sslmode=${mode}&ssl=true`, {}],
      [`?sslmode=${mode}`, {}, {}],
      ["", { tls: mode }],
      ["", { ssl: mode }],
      ["", { ssl: mode }, {}],
      ["", { ssl: mode, tls: true }],
      ["", { ssl: mode, tls: {} }],
      ["", { ssl: mode, tls: "require" }],
      ["?sslmode=require", { ssl: mode, tls: true }],
      ...(scheme === "postgres"
        ? ([
            ["", {}, { PGSSLMODE: mode }],
            ["", { tls: true }, { PGSSLMODE: mode }],
            ["?ssl=true", {}, { PGSSLMODE: mode }],
          ] as Row[])
        : []),
    ]);
    expect(await dialAll(rows)).toEqual(
      expectAll(rows, { outcome: "DEPTH_ZERO_SELF_SIGNED_CERT", servernames: [], logins: 0 }),
    );
  });

  test("what verify-ca and verify-full check once the certificate is trusted", async () => {
    const ca = localhostTls.cert;
    const connected = (servername: string) => ({ outcome: "CONNECTED", servernames: [servername], logins: 1 });
    expect(
      await Promise.all([
        dial(["", { ssl: "verify-full", tls: { ca } }]),
        dial(["", { ssl: "verify-full", tls: { ca, serverName: "other.example" } }]),
        dial(["?sslmode=verify-ca", { tls: { ca, serverName: "other.example" } }]),
        dial(["", { ssl: "verify-full", tls: { rejectUnauthorized: false } }]),
      ]),
    ).toEqual([
      connected("localhost"),
      { outcome: "ERR_TLS_CERT_ALTNAME_INVALID", servernames: [], logins: 0 },
      connected("other.example"),
      connected("localhost"),
    ]);
  });
});
