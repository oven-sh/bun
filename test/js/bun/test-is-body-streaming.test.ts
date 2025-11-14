import { expect, test } from "bun:test";

test("Bun.isBodyStreaming detects non-streaming bodies", () => {
  // Empty string body
  const emptyStringResponse = new Response("");
  expect(Bun.isBodyStreaming(emptyStringResponse)).toBe(false);

  // String body
  const stringResponse = new Response("Hello World");
  expect(Bun.isBodyStreaming(stringResponse)).toBe(false);

  // JSON body
  const jsonResponse = Response.json({ foo: "bar" });
  expect(Bun.isBodyStreaming(jsonResponse)).toBe(false);

  // Blob body
  const blobResponse = new Response(new Blob(["blob data"]));
  expect(Bun.isBodyStreaming(blobResponse)).toBe(false);

  // ArrayBuffer body
  const buffer = new TextEncoder().encode("buffer data");
  const bufferResponse = new Response(buffer);
  expect(Bun.isBodyStreaming(bufferResponse)).toBe(false);

  // FormData body
  const formData = new FormData();
  formData.append("key", "value");
  const formDataResponse = new Response(formData);
  expect(Bun.isBodyStreaming(formDataResponse)).toBe(false);

  // URLSearchParams body
  const params = new URLSearchParams({ foo: "bar" });
  const paramsResponse = new Response(params);
  expect(Bun.isBodyStreaming(paramsResponse)).toBe(false);

  // Null/empty body
  const emptyResponse = new Response();
  expect(Bun.isBodyStreaming(emptyResponse)).toBe(false);

  const nullResponse = new Response(null);
  expect(Bun.isBodyStreaming(nullResponse)).toBe(false);
});

test("Bun.isBodyStreaming detects streaming bodies", () => {
  // ReadableStream body
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("chunk1"));
      controller.enqueue(new TextEncoder().encode("chunk2"));
      controller.close();
    },
  });
  const streamResponse = new Response(stream);
  expect(Bun.isBodyStreaming(streamResponse)).toBe(true);

  // Response with empty ReadableStream
  const emptyStream = new ReadableStream({
    start(controller) {
      controller.close();
    },
  });
  const emptyStreamResponse = new Response(emptyStream);
  expect(Bun.isBodyStreaming(emptyStreamResponse)).toBe(true);

  // Response with never-ending stream
  const infiniteStream = new ReadableStream({
    start(controller) {
      // Never closes
      controller.enqueue(new TextEncoder().encode("data"));
    },
  });
  const infiniteStreamResponse = new Response(infiniteStream);
  expect(Bun.isBodyStreaming(infiniteStreamResponse)).toBe(true);
});

test("Bun.isBodyStreaming with fetch body", async () => {
  // Create a mock server that returns a streaming response
  using server = Bun.serve({
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

  // Fetch from the server
  const fetchResponse = await fetch(`http://localhost:${server.port}`);

  // Fetch responses themselves return false because the Response object
  // internally has buffered data, even though .body is a ReadableStream
  expect(Bun.isBodyStreaming(fetchResponse)).toBe(false);

  // However, if you create a NEW Response with the fetch body stream,
  // that new Response IS considered streaming since it has a ReadableStream body
  const responseFromFetchBody = new Response(fetchResponse.body);
  expect(Bun.isBodyStreaming(responseFromFetchBody)).toBe(true);
});

test("Bun.isBodyStreaming with different fetch scenarios", async () => {
  using server = Bun.serve({
    port: 0,
    fetch(req) {
      const url = new URL(req.url);

      if (url.pathname === "/text") {
        return new Response("plain text");
      } else if (url.pathname === "/json") {
        return Response.json({ data: "test" });
      } else if (url.pathname === "/stream") {
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("streaming"));
            controller.close();
          },
        });
        return new Response(stream);
      }
      return new Response("default");
    },
  });

  // Note: All fetch() responses return false because Bun buffers the response
  // This is correct! The isBodyStreaming check is meant for detecting if a Response
  // was directly constructed with a stream, not for detecting fetch responses.

  const textResponse = await fetch(`http://localhost:${server.port}/text`);
  expect(Bun.isBodyStreaming(textResponse)).toBe(false);

  const jsonResponse = await fetch(`http://localhost:${server.port}/json`);
  expect(Bun.isBodyStreaming(jsonResponse)).toBe(false);

  const streamResponse = await fetch(`http://localhost:${server.port}/stream`);
  // Even though the server returned a streaming response, by the time it reaches
  // JavaScript via fetch(), it's buffered
  expect(Bun.isBodyStreaming(streamResponse)).toBe(false);
});

