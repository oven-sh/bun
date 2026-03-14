import { describe, expect, test } from "bun:test";
import { tls as validTls } from "harness";

describe("mTLS SSLConfig keepalive (#27358)", () => {
  test("fetch with custom TLS reuses keepalive connections", async () => {
    // Track client ports to detect connection reuse
    const clientPorts: number[] = [];

    using server = Bun.serve({
      port: 0,
      tls: validTls,
      hostname: "127.0.0.1",
      fetch(req, server) {
        const ip = server.requestIP(req);
        return new Response(String(ip?.port ?? 0));
      },
    });

    const url = `https://127.0.0.1:${server.port}`;
    const tlsOpts = { ca: validTls.cert, rejectUnauthorized: false };

    // Make sequential requests with keepalive enabled.
    // With our fix: keepalive works for custom TLS, connections are reused → same port.
    // With old code: disable_keepalive=true, every request opens a new TCP connection → different ports.
    const numRequests = 6;
    for (let i = 0; i < numRequests; i++) {
      const res = await fetch(url, { tls: tlsOpts, keepalive: true });
      const port = parseInt(await res.text(), 10);
      clientPorts.push(port);
    }

    // Count unique client ports.
    const uniquePorts = new Set(clientPorts);

    // With keepalive working: sequential requests reuse the connection,
    // so we expect significantly fewer unique ports than requests.
    // The first request establishes a connection, subsequent ones reuse it.
    // Allow for at most 2 unique ports (in case of a one-time reconnect).
    expect(uniquePorts.size).toBeLessThanOrEqual(2);
  });

  test("different custom TLS configs do NOT share keepalive connections", async () => {
    using server = Bun.serve({
      port: 0,
      tls: validTls,
      hostname: "127.0.0.1",
      fetch(req, server) {
        const ip = server.requestIP(req);
        return new Response(String(ip?.port ?? 0));
      },
    });

    const url = `https://127.0.0.1:${server.port}`;

    // Config A - just CA
    const tlsA = { ca: validTls.cert, rejectUnauthorized: false };
    // Config B - CA + explicit serverName (makes it a different SSLConfig)
    const tlsB = { ca: validTls.cert, rejectUnauthorized: false, serverName: "127.0.0.1" };

    // Request with config A
    const resA = await fetch(url, { tls: tlsA, keepalive: true });
    const portA = parseInt(await resA.text(), 10);

    // Request with config B — must open a new connection (different SSL context)
    const resB = await fetch(url, { tls: tlsB, keepalive: true });
    const portB = parseInt(await resB.text(), 10);

    // Different configs → different connections → different ports
    expect(portA).not.toBe(portB);
  });
});
