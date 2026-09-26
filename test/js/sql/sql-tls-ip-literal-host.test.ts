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
      socket.once("data", () => socket.write(Buffer.concat([pgAuthenticationOk(), pgReadyForQuery()])));
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
