import { RedisClient } from "bun";
import { describe, expect, test } from "bun:test";
import { isWindows, tempDir, tls as localhostTls } from "harness";
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

async function withServer<T>(serverOpts: tls.TlsOptions, fn: (port: number) => Promise<T>): Promise<T> {
  const server = fakeServer(serverOpts);
  server.listen(0);
  await once(server, "listening");
  try {
    return await fn((server.address() as AddressInfo).port);
  } finally {
    server.close();
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
      expect(err.code).not.toBe("ERR_TLS_CERT_ALTNAME_INVALID");
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
