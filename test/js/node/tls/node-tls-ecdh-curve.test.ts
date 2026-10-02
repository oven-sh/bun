import { describe, expect, it } from "bun:test";
import { tls as COMMON_CERT } from "harness";
import type { AddressInfo } from "net";
import tls, { connect, createServer, Server } from "tls";

const listen = async (server: Server) => {
  const listening = Promise.withResolvers<void>();
  server.once("listening", listening.resolve);
  server.once("error", listening.reject);
  server.listen(0, "127.0.0.1");
  await listening.promise;
  return (server.address() as AddressInfo).port;
};

const handshake = async (port: number, ecdhCurve?: string) => {
  const outcome = Promise.withResolvers<string>();
  const client = connect({ port, host: "127.0.0.1", rejectUnauthorized: false, ecdhCurve });
  client.once("secureConnect", () => {
    client.destroy();
    outcome.resolve("ok");
  });
  client.once("error", err => {
    client.destroy();
    // BoringSSL: SSLV3_ALERT_HANDSHAKE_FAILURE, OpenSSL: SSL/TLS_ALERT_HANDSHAKE_FAILURE.
    const code = (err as Error & { code?: string }).code ?? "error";
    outcome.resolve(code.includes("HANDSHAKE_FAILURE") ? "handshake_failure" : code);
  });
  client.once("close", () => outcome.resolve("closed"));
  return outcome.promise;
};

describe("tls ecdhCurve", () => {
  // Node restricts the key-share groups via SSL_CTX_set1_groups_list: a server
  // pinned to P-384 must refuse a client that only offers X25519 and must
  // negotiate secp384r1 with a client that offers it.
  // https://github.com/nodejs/node/blob/v26.3.0/src/crypto/crypto_context.cc SetECDHCurve
  it("restricts the server's key-share groups to the configured list", async () => {
    const server = createServer({ ...COMMON_CERT, ecdhCurve: "P-384" }, socket => {
      socket.on("error", () => {});
      socket.end();
    });
    server.on("tlsClientError", () => {});
    try {
      const port = await listen(server);
      expect({
        x25519Only: await handshake(port, "X25519"),
        p384Only: await handshake(port, "P-384"),
      }).toEqual({
        x25519Only: "handshake_failure",
        p384Only: "ok",
      });
    } finally {
      if (server.listening) server.close();
    }
  });

  it("restricts the client's offered groups to the configured list", async () => {
    const server = createServer({ ...COMMON_CERT, ecdhCurve: "X25519" }, socket => {
      socket.on("error", () => {});
      socket.end();
    });
    server.on("tlsClientError", () => {});
    try {
      const port = await listen(server);
      expect({
        p384Only: await handshake(port, "P-384"),
        colonList: await handshake(port, "P-384:X25519"),
      }).toEqual({
        p384Only: "handshake_failure",
        colonList: "ok",
      });
    } finally {
      if (server.listening) server.close();
    }
  });

  it("throws ERR_CRYPTO_OPERATION_FAILED for an unknown curve name", () => {
    const check = (fn: () => unknown) => {
      let err: any;
      try {
        const ret = fn();
        if (ret && typeof (ret as any).destroy === "function") {
          (ret as any).on?.("error", () => {});
          (ret as any).destroy();
        }
      } catch (e) {
        err = e;
      }
      return { code: err?.code, message: err?.message };
    };
    expect({
      createSecureContext: check(() => tls.createSecureContext({ ecdhCurve: "not-a-curve" })),
      colonList: check(() => tls.createSecureContext({ ecdhCurve: "P-384:not-a-curve" })),
      connect: check(() => connect({ port: 1, host: "127.0.0.1", ecdhCurve: "not-a-curve" })),
    }).toEqual({
      createSecureContext: { code: "ERR_CRYPTO_OPERATION_FAILED", message: "Failed to set ECDH curve" },
      colonList: { code: "ERR_CRYPTO_OPERATION_FAILED", message: "Failed to set ECDH curve" },
      connect: { code: "ERR_CRYPTO_OPERATION_FAILED", message: "Failed to set ECDH curve" },
    });
  });

  it("rejects an unknown curve name in createServer synchronously", () => {
    // Node throws from the Server constructor (configSecureContext -> SetECDHCurve):
    // https://github.com/nodejs/node/blob/v26.3.0/src/crypto/crypto_context.cc#L1973
    let err: any;
    try {
      createServer({ ...COMMON_CERT, ecdhCurve: "not-a-curve" });
    } catch (e) {
      err = e;
    }
    expect({ code: err?.code, message: err?.message }).toEqual({
      code: "ERR_CRYPTO_OPERATION_FAILED",
      message: "Failed to set ECDH curve",
    });
  });

  it("treats 'auto' as the library default group list", async () => {
    expect(() => tls.createSecureContext({ ecdhCurve: "auto" })).not.toThrow();
    const server = createServer({ ...COMMON_CERT, ecdhCurve: "auto" }, socket => {
      socket.on("error", () => {});
      socket.end();
    });
    server.on("tlsClientError", () => {});
    try {
      const port = await listen(server);
      expect({
        x25519: await handshake(port, "X25519"),
        p384: await handshake(port, "P-384"),
      }).toEqual({ x25519: "ok", p384: "ok" });
    } finally {
      if (server.listening) server.close();
    }
  });

  it("reads tls.DEFAULT_ECDH_CURVE as the fallback when ecdhCurve is omitted", async () => {
    const saved = tls.DEFAULT_ECDH_CURVE;
    expect(saved).toBe("auto");
    tls.DEFAULT_ECDH_CURVE = "P-384";
    let server: Server | undefined;
    try {
      expect(tls.DEFAULT_ECDH_CURVE).toBe("P-384");
      server = createServer({ ...COMMON_CERT }, socket => {
        socket.on("error", () => {});
        socket.end();
      });
      server.on("tlsClientError", () => {});
      const port = await listen(server);
      expect({
        x25519Only: await handshake(port, "X25519"),
        default: await handshake(port),
      }).toEqual({
        x25519Only: "handshake_failure",
        default: "ok",
      });
    } finally {
      tls.DEFAULT_ECDH_CURVE = saved;
      if (server?.listening) server.close();
    }
  });
});
