import { expect, test } from "bun:test";

// https://github.com/oven-sh/bun/issues/26387
// Request.text() fails with "TypeError: undefined is not a function" after ~4500 requests
test("Request.text() should work after many requests", async () => {
  // Create a server that reads the request body using req.text()
  using server = Bun.serve({
    port: 0,
    async fetch(req) {
      try {
        const body = await req.text();
        return new Response("ok:" + body.length);
      } catch (e) {
        return new Response(`error: ${e}`, { status: 500 });
      }
    },
  });

  const url = `http://localhost:${server.port}`;

  // Send many requests to trigger the GC conditions that caused the bug
  // The original bug occurred around 4500 requests, but we use a higher number
  // to ensure we trigger any GC-related issues
  const requestCount = 6000;

  for (let i = 0; i < requestCount; i++) {
    const body = Buffer.alloc(100, "x").toString() + `-request-${i}`;
    const response = await fetch(url, {
      method: "POST",
      body: body,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Request ${i} failed: ${text}`);
    }

    const responseText = await response.text();
    expect(responseText).toBe(`ok:${body.length}`);

    // Periodically run GC to increase likelihood of triggering the bug
    if (i % 500 === 0) {
      Bun.gc(true);
    }
  }
}, 60000);
