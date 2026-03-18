import { expect, test } from "bun:test";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import tls from "node:tls";

const fixturesDir = path.join(import.meta.dirname, "../../js/node/tls/fixtures");
const serverCert = fs.readFileSync(path.join(fixturesDir, "agent1-cert.pem"));
const serverKey = fs.readFileSync(path.join(fixturesDir, "agent1-key.pem"));
const caCert = fs.readFileSync(path.join(fixturesDir, "ca1-cert.pem"));

test("getPeerCertificate(false) returns abbreviated cert with fingerprint256", async () => {
  // This is the core regression: getPeerCertificate(false) should return the
  // abbreviated peer cert (same as no args), NOT an empty object.
  // The mariadb npm package calls getPeerCertificate(false) and accesses
  // .fingerprint256, which broke when this started returning {}.
  const { promise, resolve, reject } = Promise.withResolvers<void>();

  const server = tls.createServer({ key: serverKey, cert: serverCert }, socket => {
    socket.end();
  });

  server.listen(0, "127.0.0.1", () => {
    const addr = server.address() as { port: number };
    const socket = tls.connect(
      {
        host: "127.0.0.1",
        port: addr.port,
        ca: [caCert],
        servername: "agent1",
        checkServerIdentity: () => undefined,
      },
      () => {
        try {
          const cert = socket.getPeerCertificate(false);
          expect(cert).toBeDefined();
          expect(typeof cert).toBe("object");
          expect(cert.subject).toBeDefined();
          expect(cert.subject.CN).toBe("agent1");
          expect(cert.fingerprint256).toBeDefined();
          expect(typeof cert.fingerprint256).toBe("string");
          expect(cert.fingerprint256).toContain(":");
          resolve();
        } catch (e) {
          reject(e);
        } finally {
          socket.destroy();
          server.close();
        }
      },
    );
    socket.on("error", reject);
  });

  await promise;
});

test("getPeerCertificate() returns abbreviated cert (no args)", async () => {
  const { promise, resolve, reject } = Promise.withResolvers<void>();

  const server = tls.createServer({ key: serverKey, cert: serverCert }, socket => {
    socket.end();
  });

  server.listen(0, "127.0.0.1", () => {
    const addr = server.address() as { port: number };
    const socket = tls.connect(
      {
        host: "127.0.0.1",
        port: addr.port,
        ca: [caCert],
        servername: "agent1",
        checkServerIdentity: () => undefined,
      },
      () => {
        try {
          const cert = socket.getPeerCertificate();
          expect(cert).toBeDefined();
          expect(cert.subject.CN).toBe("agent1");
          expect(cert.fingerprint256).toBeDefined();
          expect(typeof cert.fingerprint256).toBe("string");
          // No issuerCertificate on abbreviated cert
          expect(cert.issuerCertificate).toBeUndefined();
          resolve();
        } catch (e) {
          reject(e);
        } finally {
          socket.destroy();
          server.close();
        }
      },
    );
    socket.on("error", reject);
  });

  await promise;
});

test("getPeerCertificate(true) returns detailed cert with issuerCertificate", async () => {
  const { promise, resolve, reject } = Promise.withResolvers<void>();

  // Provide the full chain (server cert + CA cert) so the client receives
  // the issuer certificate in the chain from the TLS handshake.
  const fullChain = Buffer.concat([serverCert, caCert]);
  const server = tls.createServer({ key: serverKey, cert: fullChain }, socket => {
    socket.end();
  });

  server.listen(0, "127.0.0.1", () => {
    const addr = server.address() as { port: number };
    const socket = tls.connect(
      {
        host: "127.0.0.1",
        port: addr.port,
        ca: [caCert],
        servername: "agent1",
        checkServerIdentity: () => undefined,
      },
      () => {
        try {
          const cert = socket.getPeerCertificate(true);
          expect(cert).toBeDefined();
          expect(cert.subject.CN).toBe("agent1");
          expect(cert.fingerprint256).toBeDefined();
          // Detailed cert should have issuerCertificate
          expect(cert.issuerCertificate).toBeDefined();
          expect(typeof cert.issuerCertificate).toBe("object");
          expect(cert.issuerCertificate.subject.CN).toBe("ca1");
          resolve();
        } catch (e) {
          reject(e);
        } finally {
          socket.destroy();
          server.close();
        }
      },
    );
    socket.on("error", reject);
  });

  await promise;
});

test("getPeerCertificate(false) works with socket upgrade pattern (mariadb)", async () => {
  // This simulates the exact pattern used by the mariadb npm package:
  // 1. Connect via TCP
  // 2. Upgrade to TLS using tls.connect({ socket })
  // 3. Call getPeerCertificate(false) and access fingerprint256
  const { promise, resolve, reject } = Promise.withResolvers<void>();

  const server = tls.createServer({ key: serverKey, cert: serverCert }, socket => {
    socket.end();
  });

  server.listen(0, "127.0.0.1", () => {
    const addr = server.address() as { port: number };

    // Step 1: Plain TCP connection
    const tcpSocket = net.connect({ host: "127.0.0.1", port: addr.port }, () => {
      // Step 2: Upgrade to TLS (mariadb pattern - no servername, no host)
      const tlsSocket = tls.connect(
        {
          socket: tcpSocket,
          ca: [caCert],
          checkServerIdentity: () => undefined,
        },
        () => {
          try {
            // Step 3: mariadb driver fingerprint check
            const serverCertObj = tlsSocket.getPeerCertificate(false);
            expect(serverCertObj).toBeDefined();
            expect(typeof serverCertObj).toBe("object");

            // This is the exact code pattern from the mariadb driver that broke:
            const fingerprint = serverCertObj ? serverCertObj.fingerprint256.replace(/:/gi, "").toLowerCase() : null;
            expect(fingerprint).toBeDefined();
            expect(typeof fingerprint).toBe("string");
            expect(fingerprint!.length).toBe(64); // SHA256 = 32 bytes = 64 hex chars
            resolve();
          } catch (e) {
            reject(e);
          } finally {
            tlsSocket.destroy();
            server.close();
          }
        },
      );
      tlsSocket.on("error", reject);
    });
    tcpSocket.on("error", reject);
  });

  await promise;
});
