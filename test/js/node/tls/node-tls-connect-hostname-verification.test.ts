import assert from "node:assert";
import { once } from "node:events";
import fs from "node:fs";
import type { AddressInfo } from "node:net";
import net from "node:net";
import path from "node:path";
import { describe, test } from "node:test";
import tls from "node:tls";

// Server presents a cert for CN=agent1 (no SAN), signed by ca1.
// A client connecting to host "localhost" with ca1 trusted will pass chain
// verification but MUST fail hostname verification (localhost != agent1).
const fixturesDir = path.join(import.meta.dirname, "fixtures");
const serverKey = fs.readFileSync(path.join(fixturesDir, "agent1-key.pem"));
const serverCert = fs.readFileSync(path.join(fixturesDir, "agent1-cert.pem"));
const ca = fs.readFileSync(path.join(fixturesDir, "ca1-cert.pem"));

async function withServer<T>(fn: (port: number) => Promise<T>): Promise<T> {
  const server = tls.createServer({ key: serverKey, cert: serverCert }, c => c.end());
  server.listen(0);
  await once(server, "listening");
  try {
    return await fn((server.address() as AddressInfo).port);
  } finally {
    server.close();
  }
}

describe("tls.connect hostname verification without explicit servername", () => {
  test("rejects an IP address as options.servername", () => {
    assert.throws(() => tls.connect({ host: "localhost", port: 1, servername: "127.0.0.1" }), {
      code: "ERR_INVALID_ARG_VALUE",
    });
    assert.throws(() => tls.connect({ host: "localhost", port: 1, servername: "::1" }), {
      code: "ERR_INVALID_ARG_VALUE",
    });
  });

  test("rejects a CA-trusted cert whose CN does not match host", async () => {
    await withServer(async port => {
      const { promise, resolve, reject } = Promise.withResolvers<NodeJS.ErrnoException>();
      const socket = tls.connect({ host: "localhost", port, ca }, () => {
        socket.destroy();
        reject(
          Object.assign(new Error("secureConnect fired without rejecting mismatched hostname"), {
            authorized: socket.authorized,
            authorizationError: socket.authorizationError,
          }),
        );
      });
      socket.on("error", err => {
        socket.destroy();
        resolve(err as NodeJS.ErrnoException);
      });
      const err = await promise;
      assert.strictEqual(err.code, "ERR_TLS_CERT_ALTNAME_INVALID");
    });
  });

  test("reports authorized=false on hostname mismatch with rejectUnauthorized=false", async () => {
    await withServer(async port => {
      const { promise, resolve, reject } = Promise.withResolvers<{ authorized: boolean; authorizationError: string }>();
      const socket = tls.connect({ host: "localhost", port, ca, rejectUnauthorized: false });
      socket.on("secureConnect", () => {
        resolve({
          authorized: socket.authorized,
          authorizationError: String(socket.authorizationError),
        });
        socket.destroy();
      });
      socket.on("error", err => {
        socket.destroy();
        reject(err);
      });
      const result = await promise;
      assert.strictEqual(result.authorized, false);
      assert.match(result.authorizationError, /ERR_TLS_CERT_ALTNAME_INVALID/);
    });
  });

  // tls.connect({ socket }) skips lookupAndConnect, so `host` only reaches the
  // handshake through the connect options. Node honors it for certificate
  // validation anyway: "If [socket] is specified, path, host and port are
  // ignored, except for certificate validation."
  test("verifies against options.host when wrapping an existing socket", async () => {
    await withServer(async port => {
      const raw = net.connect(port, "127.0.0.1");
      await once(raw, "connect");
      const { promise, resolve, reject } = Promise.withResolvers<{ checkedWith?: string; authorized: boolean }>();
      let checkedWith: string | undefined;
      // The cert is CN=agent1, so verifying against "localhost" would reject it.
      const socket = tls.connect({
        socket: raw,
        host: "agent1",
        ca,
        checkServerIdentity(hostname, cert) {
          checkedWith = hostname;
          return tls.checkServerIdentity(hostname, cert);
        },
      });
      socket.on("secureConnect", () => {
        resolve({ checkedWith, authorized: socket.authorized });
        socket.destroy();
      });
      socket.on("error", err => {
        socket.destroy();
        reject(err);
      });
      assert.deepStrictEqual(await promise, { checkedWith: "agent1", authorized: true });
    });
  });

  test("invokes checkServerIdentity with host when servername is omitted", async () => {
    await withServer(async port => {
      const { promise, resolve, reject } = Promise.withResolvers<string>();
      let calledWith: string | undefined;
      const socket = tls.connect({
        host: "localhost",
        port,
        ca,
        rejectUnauthorized: false,
        checkServerIdentity(hostname, cert) {
          calledWith = hostname;
          return tls.checkServerIdentity(hostname, cert);
        },
      });
      socket.on("secureConnect", () => {
        socket.destroy();
        if (calledWith === undefined) reject(new Error("checkServerIdentity was never called"));
        else resolve(calledWith);
      });
      socket.on("error", err => {
        socket.destroy();
        reject(err);
      });
      assert.strictEqual(await promise, "localhost");
    });
  });
});

