import { describe, expect, test } from "bun:test";

describe("fetch with Request body lifecycle", () => {
  test("should properly handle Request with streaming body", async () => {
    using server = Bun.serve({
      port: 0,
      async fetch(req) {
        const text = await req.text();
        return new Response(text);
      },
    });

    const chunk = new TextEncoder().encode("test data");

    const originalRequest = new Request(server.url, {
      method: "POST",
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(chunk);
          controller.close();
        },
      }),
    });

    const response = await fetch(originalRequest);
    expect(await response.text()).toBe("test data");

    // original should still be usable
    const response2 = await fetch(originalRequest);
    expect(await response2.text()).toBe("test data");
  });

  test("should handle aborted fetch with streaming Request body", async () => {
    using server = Bun.serve({
      port: 0,
      async fetch(req) {
        try {
          await req.text();
        } catch {
          // ignore abort from client
        }
        return new Response("ok");
      },
    });

    const controller = new AbortController();
    const { promise: pull_ready, resolve: resolve_pull } = Promise.withResolvers<void>();
    const { promise: cancel_notified, resolve: resolve_cancel } = Promise.withResolvers<void>();

    const stream = new ReadableStream({
      pull(controller) {
        resolve_pull();
        controller.enqueue(new TextEncoder().encode("chunk"));
      },
      cancel() {
        resolve_cancel();
      },
    });

    const request = new Request(server.url, {
      method: "POST",
      duplex: "half",
      body: stream,
    } as RequestInit & { duplex: "half" });

    const fetchPromise = fetch(request, { signal: controller.signal });
    const expect_rejection = expect(async () => await fetchPromise).toThrow();

    await pull_ready;
    controller.abort();

    await cancel_notified;
    await expect_rejection;
  });

  test("should handle multiple requests with the same streaming body", async () => {
    using server = Bun.serve({
      port: 0,
      async fetch(req) {
        const text = await req.text();
        return new Response(text);
      },
    });

    const encoder = new TextEncoder();
    const makeStream = () =>
      new ReadableStream({
        async start(controller) {
          const parts = ["original ", "data"];
          for (const part of parts) {
            controller.enqueue(encoder.encode(part));
            await Promise.resolve();
          }
          controller.close();
        },
      });

    const makeRequest = () =>
      new Request(server.url, {
        method: "POST",
        body: makeStream(),
      });

    const [r1, r2] = await Promise.all([fetch(makeRequest()), fetch(makeRequest())]);

    expect(await r1.text()).toBe("original data");
    expect(await r2.text()).toBe("original data");
  });

  // Tests memory cleanup with large payloads and mid-stream abort
  test("should not crash with large body and abort", async () => {
    using server = Bun.serve({
      port: 0,
      async fetch(req) {
        // slowly consume the body
        const reader = req.body!.getReader();
        while (true) {
          await Bun.sleep(10);
          const { done } = await reader.read();
          if (done) break;
        }
        return new Response("ok");
      },
    });

    const largeBody = Buffer.alloc(1024 * 1024, "a").toString(); // 1MB

    const request = new Request(server.url, {
      method: "POST",
      body: largeBody,
    });

    const controller = new AbortController();
    const fetchPromise = fetch(request, { signal: controller.signal });

    // abort after a short delay
    await Bun.sleep(20);
    controller.abort();

    expect(async () => await fetchPromise).toThrow();
  });

  test("should properly cleanup when server closes connection early", async () => {
    using server = Bun.serve({
      port: 0,
      async fetch() {
        // don't read the body, just close
        return new Response("closed early", { status: 200 });
      },
    });

    const request = new Request(server.url, {
      method: "POST",
      body: Buffer.alloc(1024 * 100, "x").toString(), // 100KB
    });

    // should not crash or hang
    const response = await fetch(request);
    expect(await response.text()).toBe("closed early");
  });
});
