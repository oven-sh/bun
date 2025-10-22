import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

// This test verifies the fix for GitHub issue #21792:
// SNI with multiple TLS certificates caused crashes when stopping and restarting servers
describe("SNI stop/restart (issue #21792)", () => {
  // Use existing test certificates
  const certDir = join(import.meta.dir, "../../js/third_party/jsonwebtoken");
  const cert = readFileSync(join(certDir, "pub.pem"), "utf8");
  const key = readFileSync(join(certDir, "priv.pem"), "utf8");

  test("should not crash when stopping and restarting server with SNI", async () => {
    const tls = [
      { cert, key, serverName: "serverhost1.local" },
      { cert, key, serverName: "serverhost2.local" },
    ];

    // 1. Create server with dual certs
    using server1 = Bun.serve({
      port: 0,
      tls: tls,
      fetch: () => new Response("Server 1"),
      development: true,
    });

    // Make a request to ensure routes are registered
    const response1 = await fetch(server1.url, {
      headers: { Host: "serverhost1.local" },
      tls: { rejectUnauthorized: false },
    });
    expect(await response1.text()).toBe("Server 1");

    // 2. Stop server (this would leave dangling pointers in uWS without the fix)
    server1.stop();

    // 3. Create new server with single cert on different port
    using server2 = Bun.serve({
      port: 0,
      tls: tls[1],
      fetch: () => new Response("Server 2"),
      development: true,
    });

    const response2 = await fetch(server2.url, {
      headers: { Host: "serverhost2.local" },
      tls: { rejectUnauthorized: false },
    });
    expect(await response2.text()).toBe("Server 2");

    server2.stop();

    // 4. Create another server with dual certs (would crash here without the fix)
    using server3 = Bun.serve({
      port: 0,
      tls: tls,
      fetch: () => new Response("Server 3"),
      development: true,
    });

    // This request would cause a segfault without the fix
    const response3 = await fetch(server3.url, {
      headers: { Host: "serverhost1.local" },
      tls: { rejectUnauthorized: false },
    });
    expect(await response3.text()).toBe("Server 3");

    server3.stop();
  });

  test("should handle rapid stop/restart with SNI", async () => {
    const tls = [
      { cert, key, serverName: "rapid1.local" },
      { cert, key, serverName: "rapid2.local" },
    ];

    // Rapidly create and destroy servers with alternating configurations
    for (let i = 0; i < 5; i++) {
      const useDual = i % 2 === 0;

      using server = Bun.serve({
        port: 0,
        tls: useDual ? tls : tls[0],
        fetch: () => new Response(`Iteration ${i}`),
        development: true,
      });

      const hostname = useDual ? "rapid1.local" : "rapid1.local";
      const response = await fetch(server.url, {
        headers: { Host: hostname },
        tls: { rejectUnauthorized: false },
      });

      expect(await response.text()).toBe(`Iteration ${i}`);
      server.stop();

      // Small delay to ensure cleanup
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  });
});
