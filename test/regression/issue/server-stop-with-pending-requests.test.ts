import { expect, test } from "bun:test";

// Regression test for server assertion failure when stopping with pending requests
// This test ensures that calling server.stop() immediately after making requests
// (including non-awaited ones) doesn't cause an assertion failure.
test("server.stop() with pending requests should not cause assertion failure", async () => {
  // Create initial server
  let server = Bun.serve({
    port: 0,
    fetch(req) {
      return new Response("OK");
    },
  });

  try {
    // Make one awaited request
    await fetch(server.url).catch(() => {});

    // Make one non-awaited request
    fetch(server.url).catch(() => {});

    // Stop immediately - this should not cause an assertion failure
    server.stop();

    // If we get here without crashing, the fix worked
    expect(true).toBe(true);
  } finally {
    // Ensure cleanup in case test fails
    try {
      server.stop();
    } catch {}
  }
});

// Additional test to ensure server still works normally after the fix
test("server still works normally after jsref changes", async () => {
  let server = Bun.serve({
    port: 0,
    fetch(req) {
      return new Response("Hello World");
    },
  });

  try {
    const response = await fetch(server.url);
    const text = await response.text();
    expect(text).toBe("Hello World");
    expect(response.status).toBe(200);
  } finally {
    server.stop();
  }
});
