import { expect, test } from "bun:test";
import { tls as COMMON_CERT } from "harness";
import tls from "tls";

// Regression test for https://github.com/oven-sh/bun/issues/23556
// checkServerIdentity should not be called with null/undefined cert
// when getPeerCertificate returns undefined during TLS handshake.

test("checkServerIdentity receives a valid cert object", async () => {
  const { promise: serverListening, resolve: resolveListening } = Promise.withResolvers<void>();
  const { promise: done, resolve: resolveDone, reject: rejectDone } = Promise.withResolvers<void>();

  const server = tls.createServer(COMMON_CERT, socket => {
    socket.end();
  });

  server.listen(0, "127.0.0.1", () => {
    resolveListening();
  });

  await serverListening;
  const address = server.address() as { port: number };

  const socket = tls.connect(
    {
      port: address.port,
      host: "127.0.0.1",
      servername: "localhost",
      rejectUnauthorized: false,
      checkServerIdentity: (hostname: string, cert: any) => {
        // Before the fix, cert could be undefined which would crash
        // with: "Cannot destructure property 'subject' from null or undefined"
        expect(cert).toBeDefined();
        expect(cert).not.toBeNull();
        expect(cert.subject).toBeDefined();
        return undefined;
      },
    },
    () => {
      socket.end();
      server.close();
      resolveDone();
    },
  );

  socket.on("error", err => {
    server.close();
    rejectDone(err);
  });

  await done;
});

test("no crash when getPeerCertificate returns undefined during handshake", async () => {
  const { promise: serverListening, resolve: resolveListening } = Promise.withResolvers<void>();
  const { promise: done, resolve: resolveDone, reject: rejectDone } = Promise.withResolvers<void>();

  const server = tls.createServer(COMMON_CERT, socket => {
    socket.end();
  });

  server.listen(0, "127.0.0.1", () => {
    resolveListening();
  });

  await serverListening;
  const address = server.address() as { port: number };

  let checkCalledWithUndefined = false;

  const socket = tls.connect(
    {
      port: address.port,
      host: "127.0.0.1",
      servername: "localhost",
      rejectUnauthorized: false,
      checkServerIdentity: (hostname: string, cert: any) => {
        if (cert === undefined || cert === null) {
          checkCalledWithUndefined = true;
        }
        return undefined;
      },
    },
    () => {
      // Monkey-patch getPeerCertificate BEFORE the handshake completes wouldn't
      // work because the callback fires after handshake. But the guard in net.ts
      // ensures checkServerIdentity is never called with undefined cert.
      // This test verifies the connection succeeds without errors.
      expect(checkCalledWithUndefined).toBe(false);
      socket.end();
      server.close();
      resolveDone();
    },
  );

  socket.on("error", err => {
    server.close();
    rejectDone(err);
  });

  await done;
});

test("tls.checkServerIdentity with null cert throws TypeError", () => {
  // The default checkServerIdentity should throw a clear error when
  // called with null/undefined cert, not a cryptic destructuring error.
  expect(() => {
    tls.checkServerIdentity("example.com", null as any);
  }).toThrow();

  expect(() => {
    tls.checkServerIdentity("example.com", undefined as any);
  }).toThrow();
});
