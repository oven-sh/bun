import { RedisClient } from "bun";
import { describe, expect, test } from "bun:test";
import { tls as localhostTls } from "harness";
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

// Minimal Redis-ish server. It replies +OK to the first command (HELLO) so the
// client's authentication handshake succeeds, then +PONG to everything else.
async function withServer<T>(serverOpts: tls.TlsOptions, fn: (port: number) => Promise<T>): Promise<T> {
  const server = tls.createServer(serverOpts, socket => {
    let first = true;
    socket.on("data", () => {
      if (first) {
        first = false;
        socket.write("+OK\r\n");
      } else {
        socket.write("+PONG\r\n");
      }
    });
    socket.on("error", () => {});
  });
  server.on("tlsClientError", () => {});
  server.listen(0);
  await once(server, "listening");
  try {
    return await fn((server.address() as AddressInfo).port);
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
  }, 15000);

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
  }, 15000);

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
  }, 15000);

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
  }, 15000);

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
  }, 15000);
});
