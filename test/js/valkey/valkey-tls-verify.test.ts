import { RedisClient } from "bun";
import { describe, expect, test } from "bun:test";
import { isIPv6, isWindows, tls as localhostTls, tempDir } from "harness";
import { once } from "node:events";
import fs from "node:fs";
import type { AddressInfo } from "node:net";
import path from "node:path";
import tls from "node:tls";

// Server presents a cert for CN=agent1 (no SAN), signed by ca1.
// A client connecting to host "localhost" with ca1 trusted will pass chain
// verification but MUST fail hostname verification (localhost != agent1).
const fixturesDir = path.join(import.meta.dirname, "..", "node", "tls", "fixtures");
const serverKey = fs.readFileSync(path.join(fixturesDir, "agent1-key.pem"));
const serverCert = fs.readFileSync(path.join(fixturesDir, "agent1-cert.pem"));
const ca = fs.readFileSync(path.join(fixturesDir, "ca1-cert.pem"));

// Consume one complete RESP array (*N\r\n followed by N bulk strings) from the
// front of `buf`. Returns the number of bytes consumed, or 0 if incomplete.
function consumeRespArray(buf: Buffer): number {
  if (buf.length < 4 || buf[0] !== 0x2a /* '*' */) return 0;
  let eol = buf.indexOf("\r\n");
  if (eol < 0) return 0;
  const count = parseInt(buf.subarray(1, eol).toString("latin1"), 10);
  let off = eol + 2;
  for (let i = 0; i < count; i++) {
    if (off >= buf.length || buf[off] !== 0x24 /* '$' */) return 0;
    eol = buf.indexOf("\r\n", off);
    if (eol < 0) return 0;
    const len = parseInt(buf.subarray(off + 1, eol).toString("latin1"), 10);
    off = eol + 2 + len + 2;
    if (off > buf.length) return 0;
  }
  return off;
}

// Minimal Redis-ish server. It replies +OK to the first command (HELLO) so the
// client's authentication handshake succeeds, then +PONG to everything else.
// Buffers and frames RESP arrays so commands split across packets (or batched
// into one) are each answered exactly once.
function fakeServer(serverOpts: tls.TlsOptions): tls.Server {
  const server = tls.createServer(serverOpts, socket => {
    let buf = Buffer.alloc(0);
    let seen = 0;
    socket.on("data", chunk => {
      buf = Buffer.concat([buf, chunk]);
      let consumed: number;
      while ((consumed = consumeRespArray(buf)) > 0) {
        buf = buf.subarray(consumed);
        socket.write(seen++ === 0 ? "+OK\r\n" : "+PONG\r\n");
      }
    });
    socket.on("error", () => {});
  });
  server.on("tlsClientError", () => {});
  return server;
}

async function withServer<T>(
  serverOpts: tls.TlsOptions,
  fn: (port: number, server: tls.Server) => Promise<T>,
  host?: string,
): Promise<T> {
  const server = fakeServer(serverOpts);
  server.listen(0, host);
  await once(server, "listening");
  try {
    return await fn((server.address() as AddressInfo).port, server);
  } finally {
    server.close();
  }
}

/** The SNI names the server saw, one entry per completed handshake. */
function recordServernames(server: tls.Server): (string | false)[] {
  const names: (string | false)[] = [];
  server.on("secureConnection", socket => names.push(socket.servername));
  return names;
}

async function ping(url: string, tlsOptions: Bun.RedisOptions["tls"]): Promise<unknown> {
  const client = new RedisClient(url, { autoReconnect: false, connectionTimeout: 5000, tls: tlsOptions });
  try {
    return await client.send("PING", []);
  } finally {
    client.close();
  }
}

async function withUnixServer<T>(serverOpts: tls.TlsOptions, fn: (socketPath: string) => Promise<T>): Promise<T> {
  using dir = tempDir("valkey-tls-unix", {});
  const socketPath = path.join(String(dir), "r.sock");
  const server = fakeServer(serverOpts);
  server.listen(socketPath);
  await once(server, "listening");
  try {
    return await fn(socketPath);
  } finally {
    server.close();
  }
}

