import { expect, test } from "bun:test";

// https://github.com/oven-sh/bun/issues/26394
// Race condition in Bun.serve() where requests can arrive before routes are fully registered,
// causing the default "Welcome to Bun!" response instead of the configured handler's response.

test("concurrent Bun.serve instances should not return Welcome to Bun", async () => {
  const serverCount = 60;
  const servers: ReturnType<typeof Bun.serve>[] = [];

  try {
    // Create many servers concurrently
    for (let i = 0; i < serverCount; i++) {
      servers.push(
        Bun.serve({
          port: 0,
          fetch: () => new Response("OK"),
        }),
      );
    }

    // Make concurrent requests to all servers
    const responses = await Promise.all(
      servers.map(async server => {
        const res = await fetch(`http://127.0.0.1:${server.port}/`);
        return res.text();
      }),
    );

    // Verify no "Welcome to Bun!" responses - check for both debug mode message and production mode
    for (let i = 0; i < responses.length; i++) {
      expect(responses[i]).not.toContain("Welcome to Bun");
      expect(responses[i]).not.toBe(""); // Production mode returns empty for renderMissing
      expect(responses[i]).toBe("OK");
    }
  } finally {
    // Clean up - guaranteed to run even if assertions fail
    for (const server of servers) {
      server.stop();
    }
  }
});

test("Bun.serve should be ready to handle requests immediately after returning", async () => {
  // Test a single server with immediate fetch - this tests if the server is ready synchronously
  using server = Bun.serve({
    port: 0,
    fetch: () => new Response("handler response"),
  });

  // Immediately fetch - if there's a race condition, this might return "Welcome to Bun!"
  const response = await fetch(`http://127.0.0.1:${server.port}/`);
  const text = await response.text();

  expect(text).toBe("handler response");
});

test("multiple sequential Bun.serve instances with immediate requests", async () => {
  // Create servers sequentially and immediately request from each
  const results: string[] = [];
  const servers: ReturnType<typeof Bun.serve>[] = [];

  try {
    for (let i = 0; i < 20; i++) {
      const server = Bun.serve({
        port: 0,
        fetch: () => new Response(`server-${i}`),
      });
      servers.push(server);

      // Immediately fetch from the server
      const response = await fetch(`http://127.0.0.1:${server.port}/`);
      results.push(await response.text());
    }

    // Verify all responses match expected
    for (let i = 0; i < results.length; i++) {
      expect(results[i]).toBe(`server-${i}`);
    }
  } finally {
    // Clean up - guaranteed to run even if assertions fail
    for (const server of servers) {
      server.stop();
    }
  }
});
