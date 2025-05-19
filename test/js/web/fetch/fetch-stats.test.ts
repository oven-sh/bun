import { describe, expect, it } from "bun:test";
import "harness";

describe("fetch.stats", () => {
  it("tracks request statistics", async () => {
    // Save initial stats
    const initialStats = {
      requests: fetch.stats.requests,
      bytesWritten: fetch.stats.bytesWritten,
      bytesRead: fetch.stats.bytesRead,
      success: fetch.stats.success,
      active: fetch.stats.active,
      fail: fetch.stats.fail,
      redirect: fetch.stats.redirect,
      timeout: fetch.stats.timeout,
      refused: fetch.stats.refused,
    };

    // Start a server
    const responseBody = "Hello, World!";
    const requestBody = "Test request body";

    using server = Bun.serve({
      port: 0, // Use any available port
      fetch(req) {
        return new Response(responseBody, {
          headers: { "Content-Type": "text/plain" },
        });
      },
    });

    // Make a fetch request with a body
    const response = await fetch(server.url, {
      method: "POST",
      body: requestBody,
    });

    const responseText = await response.text();
    expect(responseText).toBe(responseBody);

    // Verify stats were updated
    expect(fetch.stats.requests).toBe(initialStats.requests + 1);
    expect(fetch.stats.success).toBe(initialStats.success + 1);
    expect(fetch.stats.bytesWritten).toBeGreaterThan(initialStats.bytesWritten);
    expect(fetch.stats.bytesRead).toBeGreaterThan(initialStats.bytesRead);

    // Active should return to the same value after request completes
    expect(fetch.stats.active).toBe(initialStats.active);
  });

  it("tracks multiple concurrent requests", async () => {
    const initialActive = fetch.stats.active;
    const initialRequests = fetch.stats.requests;

    // Start a server that delays responses
    using server = Bun.serve({
      port: 0,
      async fetch(req) {
        await Bun.sleep(50); // Small delay to ensure concurrent requests
        return new Response("OK");
      },
    });

    // Start multiple requests without awaiting them
    const requests = Array.from({ length: 5 }, () => fetch(server.url).then(r => r.blob()));

    // Check active requests increased
    expect(fetch.stats.active).toBeGreaterThan(initialActive);
    expect(fetch.stats.requests).toBe(initialRequests + 5);

    // Wait for all requests to complete
    await Promise.all(requests);

    // Active should return to initial value
    expect(fetch.stats.active).toBe(initialActive);
  });

  it("tracks failed requests", async () => {
    const initialFail = fetch.stats.fail;

    // Try to connect to a non-existent server
    try {
      await fetch("http://localhost:54321");
    } catch (error) {
      // Expected to fail
    }

    expect(fetch.stats.fail).toBe(initialFail + 1);
  });

  it("has all expected properties", () => {
    const expectedProperties = [
      "requests",
      "bytesWritten",
      "bytesRead",
      "fail",
      "redirect",
      "success",
      "timeout",
      "refused",
      "active",
    ] as const;

    for (const prop of expectedProperties) {
      expect(fetch.stats).toHaveProperty(prop);
      expect(fetch.stats[prop]).toBeTypeOf("number");
    }
  });
});
