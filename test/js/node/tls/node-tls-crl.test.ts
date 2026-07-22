import { describe, expect, it } from "bun:test";
import { readFileSync } from "fs";
import { AddressInfo } from "net";
import { once } from "node:events";
import { join } from "path";
import tls, { connect, createServer, Server } from "tls";

const keyPath = (f: string) => join(import.meta.dir, "../test/fixtures/keys", f);
const keys = (f: string) => readFileSync(keyPath(f));
// agent4's serial number is listed in ca2-crl.pem; agent3's is not.
const ca2 = keys("ca2-cert.pem");
const ca2Crl = keys("ca2-crl.pem");

const serverBase = {
  key: keys("agent1-key.pem"),
  cert: keys("agent1-cert.pem"),
  ca: ca2,
  requestCert: true,
  rejectUnauthorized: false,
};

async function handshake(serverOpts: tls.TlsOptions, clientCert: string, clientKey: string) {
  const result = Promise.withResolvers<{ authorized: boolean; authorizationError: unknown }>();
  const server: Server = createServer(serverOpts, socket => {
    result.resolve({ authorized: socket.authorized, authorizationError: socket.authorizationError });
    socket.end();
  });
  // Bun also emits tlsClientError for verify failures before running the
  // connection handler when rejectUnauthorized is false; the handler still
  // runs with authorized=false, which is what this helper asserts on.
  server.on("tlsClientError", () => {});
  server.on("error", result.reject);
  server.listen(0);
  await once(server, "listening");
  const port = (server.address() as AddressInfo).port;
  const client = connect({
    port,
    host: "127.0.0.1",
    key: keys(clientKey),
    cert: keys(clientCert),
    rejectUnauthorized: false,
  });
  client.on("error", () => {});
  try {
    return await result.promise;
  } finally {
    client.destroy();
    server.close();
    await once(server, "close");
  }
}

describe("tls.createServer crl option", () => {
  it("rejects a client certificate listed in the CRL", async () => {
    const revoked = await handshake({ ...serverBase, crl: ca2Crl }, "agent4-cert.pem", "agent4-key.pem");
    expect(revoked).toEqual({ authorized: false, authorizationError: "CERT_REVOKED" });
  });

  it("accepts a client certificate not listed in the CRL", async () => {
    const valid = await handshake({ ...serverBase, crl: ca2Crl }, "agent3-cert.pem", "agent3-key.pem");
    expect(valid.authorized).toBe(true);
  });

  it("accepts crl as a PEM string", async () => {
    const revoked = await handshake(
      { ...serverBase, crl: ca2Crl.toString("utf8") },
      "agent4-cert.pem",
      "agent4-key.pem",
    );
    expect(revoked).toEqual({ authorized: false, authorizationError: "CERT_REVOKED" });
  });

  it("accepts crl as an array", async () => {
    const revoked = await handshake({ ...serverBase, crl: [ca2Crl] }, "agent4-cert.pem", "agent4-key.pem");
    expect(revoked).toEqual({ authorized: false, authorizationError: "CERT_REVOKED" });
  });

  it("accepts crl as a BunFile", async () => {
    const revoked = await handshake(
      { ...serverBase, crl: Bun.file(keyPath("ca2-crl.pem")) as never },
      "agent4-cert.pem",
      "agent4-key.pem",
    );
    expect(revoked).toEqual({ authorized: false, authorizationError: "CERT_REVOKED" });
  });

  it("rejectUnauthorized:true refuses a revoked client certificate", async () => {
    const result = Promise.withResolvers<string>();
    const server: Server = createServer({ ...serverBase, crl: ca2Crl, rejectUnauthorized: true }, socket => {
      // The connection handler only runs for authorized sockets when
      // rejectUnauthorized is true; record the outcome so a missing CRL
      // check surfaces as a test failure rather than a hang.
      result.resolve(`handler ran authorized=${socket.authorized}`);
      socket.end();
    });
    server.on("tlsClientError", err => result.resolve((err as NodeJS.ErrnoException).code ?? err.message));
    server.on("error", result.reject);
    server.listen(0);
    await once(server, "listening");
    const port = (server.address() as AddressInfo).port;
    const client = connect({
      port,
      host: "127.0.0.1",
      key: keys("agent4-key.pem"),
      cert: keys("agent4-cert.pem"),
      rejectUnauthorized: false,
    });
    client.on("error", () => {});
    let data = "";
    client.on("data", d => (data += d));
    const closed = once(client, "close");
    try {
      expect(await result.promise).toBe("CERT_REVOKED");
      await closed;
      expect(data).toBe("");
    } finally {
      client.destroy();
      server.close();
      await once(server, "close");
    }
  });

  it("rejects an unparseable crl at secure-context creation", () => {
    expect(() =>
      tls.createSecureContext({
        key: keys("agent1-key.pem"),
        cert: keys("agent1-cert.pem"),
        ca: ca2,
        crl: "not a crl",
      }),
    ).toThrow(expect.objectContaining({ code: "ERR_CRYPTO_OPERATION_FAILED" }));
  });

  it("validates the crl option type", () => {
    expect(() => createServer({ ...serverBase, crl: 123 as never })).toThrow(
      expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" }),
    );
    expect(() => tls.createSecureContext({ crl: 123 as never })).toThrow(
      expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" }),
    );
  });
});
