import { describe, expect, it } from "bun:test";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import https from "node:https";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import tls, { connect, createServer, type PeerCertificate, type Server, type TLSSocket } from "node:tls";

// `tls.createSecureContext`'s documented object form of `key`:
// `key: [{ pem, passphrase? }]`, where a per-entry passphrase decrypts that key
// alone. rsa_private_encrypted.pem is rsa_private.pem encrypted with "password";
// both match rsa_cert.crt (self-signed, CN=localhost).
const fixtures = join(import.meta.dir, "fixtures");
const passKey = readFileSync(join(fixtures, "rsa_private_encrypted.pem"));
const rawKey = readFileSync(join(fixtures, "rsa_private.pem"));
const cert = readFileSync(join(fixtures, "rsa_cert.crt"));

describe("key: [{ pem, passphrase }]", () => {
  async function servedCertCN(serverOptions: object) {
    const server: Server = createServer(serverOptions, socket => socket.end());
    const { promise: failed, reject } = Promise.withResolvers<never>();
    server.on("error", reject);
    server.listen(0, "127.0.0.1");
    await Promise.race([once(server, "listening"), failed]);
    let client: TLSSocket | undefined;
    try {
      const { port } = server.address() as AddressInfo;
      client = connect({ port, host: "127.0.0.1", ca: [cert], servername: "localhost" });
      client.on("error", reject);
      await Promise.race([once(client, "secureConnect"), failed]);
      expect(client.authorized).toBe(true);
      return (client.getPeerCertificate() as PeerCertificate).subject.CN;
    } finally {
      client?.destroy();
      server.close();
    }
  }

  it("unwraps { pem } and serves the certificate", async () => {
    expect(await servedCertCN({ key: [{ pem: rawKey }], cert: [cert] })).toBe("localhost");
  });

  it("applies a per-entry passphrase", async () => {
    expect(await servedCertCN({ key: [{ pem: passKey, passphrase: "password" }], cert })).toBe("localhost");
  });

  it("falls back to options.passphrase when the entry has none", async () => {
    expect(await servedCertCN({ key: [{ pem: passKey }], passphrase: "password", cert })).toBe("localhost");
  });

  it("prefers the per-entry passphrase over options.passphrase", async () => {
    const options = { key: [{ pem: passKey, passphrase: "password" }], passphrase: "wrong", cert };
    expect(await servedCertCN(options)).toBe("localhost");
  });

  it("accepts raw entries alongside { pem } entries", async () => {
    const key = [rawKey, { pem: passKey, passphrase: "password" }];
    expect(await servedCertCN({ key, cert: [cert, cert] })).toBe("localhost");
  });

  it("works on https.createServer", async () => {
    const server = https.createServer({ key: [{ pem: rawKey }], cert }, (_req, res) => res.end("served"));
    const { promise: body, resolve, reject } = Promise.withResolvers<string>();
    server.on("error", reject);
    server.listen(0, "127.0.0.1");
    await Promise.race([once(server, "listening"), body]);
    try {
      const { port } = server.address() as AddressInfo;
      const req = https.get({ host: "127.0.0.1", port, ca: cert, servername: "localhost" }, res => {
        res.setEncoding("utf8");
        let text = "";
        res.on("data", chunk => (text += chunk));
        res.on("end", () => resolve(text));
        res.on("error", reject);
      });
      req.on("error", reject);
      expect(await body).toBe("served");
    } finally {
      server.close();
    }
  });

  it("works on a tls.connect client certificate", async () => {
    const server: Server = createServer({
      key: rawKey,
      cert,
      ca: [cert],
      requestCert: true,
      rejectUnauthorized: true,
    });
    const { promise, resolve, reject } = Promise.withResolvers<boolean>();
    server.on("secureConnection", socket => {
      resolve(socket.authorized);
      socket.end();
    });
    server.on("error", reject);
    server.listen(0, "127.0.0.1");
    await Promise.race([once(server, "listening"), promise]);
    let client: TLSSocket | undefined;
    try {
      const { port } = server.address() as AddressInfo;
      client = connect({
        port,
        host: "127.0.0.1",
        key: [{ pem: passKey, passphrase: "password" }],
        cert,
        ca: [cert],
        servername: "localhost",
      });
      client.on("error", reject);
      expect(await promise).toBe(true);
    } finally {
      client?.destroy();
      server.close();
    }
  });

  it("builds a secure context", () => {
    expect(() => tls.createSecureContext({ key: [{ pem: passKey, passphrase: "password" }], cert })).not.toThrow();
  });

  it("rejects a wrong per-entry passphrase", () => {
    expect(() => createServer({ key: [{ pem: passKey, passphrase: "wrong" }], cert })).toThrow(
      expect.objectContaining({ code: "ERR_OSSL_BAD_DECRYPT" }),
    );
  });

  it("rejects a non-string per-entry passphrase", () => {
    expect(() => createServer({ key: [{ pem: rawKey, passphrase: 7 }], cert })).toThrow(
      expect.objectContaining({
        code: "ERR_INVALID_ARG_TYPE",
        message: expect.stringContaining('The "options.passphrase" property must be of type string'),
      }),
    );
  });

  it("rejects an invalid pem value", () => {
    expect(() => createServer({ key: [{ pem: true }], cert })).toThrow(
      expect.objectContaining({
        code: "ERR_INVALID_ARG_TYPE",
        message: expect.stringContaining('The "options.key" property must be of type string'),
      }),
    );
  });

  it("rejects the object form outside of an array", () => {
    expect(() => createServer({ key: { pem: rawKey }, cert })).toThrow(
      expect.objectContaining({
        code: "ERR_INVALID_ARG_TYPE",
        message: expect.stringContaining('The "options.key" property must be of type string'),
      }),
    );
  });

  it("rejects the object form for cert, which only node's key option accepts", () => {
    expect(() => createServer({ key: rawKey, cert: [{ pem: cert }] })).toThrow(
      expect.objectContaining({
        code: "ERR_INVALID_ARG_TYPE",
        message: expect.stringContaining('The "options.cert" property must be of type string'),
      }),
    );
  });
});