test("Bun.isBodyStreaming works with Request objects", () => {
  // Non-streaming request
  const request = new Request("http://example.com", {
    method: "POST",
    body: "test data",
  });
  expect(Bun.isBodyStreaming(request)).toBe(false);

  // Streaming request
  const stream = new ReadableStream();
  const streamRequest = new Request("http://example.com", {
    method: "POST",
    body: stream,
  });
  expect(Bun.isBodyStreaming(streamRequest)).toBe(true);
});

test("Bun.isBodyStreaming handles edge cases", () => {
  // Invalid arguments should throw
  expect(() => Bun.isBodyStreaming()).toThrow();
  expect(() => Bun.isBodyStreaming("not a response")).toThrow();
  expect(() => Bun.isBodyStreaming({})).toThrow();
  expect(() => Bun.isBodyStreaming(123)).toThrow();
  expect(() => Bun.isBodyStreaming(null)).toThrow();
  expect(() => Bun.isBodyStreaming(undefined)).toThrow();
});

test("Bun.isBodyStreaming with consumed Response body", async () => {
  // After consuming the body, it should still report the original state
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("data"));
      controller.close();
    },
  });
  const response = new Response(stream);

  // Initially streaming
  expect(Bun.isBodyStreaming(response)).toBe(true);

  // Consume the body
  expect(await response.text()).toBe("data");

  // Should still be considered as having been streaming
  // (The body is now "Used" but was originally streaming)
  expect(response.bodyUsed).toBe(true);
  expect(Bun.isBodyStreaming(response)).toBe(true);
});

test("Bun.isBodyStreaming with consumed Request body", async () => {
  // Request with streaming body that gets consumed
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("request data"));
      controller.close();
    },
  });

  const request = new Request("http://example.com", {
    method: "POST",
    body: stream,
  });

  // Initially streaming
  expect(Bun.isBodyStreaming(request)).toBe(true);

  // Consume the body
  expect(await request.text()).toBe("request data");

  // Should still report as having been streaming
  expect(request.bodyUsed).toBe(true);
  expect(Bun.isBodyStreaming(request)).toBe(true);
});

test("Bun.isBodyStreaming with Response.clone()", () => {
  // Clone should preserve streaming status
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("original"));
      controller.close();
    },
  });
  const original = new Response(stream);

  // Clone the response
  const cloned = original.clone();

  // Both original and clone should report as streaming
  expect(Bun.isBodyStreaming(original)).toBe(true);
  expect(Bun.isBodyStreaming(cloned)).toBe(true);

  // Also test with non-streaming response
  const staticResponse = new Response("static");
  const clonedStatic = staticResponse.clone();

  expect(Bun.isBodyStreaming(staticResponse)).toBe(false);
  expect(Bun.isBodyStreaming(clonedStatic)).toBe(false);
});

test("Bun.isBodyStreaming with tee()", () => {
  // Create a streaming response
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("chunk1"));
      controller.enqueue(new TextEncoder().encode("chunk2"));
      controller.close();
    },
  });
  const response = new Response(stream);

  expect(Bun.isBodyStreaming(response)).toBe(true);

  // Tee the body stream
  const [stream1, stream2] = response.body.tee();

  // Create new responses from the teed streams
  const response1 = new Response(stream1);
  const response2 = new Response(stream2);

  // Both new responses should report as streaming
  expect(Bun.isBodyStreaming(response1)).toBe(true);
  expect(Bun.isBodyStreaming(response2)).toBe(true);
});
