import { describe, expect, test } from "bun:test";

describe("issue 25630 - streaming response proxy memory leak", () => {
  test("should not leak ReadableStream Strong references when proxying streaming responses", async () => {
    // Backend server producing streaming data
    const backendServer = Bun.serve({
      port: 0,
      async fetch(req) {
        const stream = new ReadableStream({
          async start(controller) {
            for (let i = 0; i < 3; i++) {
              await Bun.sleep(5);
              controller.enqueue(new TextEncoder().encode(`data: chunk ${i}\n\n`));
            }
            controller.close();
          },
        });
        return new Response(stream, {
          headers: { "Content-Type": "text/event-stream" },
        });
      },
    });

    // Proxy server that forwards streaming responses (simulates SvelteKit with AI SDK)
    const proxyServer = Bun.serve({
      port: 0,
      async fetch(req) {
        const response = await fetch(backendServer.url);
        // This is the pattern that leaks: passing response.body to a new Response
        return new Response(response.body, {
          headers: {
            "Content-Type": "text/event-stream",
            "Transfer-Encoding": "chunked",
          },
        });
      },
    });

    try {
      // Force GC and get initial ReadableStream count
      Bun.gc(true);
      const jsc = require("bun:jsc");
      const initialCount = jsc.heapStats().objectTypeCounts.ReadableStream ?? 0;

      // Make many requests through the proxy
      const numRequests = 20;
      for (let i = 0; i < numRequests; i++) {
        const resp = await fetch(proxyServer.url);
        // Consume the entire response to ensure stream completes
        await resp.text();
      }

      // Force GC multiple times to ensure cleanup
      for (let i = 0; i < 5; i++) {
        Bun.gc(true);
        await Bun.sleep(5);
      }

      const finalCount = jsc.heapStats().objectTypeCounts.ReadableStream ?? 0;
      const leakedStreams = finalCount - initialCount;

      // With the bug, we'd see ~numRequests leaked streams
      // With the fix, we should see very few (ideally 0, but allow some slack for timing)
      // The threshold of 10 is generous - without the fix, we'd see 20+ leaked streams
      expect(leakedStreams).toBeLessThan(10);
    } finally {
      backendServer.stop(true);
      proxyServer.stop(true);
    }
  });
});