describe("RedisClient TLS hostname verification", () => {
  test("rejects a CA-trusted cert whose hostname does not match the URL host", async () => {
    await withServer({ key: serverKey, cert: serverCert }, async port => {
      const client = new RedisClient(`rediss://localhost:${port}`, {
        autoReconnect: false,
        connectionTimeout: 5000,
        tls: {
          ca,
          rejectUnauthorized: true,
        },
      });
      let err: any;
      try {
        await client.send("PING", []);
      } catch (e) {
        err = e;
      } finally {
        client.close();
      }
      expect(err).toBeInstanceOf(Error);
      expect(err.code).toBe("ERR_TLS_CERT_ALTNAME_INVALID");
      expect(err.message).toContain("localhost");
    });
  });

  test("rejects a CA-trusted cert whose altnames do not match an IP host", async () => {
    // The "harness" cert is valid for localhost/127.0.0.1. Connect via 127.0.0.1
    // to a server presenting the agent1 cert (CN=agent1, signed by ca1).
    await withServer({ key: serverKey, cert: serverCert }, async port => {
      const client = new RedisClient(`rediss://127.0.0.1:${port}`, {
        autoReconnect: false,
        connectionTimeout: 5000,
        tls: {
          ca,
          rejectUnauthorized: true,
        },
      });
      let err: any;
      try {
        await client.send("PING", []);
      } catch (e) {
        err = e;
      } finally {
        client.close();
      }
      expect(err).toBeInstanceOf(Error);
      expect(err.code).toBe("ERR_TLS_CERT_ALTNAME_INVALID");
    });
  });

  test("still rejects invalid certificate chains when rejectUnauthorized is true", async () => {
    // Self-signed cert that the client does NOT trust.
    await withServer({ key: localhostTls.key, cert: localhostTls.cert }, async port => {
      const client = new RedisClient(`rediss://localhost:${port}`, {
        autoReconnect: false,
        connectionTimeout: 5000,
        tls: {
          rejectUnauthorized: true,
        },
      });
      let err: any;
      try {
        await client.send("PING", []);
      } catch (e) {
        err = e;
      } finally {
        client.close();
      }
      expect(err).toBeInstanceOf(Error);
      // Should be the BoringSSL verify error, not the hostname error.
      expect(err.code).toBe("DEPTH_ZERO_SELF_SIGNED_CERT");
      expect(err.message).toContain("self signed certificate");
    });
  });

  test("allows mismatched hostname when rejectUnauthorized is false", async () => {
    await withServer({ key: serverKey, cert: serverCert }, async port => {
      const client = new RedisClient(`rediss://localhost:${port}`, {
        autoReconnect: false,
        connectionTimeout: 5000,
        tls: {
          ca,
          rejectUnauthorized: false,
        },
      });
      try {
        const result = await client.send("PING", []);
        expect(result).toBe("PONG");
      } finally {
        client.close();
      }
    });
  });

  test.skipIf(!isIPv6())("accepts a cert whose IP altnames match a bracketed IPv6 URL host", async () => {
    // The "harness" cert has SAN IP:::1. URL.host() serialises IPv6 literals
    // with brackets ("[::1]"), which must be stripped before IP SAN matching.
    await withServer(
      { key: localhostTls.key, cert: localhostTls.cert },
      async port => {
        const client = new RedisClient(`rediss://[::1]:${port}`, {
          autoReconnect: false,
          connectionTimeout: 5000,
          tls: {
            ca: localhostTls.cert,
            rejectUnauthorized: true,
          },
        });
        try {
          const result = await client.send("PING", []);
          expect(result).toBe("PONG");
        } finally {
          client.close();
        }
      },
      "::1",
    );
  });

  test("accepts a cert whose altnames match the URL host", async () => {
    // The "harness" cert has SAN: DNS:localhost, IP:127.0.0.1, IP:::1
    await withServer({ key: localhostTls.key, cert: localhostTls.cert }, async port => {
      const client = new RedisClient(`rediss://localhost:${port}`, {
        autoReconnect: false,
        connectionTimeout: 5000,
        tls: {
          ca: localhostTls.cert,
          rejectUnauthorized: true,
        },
      });
      try {
        const result = await client.send("PING", []);
        expect(result).toBe("PONG");
      } finally {
        client.close();
      }
    });
  });

  test.skipIf(isWindows)("skips hostname verification for redis+tls+unix:// sockets", async () => {
    // Unix-domain sockets have no hostname; a CA-trusted cert for the wrong
    // CN must still be accepted as long as the chain validates.
    await withUnixServer({ key: serverKey, cert: serverCert }, async socketPath => {
      const client = new RedisClient(`redis+tls+unix://${socketPath}`, {
        autoReconnect: false,
        connectionTimeout: 5000,
        tls: {
          ca,
          rejectUnauthorized: true,
        },
      });
      try {
        const result = await client.send("PING", []);
        expect(result).toBe("PONG");
      } finally {
        client.close();
      }
    });
  });
});

