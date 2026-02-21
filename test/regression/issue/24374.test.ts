import { expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import tls from "node:tls";

const fixturesDir = path.join(import.meta.dir, "../../js/node/tls/fixtures");
const serverCert = fs.readFileSync(path.join(fixturesDir, "agent1-cert.pem"));
const serverKey = fs.readFileSync(path.join(fixturesDir, "agent1-key.pem"));

test("getPeerCertificate returns {} instead of undefined when no client cert", async () => {
  const { promise: gotCert, resolve, reject } = Promise.withResolvers<unknown>();

  const server = tls.createServer(
    {
      key: serverKey,
      cert: serverCert,
    },
    socket => {
      try {
        const peerCert = socket.getPeerCertificate();
        resolve(peerCert);
      } catch (e) {
        reject(e);
      }
      socket.end();
    },
  );

  await new Promise<void>((res, rej) => {
    server.on("error", rej);
    server.listen(0, "127.0.0.1", () => res());
  });

  const addr = server.address() as { port: number };

  tls.connect({
    host: "127.0.0.1",
    port: addr.port,
    rejectUnauthorized: false,
  });

  const result = await gotCert;

  // Node.js returns {} when no peer certificate is available, not undefined
  expect(result).toEqual({});
  expect(typeof result).toBe("object");
  expect(result).not.toBeNull();
  expect(result).not.toBeUndefined();

  server.close();
});

test("getPeerCertificate returns null when handle is not available", () => {
  // A TLSSocket before connecting has no handle
  const socket = new tls.TLSSocket(undefined as any);
  const result = socket.getPeerCertificate();
  expect(result).toBeNull();
  socket.destroy();
});

test("checkServerIdentity does not crash with empty cert object", () => {
  // When getPeerCertificate returns {}, checkServerIdentity should not crash
  // It should return an error about missing DNS name, not throw
  const result = tls.checkServerIdentity("test.example.com", {} as any);
  expect(result).toBeInstanceOf(Error);
  expect(result!.message).toContain("does not contain a DNS name");
});

test("TLS handshake with checkServerIdentity does not crash", async () => {
  const { promise: connected, resolve, reject } = Promise.withResolvers<void>();

  const server = tls.createServer(
    {
      key: serverKey,
      cert: serverCert,
    },
    socket => {
      socket.end();
    },
  );

  await new Promise<void>((res, rej) => {
    server.on("error", rej);
    server.listen(0, "127.0.0.1", () => res());
  });

  const addr = server.address() as { port: number };

  const socket = tls.connect(
    {
      host: "127.0.0.1",
      port: addr.port,
      rejectUnauthorized: false,
      checkServerIdentity: (hostname: string, cert: any) => {
        // This should be called with a valid cert object, never undefined
        expect(cert).toBeDefined();
        expect(typeof cert).toBe("object");
        return undefined;
      },
    },
    () => {
      resolve();
    },
  );

  socket.on("error", reject);

  await connected;

  socket.destroy();
  server.close();
});
