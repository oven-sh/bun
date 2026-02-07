import { describe, expect, it } from "bun:test";

// Regression test for https://github.com/oven-sh/bun/issues/26789
// SSE fetch to 127.0.0.1 hangs on Windows, but works with localhost.
// The issue was that on Windows, non-blocking connect returning WSAENOTCONN
// was incorrectly treated as a connection error instead of "still connecting".

describe("issue #26789: SSE fetch to 127.0.0.1 on Windows", () => {
  it("should receive SSE messages from 127.0.0.1", async () => {
    const messages = ["message 0", "message 1", "message 2"];

    using server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch(req) {
        if (req.url.endsWith("/event")) {
          return new Response(
            new ReadableStream({
              async start(controller) {
                for (const msg of messages) {
                  controller.enqueue(`data: ${msg}\n\n`);
                  await Bun.sleep(10);
                }
                controller.close();
              },
            }),
            { headers: { "Content-Type": "text/event-stream" } },
          );
        }
        return new Response("Not Found", { status: 404 });
      },
    });

    // Use explicit 127.0.0.1 IP address in the fetch URL
    const response = await fetch(`http://127.0.0.1:${server.port}/event`);
    expect(response.ok).toBe(true);
    expect(response.headers.get("content-type")).toBe("text/event-stream");

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let received = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += decoder.decode(value);
    }

    // Verify all messages were received
    for (const msg of messages) {
      expect(received).toContain(`data: ${msg}`);
    }
  });

  it("should be able to make multiple concurrent fetch requests to 127.0.0.1", async () => {
    using server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch(req) {
        const url = new URL(req.url);
        const id = url.searchParams.get("id");
        return new Response(`response ${id}`);
      },
    });

    // Make multiple concurrent requests to test connection handling
    const requests = Array.from({ length: 5 }, (_, i) =>
      fetch(`http://127.0.0.1:${server.port}/?id=${i}`).then(r => r.text()),
    );

    const results = await Promise.all(requests);

    for (let i = 0; i < 5; i++) {
      expect(results[i]).toBe(`response ${i}`);
    }
  });

  it("should handle streaming response from 127.0.0.1", async () => {
    const chunks = ["chunk1", "chunk2", "chunk3"];

    using server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch(req) {
        return new Response(
          new ReadableStream({
            async start(controller) {
              for (const chunk of chunks) {
                controller.enqueue(new TextEncoder().encode(chunk));
                await Bun.sleep(5);
              }
              controller.close();
            },
          }),
        );
      },
    });

    const response = await fetch(`http://127.0.0.1:${server.port}/`);
    const text = await response.text();

    expect(text).toBe(chunks.join(""));
  });
});
