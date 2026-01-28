import { expect, test } from "bun:test";

// Test for GitHub issue #18854
// Azure Storage file uploads fail because Bun strips user-provided Content-Length
// headers on streaming bodies and replaces them with Transfer-Encoding: chunked

test("fetch should preserve Content-Length header when explicitly provided with streaming body", async () => {
  const bodyData = "x".repeat(100000); // >64KB to ensure it's a meaningful test
  const contentLength = Buffer.byteLength(bodyData);

  // Create a streaming body using an async generator
  async function* streamBody() {
    yield bodyData;
  }

  let receivedHeaders: Headers | null = null;

  using server = Bun.serve({
    port: 0,
    async fetch(req) {
      receivedHeaders = req.headers;
      await req.text(); // consume body
      return new Response("ok");
    },
  });

  await fetch(`http://localhost:${server.port}/test`, {
    method: "POST",
    headers: {
      "Content-Length": String(contentLength),
    },
    body: streamBody() as any,
    duplex: "half",
  });

  // Verify Content-Length is preserved and Transfer-Encoding is not used
  expect(receivedHeaders?.get("content-length")).toBe(String(contentLength));
  expect(receivedHeaders?.get("transfer-encoding")).toBeNull();
});

test("fetch should preserve Content-Length header with ReadableStream body", async () => {
  const bodyData = "y".repeat(50000);
  const contentLength = Buffer.byteLength(bodyData);

  // Create a ReadableStream body
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(bodyData));
      controller.close();
    },
  });

  let receivedHeaders: Headers | null = null;

  using server = Bun.serve({
    port: 0,
    async fetch(req) {
      receivedHeaders = req.headers;
      await req.text(); // consume body
      return new Response("ok");
    },
  });

  await fetch(`http://localhost:${server.port}/test`, {
    method: "POST",
    headers: {
      "Content-Length": String(contentLength),
    },
    body: stream,
    duplex: "half",
  });

  // Verify Content-Length is preserved and Transfer-Encoding is not used
  expect(receivedHeaders?.get("content-length")).toBe(String(contentLength));
  expect(receivedHeaders?.get("transfer-encoding")).toBeNull();
});

test("fetch should use chunked encoding when Content-Length is not provided for streaming body", async () => {
  const bodyData = "z".repeat(10000);

  async function* streamBody() {
    yield bodyData;
  }

  let receivedHeaders: Headers | null = null;

  using server = Bun.serve({
    port: 0,
    async fetch(req) {
      receivedHeaders = req.headers;
      await req.text(); // consume body
      return new Response("ok");
    },
  });

  await fetch(`http://localhost:${server.port}/test`, {
    method: "POST",
    body: streamBody() as any,
    duplex: "half",
  });

  // Without explicit Content-Length, chunked encoding should be used
  expect(receivedHeaders?.get("transfer-encoding")).toBe("chunked");
  expect(receivedHeaders?.get("content-length")).toBeNull();
});
