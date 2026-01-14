import { heapStats } from "bun:jsc";
import { describe, expect, test } from "bun:test";

describe("Bun.serve response stream leak", () => {
  test("proxy server forwarding streaming response should not leak", async () => {
    // Backend server that returns a streaming response with delay
    await using backend = Bun.serve({
      port: 0,
      fetch(req) {
        const stream = new ReadableStream({
          async start(controller) {
            controller.enqueue(new TextEncoder().encode("chunk1"));
            await Bun.sleep(10);
            controller.enqueue(new TextEncoder().encode("chunk2"));
            controller.close();
          },
        });
        return new Response(stream);
      },
    });

    // Proxy server that forwards the response body stream
    await using proxy = Bun.serve({
      port: 0,
      async fetch(req) {
        const backendResponse = await fetch(`http://localhost:${backend.port}/`);
        return new Response(backendResponse.body);
      },
    });

    const url = `http://localhost:${proxy.port}/`;

    async function leak() {
      const response = await fetch(url);
      return await response.text();
    }

    for (let i = 0; i < 200; i++) {
      await leak();
    }

    await Bun.sleep(10);
    Bun.gc(true);
    await Bun.sleep(10);
    Bun.gc(true);

    const readableStreamCount = heapStats().objectTypeCounts.ReadableStream || 0;
    const responseCount = heapStats().objectTypeCounts.Response || 0;
    expect(readableStreamCount).toBeLessThanOrEqual(50);
    expect(responseCount).toBeLessThanOrEqual(50);
  });
});
