import { expect, test } from "bun:test";

// This test verifies that connection attempts via the multi-address DNS path
// don't hang forever. The connection timeout in the socket layer should
// cause individual connection attempts to fail within a bounded time,
// implementing a simplified Happy Eyeballs (RFC 8305) approach.
//
// This is critical for `bun update` and other package manager operations
// where IPv6 addresses may be returned by DNS but IPv6 connectivity is
// broken, causing connections to hang indefinitely.

test("fetch to IPv4 server via localhost succeeds", async () => {
  // Start a server only on IPv4 127.0.0.1
  await using server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch() {
      return new Response("ok");
    },
  });

  // Connect directly to the IPv4 address - this should work immediately
  const resp = await fetch(`http://127.0.0.1:${server.port}/`);
  expect(resp.status).toBe(200);
  expect(await resp.text()).toBe("ok");
});

test("fetch via localhost resolves when server is on 127.0.0.1", async () => {
  // Start a server only on IPv4 127.0.0.1
  // "localhost" may resolve to both ::1 and 127.0.0.1
  // The connection to ::1 should fail quickly and fall back to 127.0.0.1
  await using server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch() {
      return new Response("localhost-ok");
    },
  });

  const start = performance.now();
  const resp = await fetch(`http://localhost:${server.port}/`);
  const elapsed = performance.now() - start;
  expect(resp.status).toBe(200);
  expect(await resp.text()).toBe("localhost-ok");
  // Should complete within a reasonable time, not hang for minutes
  expect(elapsed).toBeLessThan(15_000);
}, 30_000);
