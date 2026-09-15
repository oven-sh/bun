// `tls.checkServerIdentity`, `tls.serverName` / `tls.servername` and the
// built-in hostname check for Bun.SQL over TLS (PostgreSQL and MySQL).
//
// These need a server that presents a certificate for a name of the test's
// choosing, which the shared containers cannot do, so both adapters talk to a
// minimal mock that upgrades to TLS and accepts the login. All wire-protocol
// bytes come from test/js/sql/wire-frames.ts.

import { SQL } from "bun";
import { describe, expect, test } from "bun:test";
import { tls as localhostTls } from "harness";
import { X509Certificate } from "node:crypto";
import fs from "node:fs";
import type net from "node:net";
import path from "node:path";
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

// CN=agent1 (no SAN), signed by ca1: trusted through `ca1` but valid for no
// host the tests dial, so only `serverName: "agent1"` or a custom
// `checkServerIdentity` can accept it.
const fixturesDir = path.join(import.meta.dirname, "..", "node", "tls", "fixtures");
const agent1 = {
  key: fs.readFileSync(path.join(fixturesDir, "agent1-key.pem"), "utf8"),
  cert: fs.readFileSync(path.join(fixturesDir, "agent1-cert.pem"), "utf8"),
  ca: fs.readFileSync(path.join(fixturesDir, "ca1-cert.pem"), "utf8"),
};
// The harness certificate: CN=server-bun, SAN localhost / 127.0.0.1 / ::1, self-signed.
const localhost = { key: localhostTls.key, cert: localhostTls.cert, ca: localhostTls.cert };

type ServerCert = { key: string; cert: string };
type MockServer = {
  url: string;
  /** SNI of every completed TLS handshake, in order. */
  servernames: (string | false)[];
  close(): void;
};

/**
 * Wraps `rawSocket` in a server-side TLSSocket once the plaintext prelude is
 * done. Bytes already buffered past the prelude are TLS records: hand them to
 * the TLS engine instead of the plaintext parser.
 */
function upgrade(rawSocket: net.Socket, cert: ServerCert, leftover: Buffer, servernames: (string | false)[]) {
  rawSocket.pause();
  if (leftover.length) rawSocket.unshift(leftover);
  const socket = new tls.TLSSocket(rawSocket, { isServer: true, ...cert });
  socket.on("secure", () => servernames.push(socket.servername));
  socket.on("error", () => {});
  return socket;
}

/** Answers SSLRequest with 'S', upgrades, then accepts any StartupMessage. */
async function postgresServer(cert: ServerCert): Promise<MockServer> {
  const servernames: (string | false)[] = [];
  const { server, port } = await listeningServer(rawSocket => {
    rawSocket.on("error", () => {});
    rawSocket.once("data", (chunk: Buffer) => {
      // SSLRequest is Int32(8) Int32(80877103); the client sends nothing else
      // until it has the one-byte answer.
      rawSocket.write(pgSSLResponse("S"));
      const socket = upgrade(rawSocket, cert, chunk.subarray(8), servernames);
      let startup = true;
      socket.on("data", () => {
        if (startup) {
          startup = false;
          socket.write(Buffer.concat([pgAuthenticationOk(), pgReadyForQuery()]));
        }
      });
    });
  });
  return { url: `postgres://u@127.0.0.1:${port}/db`, servernames, close: () => server.close() };
}

/** Advertises CLIENT_SSL, upgrades after the SSLRequest packet, then accepts the login. */
async function mysqlServer(cert: ServerCert): Promise<MockServer> {
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
      const socket = upgrade(rawSocket, cert, leftover, servernames);
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
  });
  return { url: `mysql://u@127.0.0.1:${port}/db`, servernames, close: () => server.close() };
}

async function connect(url: string, tlsOptions: Bun.SQL.Options["tls"], sslmode = "verify-full"): Promise<unknown> {
  await using sql = new SQL({ url: `${url}?sslmode=${sslmode}`, tls: tlsOptions, max: 1, idleTimeout: 1 });
  return await sql.connect().then(
    () => "CONNECTED",
    e => e,
  );
}

