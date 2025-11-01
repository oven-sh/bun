import { describe, expect, test } from "bun:test";

describe("fetch with Request body lifecycle", () => {
  test("should properly handle Request with cloned body", async () => {
    using server = Bun.serve({
      port: 0,
      async fetch(req) {
        const text = await req.text();
        return new Response(text);
      },
    });

    const originalRequest = new Request(server.url, {
      method: "POST",
      body: "test data",
    });

    // clone creates a new request that might use ReadableStream internally
    const clonedRequest = originalRequest.clone();

    const response = await fetch(clonedRequest);
    expect(await response.text()).toBe("test data");

    // original should still be usable
    const response2 = await fetch(originalRequest);
    expect(await response2.text()).toBe("test data");
  });

  test("should handle aborted fetch with Request body", async () => {
    using server = Bun.serve({
      port: 0,
      async fetch() {
        await Bun.sleep(100);
        return new Response("ok");
      },
    });

    const request = new Request(server.url, {
      method: "POST",
      body: "test data that might become a stream",
    });

    const controller = new AbortController();
    const fetchPromise = fetch(request, { signal: controller.signal });

    // abort quickly
    await Bun.sleep(1);
    controller.abort();

    expect(fetchPromise).rejects.toThrow();
  });

  // (request.clone()would create ReadableStream internally)
  test("should handle multiple clones of the same Request", async () => {
    using server = Bun.serve({
      port: 0,
      async fetch(req) {
        const text = await req.text();
        return new Response(text);
      },
    });

    const originalRequest = new Request(server.url, {
      method: "POST",
      body: "original data",
    });

    const clone1 = originalRequest.clone();
    const clone2 = originalRequest.clone();
    const clone3 = clone1.clone();

    const [r1, r2, r3, r4] = await Promise.all([fetch(originalRequest), fetch(clone1), fetch(clone2), fetch(clone3)]);

    expect(await r1.text()).toBe("original data");
    expect(await r2.text()).toBe("original data");
    expect(await r3.text()).toBe("original data");
    expect(await r4.text()).toBe("original data");
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

    expect(fetchPromise).rejects.toThrow();
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
