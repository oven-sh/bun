// Regression test for TLS upgrade raw socket leak (#12117, #24118, #25948)
// When a TCP socket is upgraded to TLS via tls.connect({ socket }),
// both a TLS wrapper and a raw TCP wrapper are created in Zig.
// Previously, the raw socket's has_pending_activity was never set to
// false on close, causing it (and all its retained objects) to leak.

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
});
