import { expect, test } from "bun:test";

// https://github.com/oven-sh/bun/issues/26171
// res.addTrailers() before res.writeHead() and res.end() should silently discard
// trailers when chunked encoding is not enabled, matching Node.js behavior.

// Direct test using node:http server - this is the exact reproduction from the issue
test("node:http server - addTrailers before writeHead should not throw", async () => {
  const { createServer } = await import("node:http");

  const server = createServer((req, res) => {
    // Add trailers before writeHead - per Node.js docs, these should be silently discarded
    // when chunked encoding is not used
    res.addTrailers({ "Content-MD5": "7895bf4b8828b55ceaf47747b4bca667" });
    res.writeHead(200);
    res.end("OK");
  });

  await new Promise<void>(resolve => {
    server.listen(0, () => resolve());
  });

  const port = (server.address() as any).port;

  try {
    const response = await fetch(`http://localhost:${port}`);
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toBe("OK");
  } finally {
    server.close();
  }
});

// Test with explicit Content-Length header
test("node:http server - addTrailers with Content-Length should be silently discarded", async () => {
  const { createServer } = await import("node:http");

  const server = createServer((req, res) => {
    // Add trailers before writeHead - per Node.js docs, these should be silently discarded
    res.addTrailers({ "Content-MD5": "7895bf4b8828b55ceaf47747b4bca667" });
    res.writeHead(200, { "Content-Length": "2" });
    res.end("OK");
  });

  await new Promise<void>(resolve => {
    server.listen(0, () => resolve());
  });

  const port = (server.address() as any).port;

  try {
    const response = await fetch(`http://localhost:${port}`);
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toBe("OK");
  } finally {
    server.close();
  }
});

// Test that trailers work correctly with chunked encoding
test("node:http server - addTrailers with chunked encoding works", async () => {
  const { createServer } = await import("node:http");

  const server = createServer((req, res) => {
    // When using chunked encoding (no Content-Length), trailers should work
    res.writeHead(200, { "Transfer-Encoding": "chunked", "Trailer": "Content-MD5" });
    res.write("Hello");
    res.addTrailers({ "Content-MD5": "7895bf4b8828b55ceaf47747b4bca667" });
    res.end();
  });

  await new Promise<void>(resolve => {
    server.listen(0, () => resolve());
  });

  const port = (server.address() as any).port;

  try {
    const response = await fetch(`http://localhost:${port}`);
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toBe("Hello");
  } finally {
    server.close();
  }
});

// Test that explicit Trailer header without chunked encoding still throws
test("node:http server - explicit Trailer header with Content-Length throws", async () => {
  const { createServer } = await import("node:http");
  let errorCode: string | null = null;

  const server = createServer((req, res) => {
    // Setting the Trailer header explicitly should throw when not using chunked encoding
    try {
      res.writeHead(200, { "Content-Length": "2", "Trailer": "Content-MD5" });
      res.end("OK");
    } catch (e: any) {
      errorCode = e.code;
      // Can't call writeHead again after it threw, so just destroy the socket
      res.socket?.destroy();
    }
  });

  await new Promise<void>(resolve => {
    server.listen(0, () => resolve());
  });

  const port = (server.address() as any).port;

  try {
    await fetch(`http://localhost:${port}`).catch(() => {});
    // The error should have been caught
    expect(errorCode).toBe("ERR_HTTP_TRAILER_INVALID");
  } finally {
    server.close();
  }
});
