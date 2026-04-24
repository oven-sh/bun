// Regression tests for TLS upgrade leaks (#12117, #24118, #25948).
//
// Two layers of this bug have been fixed over time:
//
//   1. The JS-wrapper retention bug: when a TCP socket is upgraded to TLS via
//      `tls.connect({ socket })`, both a TLS wrapper and a raw TCP wrapper
//      are created in Zig. The raw socket's `has_pending_activity` was never
//      cleared on close, so its JS wrapper leaked indefinitely. Fixed by
//      #26766 and later refactored into `jsc.JSRef` in #29451.
//
//   2. The `SSL_CTX` allocation-per-upgrade bug: even with (1) fixed, every
//      `upgradeTLS` call unconditionally ran `SSL_CTX_new` + cert/cipher
//      parsing (~50-100KB). On MongoDB's SDAM heartbeat workload this made
//      RSS grow unboundedly on Linux (where ptmalloc keeps retained arenas).
//      Fixed by sharing one `SSL_CTX` across connections with matching
//      `SSLConfig` — the same pattern Node.js uses via `SecureContext`.

import { describe, expect, it } from "bun:test";
import { tls as COMMON_CERT, expectMaxObjectTypeCount } from "harness";
import { once } from "node:events";
import net from "node:net";
import tls from "node:tls";

describe("TLS upgrade", () => {
  it("should not leak TLSSocket objects after close", async () => {
    // Create a TLS server that echoes data and closes
    const server = tls.createServer(
      {
        key: COMMON_CERT.key,
        cert: COMMON_CERT.cert,
      },
      socket => {
        socket.end("hello");
      },
    );

    await once(server.listen(0, "127.0.0.1"), "listening");
    const port = (server.address() as net.AddressInfo).port;

    // Simulate the MongoDB driver pattern: create a plain TCP socket,
    // then upgrade it to TLS via tls.connect({ socket }).
    // Do this multiple times to accumulate leaked objects.
    const iterations = 50;

    try {
      for (let i = 0; i < iterations; i++) {
        const tcpSocket = net.createConnection({ host: "127.0.0.1", port });
        await once(tcpSocket, "connect");

        const tlsSocket = tls.connect({
          socket: tcpSocket,
          ca: COMMON_CERT.cert,
          rejectUnauthorized: false,
        });
        await once(tlsSocket, "secureConnect");

        // Read any data and destroy the TLS socket (simulates SDAM close)
        tlsSocket.on("data", () => {});
        tlsSocket.destroy();

        await once(tlsSocket, "close");
      }
    } finally {
      server.close();
      await once(server, "close");
    }

    // After all connections are closed and GC runs, the TLSSocket count
    // should be low. Before the fix, each iteration would leak 1 raw
    // TLSSocket (the TCP wrapper from upgradeTLS), accumulating over time.
    // Allow some slack for prototypes/structures (typically 2-3 baseline).
    await expectMaxObjectTypeCount(expect, "TLSSocket", 10, 1000);
  });

  it("should not grow RSS per upgrade when the TLS config is shared", { timeout: 120_000 }, async () => {
    // Reproduces the MongoDB SDAM workload without needing MongoDB: each
    // iteration opens a plain TCP socket and upgrades it to TLS with the same
    // options object. With the SSL_CTX cache in place a single `SSL_CTX` is
    // reused across every iteration; without it each iteration runs
    // `SSL_CTX_new` + cert parsing, and RSS grows hundreds of megabytes
    // over the loop.
    const server = tls.createServer(
      {
        key: COMMON_CERT.key,
        cert: COMMON_CERT.cert,
      },
      socket => {
        socket.end("hello");
      },
    );

    await once(server.listen(0, "127.0.0.1"), "listening");
    const port = (server.address() as net.AddressInfo).port;

    async function upgradeOnce() {
      const tcpSocket = net.createConnection({ host: "127.0.0.1", port });
      await once(tcpSocket, "connect");
      const tlsSocket = tls.connect({
        socket: tcpSocket,
        ca: COMMON_CERT.cert,
        rejectUnauthorized: false,
      });
      await once(tlsSocket, "secureConnect");
      tlsSocket.on("data", () => {});
      tlsSocket.destroy();
      await once(tlsSocket, "close");
    }

    try {
      // Warm up: first upgrade pays the SSL_CTX creation cost even with the
      // cache, so take baseline _after_ it to isolate the per-upgrade cost.
      await upgradeOnce();
      Bun.gc(true);
      await Bun.sleep(50);
      Bun.gc(true);
      const baselineRSS = process.memoryUsage().rss;

      const iterations = 300;
      for (let i = 0; i < iterations; i++) {
        await upgradeOnce();
      }

      Bun.gc(true);
      await Bun.sleep(100);
      Bun.gc(true);
      const finalRSS = process.memoryUsage().rss;

      const growthMB = (finalRSS - baselineRSS) / 1024 / 1024;
      // Without the SSL_CTX cache this runs SSL_CTX_new per iteration and RSS
      // grows ~150-300MB over 300 cycles. With the cache, ~20-30MB. A 100MB
      // threshold catches the regression deterministically while tolerating
      // allocator/CI noise.
      expect(growthMB).toBeLessThan(100);
    } finally {
      server.close();
      await once(server, "close");
    }
  });
});
