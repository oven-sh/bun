import { describe, expect, test } from "bun:test";
import { tls as COMMON_CERT } from "harness";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { connect, createServer, type Server } from "node:tls";

// Connecting to `port` must always produce one of these, never a hang.
type Handshake = { cipher: string; protocol: string | null } | { failed: string | undefined };

async function handshake(port: number, clientOptions: object = {}): Promise<Handshake> {
  const client = connect({ port, host: "127.0.0.1", rejectUnauthorized: false, ...clientOptions });
  try {
    await once(client, "secureConnect");
    return { cipher: client.getCipher().name, protocol: client.getProtocol() };
  } catch (err) {
    return { failed: (err as NodeJS.ErrnoException).code };
  } finally {
    client.destroy();
  }
}

async function withServer(options: object, fn: (port: number) => Promise<void>) {
  const server: Server = createServer({ ...COMMON_CERT, ...options });
  server.on("secureConnection", socket => socket.end());
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    await fn((server.address() as AddressInfo).port);
  } finally {
    server.close();
  }
  await once(server, "close");
}

describe("TLS 1.3 cipher suite names", () => {
  // The TLS 1.3 suite names belong to a separate OpenSSL API and must not reach
  // the TLS<=1.2 cipher-list parser, which rejects them.
  test("a cipher list naming only TLS 1.3 suites is accepted", async () => {
    await withServer({ ciphers: "TLS_CHACHA20_POLY1305_SHA256" }, async port => {
      const result = await handshake(port, { minVersion: "TLSv1.3" });
      expect(result).toMatchObject({ protocol: "TLSv1.3" });
    });
  });

  test("the protocol floor rises to TLS 1.3 when no TLS 1.2 cipher remains", async () => {
    await withServer({ ciphers: "TLS_CHACHA20_POLY1305_SHA256" }, async port => {
      expect(await handshake(port, { maxVersion: "TLSv1.2" })).toEqual({
        failed: "ERR_SSL_TLSV1_ALERT_PROTOCOL_VERSION",
      });
    });
  });

  // Bun.serve leaves the native maxVersion unset, unlike node:tls which always
  // resolves tls.DEFAULT_MAX_VERSION. The floor must still rise.
  test("Bun.serve accepts a TLS 1.3 only cipher list and raises the floor", async () => {
    using server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      tls: { ...COMMON_CERT, ciphers: "TLS_CHACHA20_POLY1305_SHA256" },
      fetch: () => new Response("ok"),
    });
    expect(await handshake(server.port, { minVersion: "TLSv1.3" })).toMatchObject({ protocol: "TLSv1.3" });
    expect(await handshake(server.port, { maxVersion: "TLSv1.2" })).toEqual({
      failed: "ERR_SSL_TLSV1_ALERT_PROTOCOL_VERSION",
    });
  });

  test("a mixed TLS 1.3 + TLS 1.2 list applies its TLS 1.2 half", async () => {
    await withServer({ ciphers: "TLS_CHACHA20_POLY1305_SHA256:ECDHE-RSA-AES128-GCM-SHA256" }, async port => {
      expect(await handshake(port, { maxVersion: "TLSv1.2" })).toEqual({
        cipher: "ECDHE-RSA-AES128-GCM-SHA256",
        protocol: "TLSv1.2",
      });
      expect(await handshake(port, { minVersion: "TLSv1.3" })).toMatchObject({ protocol: "TLSv1.3" });
    });
  });

  test("an unknown TLS_ name is still rejected", () => {
    expect(() => createServer({ ...COMMON_CERT, ciphers: "TLS_not_a_cipher" })).toThrow({
      code: "ERR_SSL_NO_CIPHER_MATCH",
      message: "No cipher match",
      library: "SSL routines",
      reason: "no cipher match",
    });
  });
});

describe("honorCipherOrder", () => {
  // SSL_OP_CIPHER_SERVER_PREFERENCE: the server's list decides, not the
  // client's. The two sides below disagree on purpose.
  const serverCiphers = "ECDHE-RSA-CHACHA20-POLY1305:ECDHE-RSA-AES128-GCM-SHA256";
  const clientCiphers = "ECDHE-RSA-AES128-GCM-SHA256:ECDHE-RSA-CHACHA20-POLY1305";

  test.each([
    ["defaults to on", {}, "ECDHE-RSA-CHACHA20-POLY1305"],
    ["is honored when true", { honorCipherOrder: true }, "ECDHE-RSA-CHACHA20-POLY1305"],
    ["yields to the client when false", { honorCipherOrder: false }, "ECDHE-RSA-AES128-GCM-SHA256"],
  ])("honorCipherOrder %s", async (_label, serverOptions, expected) => {
    await withServer({ ciphers: serverCiphers, maxVersion: "TLSv1.2", ...serverOptions }, async port => {
      expect(await handshake(port, { ciphers: clientCiphers, maxVersion: "TLSv1.2" })).toEqual({
        cipher: expected,
        protocol: "TLSv1.2",
      });
    });
  });

  test("applies to a secure context handed to setSecureContext", async () => {
    const server: Server = createServer({ ...COMMON_CERT });
    server.setSecureContext({ ...COMMON_CERT, ciphers: serverCiphers, maxVersion: "TLSv1.2" });
    server.on("secureConnection", socket => socket.end());
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    try {
      const port = (server.address() as AddressInfo).port;
      expect(await handshake(port, { ciphers: clientCiphers, maxVersion: "TLSv1.2" })).toEqual({
        cipher: "ECDHE-RSA-CHACHA20-POLY1305",
        protocol: "TLSv1.2",
      });
    } finally {
      server.close();
    }
    await once(server, "close");
  });
});
