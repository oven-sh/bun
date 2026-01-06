import { heapStats } from "bun:jsc";
import { afterAll, describe, expect, test } from "bun:test";

describe("FetchTasklet cyclic reference", () => {
  let server: ReturnType<typeof Bun.serve> | null = null;

  afterAll(() => {
    server?.stop(true);
  });

  test("response stream should not leak when response has cyclic reference", async () => {
    server = Bun.serve({
      port: 0,
      fetch(req) {
        return new Response("hello world");
      },
    });

    const url = `http://localhost:${server.port}/`;

    async function leak() {
      const response = await fetch(url);
      const text = await response.text();

      // Create cyclic reference: response -> body stream -> response
      // @ts-ignore
      response.selfRef = response;

      return text;
    }

    for (let i = 0; i < 1000; i++) {
      await leak();
    }

    await Bun.sleep(10);
    Bun.gc(true);
    await Bun.sleep(10);
    Bun.gc(true);

    const responseCount = heapStats().objectTypeCounts.Response || 0;
    expect(responseCount).toBeLessThanOrEqual(100);
  });

  test("response stream should not leak when streaming response body with cyclic reference", async () => {
    server?.stop(true);
    server = Bun.serve({
      port: 0,
      fetch(req) {
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("streaming "));
            controller.enqueue(new TextEncoder().encode("response "));
            controller.enqueue(new TextEncoder().encode("body"));
            controller.close();
          },
        });
        return new Response(stream);
      },
    });

    const url = `http://localhost:${server.port}/`;

    async function leak() {
      const response = await fetch(url);

      // Create cyclic reference before consuming body
      // @ts-ignore
      response.selfRef = response;

      // Get the body as a stream
      const reader = response.body!.getReader();
      const chunks: Uint8Array[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }

      return new TextDecoder().decode(Buffer.concat(chunks));
    }

    for (let i = 0; i < 500; i++) {
      await leak();
    }

    await Bun.sleep(10);
    Bun.gc(true);
    await Bun.sleep(10);
    Bun.gc(true);

    const responseCount = heapStats().objectTypeCounts.Response || 0;
    const readableStreamCount = heapStats().objectTypeCounts.ReadableStream || 0;
    expect(responseCount).toBeLessThanOrEqual(100);
    expect(readableStreamCount).toBeLessThanOrEqual(100);
  });

  test("response should not leak when body stream references response", async () => {
    server?.stop(true);
    server = Bun.serve({
      port: 0,
      fetch(req) {
        return new Response("test body content");
      },
    });

    const url = `http://localhost:${server.port}/`;

    async function leak() {
      const response = await fetch(url);
      const body = response.body;

      // Create cyclic reference: body stream -> response -> body stream
      // @ts-ignore
      if (body) body.response = response;
      // @ts-ignore
      response.bodyStream = body;

      await response.text();
    }

    for (let i = 0; i < 1000; i++) {
      await leak();
    }

    await Bun.sleep(10);
    Bun.gc(true);
    await Bun.sleep(10);
    Bun.gc(true);

    const responseCount = heapStats().objectTypeCounts.Response || 0;
    expect(responseCount).toBeLessThanOrEqual(100);
  });

  test("fetch with request body stream should not leak with cyclic reference", async () => {
    server?.stop(true);
    server = Bun.serve({
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
    server?.stop(true);
    server = Bun.serve({
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

  test("multiple concurrent fetches should not leak with cyclic references", async () => {
    server?.stop(true);
    server = Bun.serve({
      port: 0,
      fetch(req) {
        return new Response("concurrent test");
      },
    });

    const url = `http://localhost:${server.port}/`;

    async function leak() {
      const responses = await Promise.all([fetch(url), fetch(url), fetch(url)]);

      // Create cyclic references between responses
      // @ts-ignore
      responses[0].next = responses[1];
      // @ts-ignore
      responses[1].next = responses[2];
      // @ts-ignore
      responses[2].next = responses[0];

      await Promise.all(responses.map(r => r.text()));
    }

    for (let i = 0; i < 300; i++) {
      await leak();
    }

    await Bun.sleep(10);
    Bun.gc(true);
    await Bun.sleep(10);
    Bun.gc(true);

    const responseCount = heapStats().objectTypeCounts.Response || 0;
    expect(responseCount).toBeLessThanOrEqual(100);
  });
});
