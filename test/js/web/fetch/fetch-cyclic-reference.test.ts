import { heapStats } from "bun:jsc";
import { describe, expect, test } from "bun:test";

// In CI these files run under `bun test --parallel --isolate`, where one
// worker process runs several test files against the same JSC VM. heapStats()
// is VM-wide, so assert on the delta rather than an absolute count to avoid
// counting objects left over from the previous file in this worker.
const countOf = (name: string) => (heapStats().objectTypeCounts[name] as number) || 0;

describe("FetchTasklet cyclic reference", () => {
  test("fetch with request body stream should not leak with cyclic reference", async () => {
    const baselineRequest = countOf("Request");
    const baselineStream = countOf("ReadableStream");
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

    expect(countOf("Request") - baselineRequest).toBeLessThanOrEqual(100);
    expect(countOf("ReadableStream") - baselineStream).toBeLessThanOrEqual(100);
  });

  test("fetch with ReadableStream body should not leak streams", async () => {
    const baselineStream = countOf("ReadableStream");
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

    // This currently fails with ~502 streams leaked
    expect(countOf("ReadableStream") - baselineStream).toBeLessThanOrEqual(100);
  });
});
