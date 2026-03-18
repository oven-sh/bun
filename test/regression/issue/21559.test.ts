import { expect, test } from "bun:test";

// Test that stopping a server and then sending a request doesn't crash with a segfault.
// Previously, after server.stop() downgraded the JS reference to weak, GC could collect
// the JS wrapper while uWS route handlers were still registered, causing a null pointer
// dereference in routeListGetCachedValue.
test("server does not crash after stop() when requests arrive", async () => {
  const server = Bun.serve({
    port: 0,
    routes: {
      "/test": () => new Response("ok"),
    },
    fetch(req) {
      return new Response("fallback");
    },
  });

  const url = `http://${server.hostname}:${server.port}`;

  // Verify server works
  const res = await fetch(`${url}/test`);
  expect(res.status).toBe(200);
  expect(await res.text()).toBe("ok");

  server.stop();

  // After stop(), the server should gracefully reject or not accept new connections.
  // The key invariant: no segfault/crash.
  try {
    // This may fail with a connection error, which is fine.
    // The important thing is that Bun doesn't crash.
    await fetch(`${url}/test`, { signal: AbortSignal.timeout(1000) });
  } catch {
    // Connection refused or timeout is expected after stop()
  }
});

test("server does not crash when JS wrapper could be GC'd during request handling", async () => {
  // Create a server with routes (which uses routeListGetCached internally)
  const server = Bun.serve({
    port: 0,
    routes: {
      "/api": () => new Response("api response"),
      "/health": () => new Response("healthy"),
    },
    fetch(req) {
      return new Response("default");
    },
  });

  const url = `http://${server.hostname}:${server.port}`;

  // Send multiple concurrent requests
  const promises = [];
  for (let i = 0; i < 10; i++) {
    promises.push(fetch(`${url}/api`).then(r => r.text()));
    promises.push(fetch(`${url}/health`).then(r => r.text()));
  }

  const results = await Promise.all(promises);
  for (let i = 0; i < results.length; i += 2) {
    expect(results[i]).toBe("api response");
    expect(results[i + 1]).toBe("healthy");
  }

  // Force GC to stress-test the JS wrapper lifecycle
  Bun.gc(true);

  // Send more requests after GC
  const res = await fetch(`${url}/api`);
  expect(res.status).toBe(200);
  expect(await res.text()).toBe("api response");

  server.stop();
});
