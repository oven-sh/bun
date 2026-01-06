import { heapStats } from "bun:jsc";
import { describe, expect, test } from "bun:test";

describe("FetchTasklet cyclic reference", () => {
  test("fetch with request body stream should not leak with cyclic reference", async () => {
    await using server = Bun.serve({
      port: 0,
      async fetch(req) {
        const body = await req.text();
        return new Response(`received: ${body}`);
      },
    });

    const url = `http://localhost:${server.port}/`;

    async function leak() {
      const requestBody = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("request body"));
          controller.close();
        },
      });

      const request = new Request(url, {
        method: "POST",
        body: requestBody,
      });

      // Create cyclic reference
      // @ts-ignore
      requestBody.request = request;
      // @ts-ignore
      request.bodyStream = requestBody;

      const response = await fetch(request);
      return await response.text();
    }

    for (let i = 0; i < 500; i++) {
      await leak();
    }

    await Bun.sleep(10);
    Bun.gc(true);
    await Bun.sleep(10);
    Bun.gc(true);

    const requestCount = heapStats().objectTypeCounts.Request || 0;
    const readableStreamCount = heapStats().objectTypeCounts.ReadableStream || 0;
    expect(requestCount).toBeLessThanOrEqual(100);
    expect(readableStreamCount).toBeLessThanOrEqual(100);
  });

  test("fetch with ReadableStream body should not leak streams", async () => {
    await using server = Bun.serve({
      port: 0,
      async fetch(req) {
        const body = await req.text();
        return new Response(`received: ${body}`);
      },
    });

    const url = `http://localhost:${server.port}/`;

    async function leak() {
      const requestBody = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("request body"));
          controller.close();
        },
      });

      // Use ReadableStream directly with fetch, no Request object, no cyclic reference
      const response = await fetch(url, {
        method: "POST",
        body: requestBody,
      });
      return await response.text();
    }

    for (let i = 0; i < 500; i++) {
      await leak();
    }

    await Bun.sleep(10);
    Bun.gc(true);
    await Bun.sleep(10);
    Bun.gc(true);

    const readableStreamCount = heapStats().objectTypeCounts.ReadableStream || 0;
    // This currently fails with ~502 streams leaked
    expect(readableStreamCount).toBeLessThanOrEqual(100);
  });
});
