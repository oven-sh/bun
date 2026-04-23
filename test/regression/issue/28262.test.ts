import { expect, test } from "bun:test";
import { once } from "node:events";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import tls from "node:tls";

const fixturesDir = path.join(import.meta.dirname, "../../js/node/tls/fixtures");
const serverCert = fs.readFileSync(path.join(fixturesDir, "agent1-cert.pem"));
const serverKey = fs.readFileSync(path.join(fixturesDir, "agent1-key.pem"));
const caCert = fs.readFileSync(path.join(fixturesDir, "ca1-cert.pem"));

async function withTlsClient(check: (socket: tls.TLSSocket) => void, cert: Buffer = serverCert) {
  const server = tls.createServer({ key: serverKey, cert }, s => s.end());
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const { port } = server.address() as net.AddressInfo;
    const socket = tls.connect({
      host: "127.0.0.1",
      port,
      ca: [caCert],
      servername: "agent1",
      checkServerIdentity: () => undefined,
    });
    await once(socket, "secureConnect");
    try {
      check(socket);
    } finally {
      socket.destroy();
    }
  } finally {
    server.close();
  }
}

test("getPeerCertificate(false) returns abbreviated cert with fingerprint256", async () => {
  // Core regression: getPeerCertificate(false) should return the abbreviated
  // peer cert (same as no args), NOT an empty object. The mariadb npm package
  // calls getPeerCertificate(false) and reads .fingerprint256.
  await withTlsClient(socket => {
    const cert = socket.getPeerCertificate(false);
    expect(cert).toBeDefined();
    expect(typeof cert).toBe("object");
    expect(cert.subject.CN).toBe("agent1");
    expect(typeof cert.fingerprint256).toBe("string");
    expect(cert.fingerprint256).toContain(":");
  });
});

test("getPeerCertificate() returns abbreviated cert (no args)", async () => {
  await withTlsClient(socket => {
    const cert = socket.getPeerCertificate();
    expect(cert).toBeDefined();
    expect(cert.subject.CN).toBe("agent1");
    expect(typeof cert.fingerprint256).toBe("string");
    expect(cert.issuerCertificate).toBeUndefined();
  });
});

test("getPeerCertificate(true) returns detailed cert with issuerCertificate", async () => {
  // Server sends the full chain (leaf + CA) so the client receives the issuer
  // certificate from the handshake.
  await withTlsClient(
    socket => {
      const cert = socket.getPeerCertificate(true);
      expect(cert).toBeDefined();
      expect(cert.subject.CN).toBe("agent1");
      expect(cert.fingerprint256).toBeDefined();
      expect(cert.issuerCertificate).toBeDefined();
      expect(typeof cert.issuerCertificate).toBe("object");
      expect(cert.issuerCertificate.subject.CN).toBe("ca1");
      // ca1 is self-signed, so its issuerCertificate points to itself (Node.js
      // convention for detecting the root of the chain).
      expect(cert.issuerCertificate.issuerCertificate).toBe(cert.issuerCertificate);
    },
    Buffer.concat([serverCert, caCert]),
  );
});

test("getPeerCertificate(false) works with socket upgrade pattern (mariadb)", async () => {
  // Simulate the mariadb npm package pattern: plain TCP connect, then upgrade
  // to TLS via tls.connect({ socket }), then getPeerCertificate(false) and
  // read .fingerprint256.
  const server = tls.createServer({ key: serverKey, cert: serverCert }, s => s.end());
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const { port } = server.address() as net.AddressInfo;
    const tcpSocket = net.connect({ host: "127.0.0.1", port });
    await once(tcpSocket, "connect");
    // Upgrade to TLS (mariadb pattern — no servername, no host)
    const tlsSocket = tls.connect({ socket: tcpSocket, ca: [caCert], checkServerIdentity: () => undefined });
    await once(tlsSocket, "secureConnect");
    try {
      const serverCertObj = tlsSocket.getPeerCertificate(false);
      expect(typeof serverCertObj).toBe("object");
      // Exact mariadb driver code path that broke:
      const fingerprint = serverCertObj ? serverCertObj.fingerprint256.replace(/:/gi, "").toLowerCase() : null;
      expect(typeof fingerprint).toBe("string");
      expect(fingerprint!.length).toBe(64); // SHA256 = 32 bytes = 64 hex chars
    } finally {
      tlsSocket.destroy();
    }
  } finally {
    server.close();
  }
});

test("getPeerCertificate(true) does not self-reference non-self-signed leaf", async () => {
  // Server sends only the leaf cert (no CA in the chain). The leaf is NOT
  // self-signed, so per Node.js semantics issuerCertificate must never be a
  // self-reference. Node.js additionally looks the issuer up in the client's
  // local trust store and appends it. This matters because code commonly
  // walks the chain via `while (c !== c.issuerCertificate)`.
  await withTlsClient(socket => {
    const cert = socket.getPeerCertificate(true);
    expect(cert).toBeDefined();
    expect(cert.subject.CN).toBe("agent1");
    // agent1 is issued by ca1, not self-signed — must never self-ref.
    expect(cert.issuerCertificate).not.toBe(cert);
    // ca1 wasn't sent in the chain, but it IS in the client's trust store
    // (via `ca: [caCert]`), so Node.js looks it up and links it.
    expect(cert.issuerCertificate).toBeDefined();
    expect(cert.issuerCertificate.subject.CN).toBe("ca1");
    // ca1 is self-signed → its issuerCertificate points to itself.
    expect(cert.issuerCertificate.issuerCertificate).toBe(cert.issuerCertificate);
  });
});

test("getPeerCertificate coerces non-boolean argument instead of throwing", async () => {
  // Node.js never type-checks the `detailed` argument; it uses
  // args[0]->IsTrue(). Passing undefined/null/0/1 must not throw.
  await withTlsClient(socket => {
    for (const arg of [undefined, null, 0, 1, "", "true"]) {
      // @ts-expect-error — intentionally passing wrong types
      const cert = socket.getPeerCertificate(arg);
      expect(cert).toBeDefined();
      expect(cert.subject.CN).toBe("agent1");
      // All non-`true` values yield the abbreviated cert (no chain).
      expect(cert.issuerCertificate).toBeUndefined();
    }
  });
});
