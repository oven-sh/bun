import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

// This test verifies the fix for GitHub issue #21792:
// SNI with multiple TLS certificates caused crashes when stopping and restarting servers
describe("SNI stop/restart crash (issue #21792)", () => {
  // Use existing test certificates
  const certDir = join(import.meta.dir, "../../js/third_party/jsonwebtoken");
  const cert = readFileSync(join(certDir, "pub.pem"), "utf8");
  const key = readFileSync(join(certDir, "priv.pem"), "utf8");

  test("should not crash when reusing same port with SNI after stop", async () => {
    const tls = [
      { cert, key, serverName: "serverhost1.local" },
      { cert, key, serverName: "serverhost2.local" },
    ];

    // 1. Create first server with SNI
    let server = Bun.serve({
      port: 0,
      tls: tls,
      fetch: () => new Response("Server 1"),
      development: false,
    });

    // Make request to register the routes in uWS
    const response1 = await fetch(server.url, {
      headers: { Host: "serverhost1.local" },
      tls: { servername: "serverhost1.local", rejectUnauthorized: false },
    });
    expect(await response1.text()).toBe("Server 1");

    // 2. Stop the server - this frees the server but leaves routes in uWS
    const port = server.port;
    server.stop();

    // Force GC to ensure server is freed
    if (Bun?.gc) Bun.gc(true);
    await Bun.sleep(100);

    // 3. Create new server on SAME PORT with SNI
    // This reuses the SSL contexts which still have the old route pointers
    server = Bun.serve({
      port: port,
      tls: tls,
      fetch: () => new Response("Server 2"),
      development: false,
    });

    // 4. Make request - WITHOUT THE FIX this hits dangling pointer and crashes
    const response2 = await fetch(server.url, {
      headers: { Host: "serverhost1.local" },
      tls: { servername: "serverhost1.local", rejectUnauthorized: false },
    });

    // Should get response from new server, not crash
    expect(await response2.text()).toBe("Server 2");

    server.stop();
  });

  test("should not crash with routes object pattern", async () => {
    const tls = [
      { cert, key, serverName: "route1.local" },
      { cert, key, serverName: "route2.local" },
    ];

    // Create server with routes object (like Elysia does)
    let server = Bun.serve({
      port: 0,
      tls: tls,
      routes: {
        "/": () => new Response("Route 1"),
        "/health": () => new Response("OK 1"),
      },
      fetch: () => new Response("Fallback 1"),
      development: false,
    });

    const r1 = await fetch(server.url, {
      headers: { Host: "route1.local" },
      tls: { servername: "route1.local", rejectUnauthorized: false },
    });
    expect(await r1.text()).toBe("Route 1");

    const port = server.port;
    server.stop();
    if (Bun?.gc) Bun.gc(true);
    await Bun.sleep(100);

    // Create new server with routes on same port
    server = Bun.serve({
      port: port,
      tls: tls,
      routes: {
        "/": () => new Response("Route 2"),
        "/health": () => new Response("OK 2"),
      },
      fetch: () => new Response("Fallback 2"),
      development: false,
    });

    // This request should hit new routes, not crash with dangling pointer
    const r2 = await fetch(server.url, {
      headers: { Host: "route1.local" },
      tls: { servername: "route1.local", rejectUnauthorized: false },
    });
    expect(await r2.text()).toBe("Route 2");

    server.stop();
  });

  test("should not crash when reloading server with SNI", async () => {
    const tls = [
      { cert, key, serverName: "reload1.local" },
      { cert, key, serverName: "reload2.local" },
    ];

    let responseText = "Version 1";

    const server = Bun.serve({
      port: 0,
      tls: tls,
      fetch: () => new Response(responseText),
      development: false,
    });

    // Make initial request
    const r1 = await fetch(server.url, {
      headers: { Host: "reload1.local" },
      tls: { servername: "reload1.local", rejectUnauthorized: false },
    });
    expect(await r1.text()).toBe("Version 1");

    // Update response and reload
    responseText = "Version 2";
    server.reload({
      fetch: () => new Response(responseText),
      tls: tls,
      development: false,
    });

    await Bun.sleep(100);

    // This request should work with new handler, not crash with dangling pointer
    const r2 = await fetch(server.url, {
      headers: { Host: "reload1.local" },
      tls: { servername: "reload1.local", rejectUnauthorized: false },
    });
    expect(await r2.text()).toBe("Version 2");

    // Reload again to test multiple reloads
    responseText = "Version 3";
    server.reload({
      fetch: () => new Response(responseText),
      tls: tls,
      development: false,
    });

    await Bun.sleep(100);

    const r3 = await fetch(server.url, {
      headers: { Host: "reload2.local" },
      tls: { servername: "reload2.local", rejectUnauthorized: false },
    });
    expect(await r3.text()).toBe("Version 3");

    server.stop();
  });
});