describe.each([
  ["PostgreSQL", "postgres", postgresServer],
  ["MySQL", "mysql", mysqlServer],
] as const)("%s TLS server identity", (_, scheme, startServer) => {
  async function withServer<T>(cert: ServerCert, fn: (server: MockServer) => Promise<T>): Promise<T> {
    const server = await startServer(cert);
    try {
      return await fn(server);
    } finally {
      server.close();
    }
  }

  test("verify-full rejects a trusted certificate issued for another host with ERR_TLS_CERT_ALTNAME_INVALID", async () => {
    await withServer(agent1, async server => {
      const err: any = await connect(server.url, { ca: agent1.ca });
      expect(err?.code).toBe("ERR_TLS_CERT_ALTNAME_INVALID");
      // Node's reason text names the host that was checked.
      expect(err.message).toContain("127.0.0.1");
    });
  });

  // `servername` is the node:tls spelling of the same option.
  test.each(["serverName", "servername"] as const)(
    "tls.%s sets the SNI and the name the certificate is verified against",
    async key => {
      await withServer(agent1, async server => {
        expect(await connect(server.url, { ca: agent1.ca, [key]: "agent1" })).toBe("CONNECTED");
        expect(server.servernames).toEqual(["agent1"]);
      });
    },
  );

  test("tls.checkServerIdentity is called with the hostname and certificate, and the Error it returns fails the connection", async () => {
    await withServer(localhost, async server => {
      const calls: [string, string, string][] = [];
      const pin = new Error("PIN_MISMATCH");
      const err = await connect(server.url, {
        ca: localhost.ca,
        checkServerIdentity: (hostname: string, cert: tls.PeerCertificate) => {
          calls.push([hostname, cert.subject.CN, cert.fingerprint256]);
          return pin;
        },
      });
      expect(err).toBe(pin);
      const fingerprint256 = new X509Certificate(localhost.cert).fingerprint256;
      expect(calls).toEqual([["127.0.0.1", "server-bun", fingerprint256]]);
    });
  });

  test("tls.checkServerIdentity replaces the built-in hostname check when it returns undefined", async () => {
    await withServer(agent1, async server => {
      const calls: [string, string][] = [];
      const result = await connect(server.url, {
        ca: agent1.ca,
        checkServerIdentity: (hostname: string, cert: tls.PeerCertificate) => {
          calls.push([hostname, cert.subject.CN]);
          return undefined;
        },
      });
      expect(result).toBe("CONNECTED");
      expect(calls).toEqual([["127.0.0.1", "agent1"]]);
    });
  });

  test("tls.checkServerIdentity receives tls.serverName as the hostname", async () => {
    await withServer(agent1, async server => {
      const hostnames: string[] = [];
      const result = await connect(server.url, {
        ca: agent1.ca,
        serverName: "agent1",
        checkServerIdentity: (hostname: string) => {
          hostnames.push(hostname);
          return undefined;
        },
      });
      expect(result).toBe("CONNECTED");
      expect(hostnames).toEqual(["agent1"]);
    });
  });

  test("an exception thrown by tls.checkServerIdentity fails the connection", async () => {
    await withServer(localhost, async server => {
      const thrown = new TypeError("from checkServerIdentity");
      const err = await connect(server.url, {
        ca: localhost.ca,
        checkServerIdentity: () => {
          throw thrown;
        },
      });
      expect(err).toBe(thrown);
    });
  });

  test("tls.checkServerIdentity also runs under sslmode=verify-ca", async () => {
    await withServer(agent1, async server => {
      const pin = new Error("PIN_MISMATCH");
      expect(await connect(server.url, { ca: agent1.ca, checkServerIdentity: () => pin }, "verify-ca")).toBe(pin);
      // Without a callback verify-ca does not check the hostname.
      expect(await connect(server.url, { ca: agent1.ca }, "verify-ca")).toBe("CONNECTED");
    });
  });

  test("tls.checkServerIdentity requests certificate verification like tls.ca does", async () => {
    // No `ca` and no verify-* sslmode: the callback alone turns verification
    // on, so the untrusted self-signed chain fails before the callback runs.
    await withServer(localhost, async server => {
      let calls = 0;
      const err: any = await connect(
        server.url,
        {
          checkServerIdentity: () => {
            calls++;
            return undefined;
          },
        },
        "prefer",
      );
      expect(err?.code).toBe("DEPTH_ZERO_SELF_SIGNED_CERT");
      expect(calls).toBe(0);
    });
  });

  test("tls.checkServerIdentity is not called when rejectUnauthorized is false", async () => {
    await withServer(agent1, async server => {
      let calls = 0;
      const result = await connect(
        server.url,
        {
          ca: agent1.ca,
          rejectUnauthorized: false,
          checkServerIdentity: () => {
            calls++;
            return new Error("unreachable");
          },
        },
        "require",
      );
      expect(result).toBe("CONNECTED");
      expect(calls).toBe(0);
    });
  });

  test("tls.checkServerIdentity must be a function", () => {
    expect(() => new SQL({ url: `${scheme}://u@127.0.0.1:1/db`, tls: { checkServerIdentity: "nope" as any } })).toThrow(
      expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" }),
    );
  });
});
