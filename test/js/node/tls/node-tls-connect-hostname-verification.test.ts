import assert from "node:assert";
import { once } from "node:events";
import fs from "node:fs";
import type { AddressInfo } from "node:net";
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