describe("RedisClient tls.serverName", () => {
  test("sends the URL host as SNI by default", async () => {
    await withServer({ key: localhostTls.key, cert: localhostTls.cert }, async (port, server) => {
      const servernames = recordServernames(server);
      expect(await ping(`rediss://localhost:${port}`, { ca: localhostTls.cert })).toBe("PONG");
      expect(servernames).toEqual(["localhost"]);
    });
  });

  test("does not send an IP literal as SNI", async () => {
    await withServer({ key: localhostTls.key, cert: localhostTls.cert }, async (port, server) => {
      const servernames = recordServernames(server);
      expect(await ping(`rediss://127.0.0.1:${port}`, { ca: localhostTls.cert })).toBe("PONG");
      // One handshake, no SNI.
      expect(servernames.map(Boolean)).toEqual([false]);
    });
  });

  // `servername` is the node:tls spelling of the same option.
  test.each(["serverName", "servername"] as const)(
    "%s sets the SNI and the name the certificate is verified against",
    async key => {
      // The server presents CN=agent1; dialing 127.0.0.1 only verifies when the
      // client checks the certificate against "agent1" instead of the URL host.
      await withServer({ key: serverKey, cert: serverCert }, async (port, server) => {
        const servernames = recordServernames(server);
        expect(await ping(`rediss://127.0.0.1:${port}`, { ca, [key]: "agent1" })).toBe("PONG");
        expect(servernames).toEqual(["agent1"]);
      });
    },
  );

  test("serverName that does not match the certificate is rejected", async () => {
    await withServer({ key: localhostTls.key, cert: localhostTls.cert }, async port => {
      const err: any = await ping(`rediss://localhost:${port}`, { ca: localhostTls.cert, serverName: "agent1" }).then(
        () => null,
        e => e,
      );
      expect(err?.code).toBe("ERR_TLS_CERT_ALTNAME_INVALID");
      expect(err.message).toContain("agent1");
    });
  });
});

describe("RedisClient tls.checkServerIdentity", () => {
  test("is called with the hostname and certificate, and the Error it returns rejects the connection", async () => {
    await withServer({ key: localhostTls.key, cert: localhostTls.cert }, async port => {
      const calls: [string, string][] = [];
      const pin = new Error("PIN_MISMATCH");
      const err = await ping(`rediss://localhost:${port}`, {
        ca: localhostTls.cert,
        checkServerIdentity: (hostname: string, cert: tls.PeerCertificate) => {
          calls.push([hostname, cert.subject.CN]);
          return pin;
        },
      }).then(
        () => null,
        e => e,
      );
      expect(err).toBe(pin);
      // The harness certificate: CN=server-bun, SAN localhost/127.0.0.1/::1.
      expect(calls).toEqual([["localhost", "server-bun"]]);
    });
  });

  test("replaces the built-in hostname check when it returns undefined", async () => {
    // CN=agent1 does not match "localhost": only the callback can accept it.
    await withServer({ key: serverKey, cert: serverCert }, async port => {
      const calls: [string, string][] = [];
      const result = await ping(`rediss://localhost:${port}`, {
        ca,
        checkServerIdentity: (hostname: string, cert: tls.PeerCertificate) => {
          calls.push([hostname, cert.subject.CN]);
          return undefined;
        },
      });
      expect(result).toBe("PONG");
      expect(calls).toEqual([["localhost", "agent1"]]);
    });
  });

  test("receives tls.serverName as the hostname", async () => {
    await withServer({ key: serverKey, cert: serverCert }, async port => {
      const hostnames: string[] = [];
      const result = await ping(`rediss://127.0.0.1:${port}`, {
        ca,
        serverName: "agent1",
        checkServerIdentity: (hostname: string) => {
          hostnames.push(hostname);
          return undefined;
        },
      });
      expect(result).toBe("PONG");
      expect(hostnames).toEqual(["agent1"]);
    });
  });

  test("an exception thrown by the callback rejects the connection", async () => {
    await withServer({ key: localhostTls.key, cert: localhostTls.cert }, async port => {
      const thrown = new TypeError("from checkServerIdentity");
      const err = await ping(`rediss://localhost:${port}`, {
        ca: localhostTls.cert,
        checkServerIdentity: () => {
          throw thrown;
        },
      }).then(
        () => null,
        e => e,
      );
      expect(err).toBe(thrown);
    });
  });

  test("is not called when the certificate chain fails to verify", async () => {
    // No `ca`: the self-signed localhost certificate is untrusted. A tls object
    // whose only member is the callback still enables TLS with default options.
    await withServer({ key: localhostTls.key, cert: localhostTls.cert }, async port => {
      let calls = 0;
      const err: any = await ping(`rediss://localhost:${port}`, {
        checkServerIdentity: () => {
          calls++;
          return undefined;
        },
      }).then(
        () => null,
        e => e,
      );
      expect(err?.code).toBe("DEPTH_ZERO_SELF_SIGNED_CERT");
      expect(calls).toBe(0);
    });
  });

  test("is not called when rejectUnauthorized is false", async () => {
    await withServer({ key: serverKey, cert: serverCert }, async port => {
      let calls = 0;
      const result = await ping(`rediss://localhost:${port}`, {
        ca,
        rejectUnauthorized: false,
        checkServerIdentity: () => {
          calls++;
          return new Error("unreachable");
        },
      });
      expect(result).toBe("PONG");
      expect(calls).toBe(0);
    });
  });

  test("must be a function", () => {
    expect(() => new RedisClient("rediss://localhost:6379", { tls: { checkServerIdentity: "nope" as any } })).toThrow(
      expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" }),
    );
  });
});