describe("Bun.connect TLS hostname verification", () => {
  // The server presents the agent1 cert (CN=agent1, no SAN) signed by ca1.
  // A client that trusts ca1 and connects to 127.0.0.1 passes chain validation,
  // but the certificate is not valid for that host, so the socket must not be
  // reported as authorized. Both ends name the loopback address outright:
  // "localhost" can resolve to both ::1 and 127.0.0.1, and the listener and the
  // client do not have to pick the same family.
  test("reports authorized=false when a CA-trusted cert does not match the connected hostname", async () => {
    const listener = Bun.listen({
      hostname: "127.0.0.1",
      port: 0,
      tls: { key: serverKey, cert: serverCert },
      socket: {
        open() {},
        data() {},
        drain() {},
        close() {},
        error() {},
      },
    });
    try {
      // Mismatch: connect host "127.0.0.1" vs cert CN "agent1".
      const mismatch = Promise.withResolvers<{ flag: boolean; arg: boolean; error: NodeJS.ErrnoException | null }>();
      const badSocket = await Bun.connect({
        hostname: "127.0.0.1",
        port: listener.port,
        tls: { ca },
        socket: {
          open() {},
          handshake(s, success) {
            mismatch.resolve({ flag: s.authorized, arg: success, error: s.getAuthorizationError() });
            s.end();
          },
          data() {},
          drain() {},
          close() {},
          error(_s, err) {
            mismatch.reject(err);
          },
          connectError(_s, err) {
            mismatch.reject(err);
          },
        },
      });
      const result = await mismatch.promise;
      badSocket.end();
      assert.strictEqual(result.arg, false, "handshake callback must not report success for a hostname mismatch");
      assert.strictEqual(result.flag, false, "socket.authorized must be false for a hostname mismatch");
      assert.ok(result.error, "getAuthorizationError() must report why the socket is not authorized");
      assert.strictEqual(result.error.code, "ERR_TLS_CERT_ALTNAME_INVALID");

      // Legitimate case: same cert, but the client asks for server name
      // "agent1", which matches the certificate. Must remain authorized.
      const match = Promise.withResolvers<boolean>();
      const goodSocket = await Bun.connect({
        hostname: "127.0.0.1",
        port: listener.port,
        tls: { ca, serverName: "agent1" },
        socket: {
          open() {},
          handshake(s) {
            match.resolve(s.authorized);
            s.end();
          },
          data() {},
          drain() {},
          close() {},
          error(_s, err) {
            match.reject(err);
          },
          connectError(_s, err) {
            match.reject(err);
          },
        },
      });
      const okAuthorized = await match.promise;
      goodSocket.end();
      assert.strictEqual(okAuthorized, true, "a certificate matching the requested server name must stay authorized");
    } finally {
      listener.stop(true);
    }
  });
});
