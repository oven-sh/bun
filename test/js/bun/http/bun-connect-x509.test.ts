import type { Socket } from "bun";
import { dns } from "bun";
import { describe, expect, test } from "bun:test";
import * as harness from "harness";

// Probe once: the example.com TLS case needs a working upstream resolver.
// Sandboxed/offline runners reject with ENOTIMP/ESERVFAIL — gate that case so
// the local-server cases below still exercise getPeerX509Certificate offline.
const hasExternalDNS = await dns.lookup("example.com").then(
  r => Array.isArray(r) && r.length > 0,
  () => false,
);

describe("bun.connect", () => {
  test.skipIf(!hasExternalDNS)("should have peer x509 certificate", async () => {
    const defer = Promise.withResolvers();
    using socket = await Bun.connect({
      hostname: "example.com",
      port: 443,
      tls: true,
      socket: {
        open(socket: Socket) {},
        close() {},
        handshake(socket: Socket) {
          defer.resolve(socket);
        },
        data() {},
        drain() {},
      },
    });
    await defer.promise;
    const x509: import("node:crypto").X509Certificate = socket.getPeerX509Certificate();
    expect(x509.checkHost("example.com")).toBe("example.com");
  });

  test("should have peer x509 certificate on an unauthorized connection kept via rejectUnauthorized: false", async () => {
    const defer = Promise.withResolvers<Socket>();
    using listener = await Bun.listen({
      // 127.0.0.1, not "localhost": on v6-preferring hosts listen() binds ::1
      // while Bun.connect()'s resolver picks 127.0.0.1 → ECONNREFUSED.
      hostname: "127.0.0.1",
      port: 0,
      tls: harness.tls,
      socket: {
        open(socket: Socket) {},
        close() {},
        handshake() {},
        data() {},
        drain() {},
      },
    });
    using client = await Bun.connect({
      hostname: listener.hostname,
      port: listener.port,
      // No ca: the peer is NOT verified, but the connection is kept.
      tls: { rejectUnauthorized: false },
      socket: {
        open(socket: Socket) {},
        close() {},
        handshake(socket: Socket) {
          defer.resolve(socket);
        },
        data() {},
        drain() {},
      },
    });
    void client;
    const socket = await defer.promise;
    expect(socket.authorized).toBe(false);
    const peerX509: import("node:crypto").X509Certificate = socket.getPeerX509Certificate();
    expect(peerX509.checkHost("localhost")).toBe("localhost");
  });

  test("should have x509 certificate", async () => {
    const defer = Promise.withResolvers<Socket>();
    const listener = await Bun.listen({
      // 127.0.0.1, not "localhost": on v6-preferring hosts listen() binds ::1
      // while Bun.connect()'s resolver picks 127.0.0.1 → ECONNREFUSED.
      hostname: "127.0.0.1",
      port: 0,
      tls: harness.tls,
      socket: {
        open(socket: Socket) {},
        close() {},
        handshake(socket: Socket) {
          defer.resolve(socket);
        },
        data() {},
        drain() {},
      },
    });

    const defer2 = Promise.withResolvers<Socket>();
    await Bun.connect({
      hostname: listener.hostname,
      port: listener.port,
      tls: { ...harness.tls, ca: harness.tls.cert },
      socket: {
        open(socket: Socket) {},
        close() {},
        handshake(socket: Socket) {
          defer2.resolve(socket);
        },
        data() {},
        drain() {},
      },
    });
    using server = await defer.promise;
    using client = await defer2.promise;
    function check() {
      const x509: import("node:crypto").X509Certificate = server.getX509Certificate();
      const peerX509: import("node:crypto").X509Certificate = client.getPeerX509Certificate();
      expect(x509.checkHost("localhost")).toBe("localhost");
      expect(peerX509.checkHost("localhost")).toBe("localhost");
    }
    check();
    Bun.gc(true);

    // GC test:
    for (let i = 0; i < 1000; i++) {
      server.getX509Certificate();
      client.getPeerX509Certificate();
      if (i % 100 === 0 && i > 0) {
        Bun.gc(true);
      }
    }

    Bun.gc(true);
    listener.stop();
  });
});
