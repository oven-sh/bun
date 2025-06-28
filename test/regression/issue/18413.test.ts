import { test, expect } from "bun:test";
import { serve } from "bun";
import { createGzip } from "node:zlib";

/**
 * Regression test for issue #18413
 * "Decompression error: ShortRead - empty chunked gzip response breaks fetch()"
 *
 * The issue was in Bun's zlib.zig implementation, which was incorrectly returning
 * error.ShortRead when encountering empty gzip streams (when avail_in == 0).
 *
 * This test verifies that fetch() properly handles empty gzip responses with
 * chunked transfer encoding.
 */

let server: ReturnType<typeof serve>;

// Test for issue #18413: Empty chunked gzip response breaks fetch()
test("empty chunked gzip response (simple case)", async () => {
  server = serve({
    async fetch(req) {
      // Create a ReadableStream that will produce an empty response
      const stream = new ReadableStream({
        start(controller) {
          // Just close the stream immediately without pushing any data
          controller.close();
        },
      });

      // Return a Response with Content-Encoding: gzip and Transfer-Encoding: chunked
      // and an empty body
      return new Response(stream, {
        headers: {
          "Content-Encoding": "gzip",
          "Transfer-Encoding": "chunked",
          "Content-Type": "text/plain",
        },
      });
    },
    port: 0, // Use random available port
  });

  try {
    const url = `http://localhost:${server.port}`;

    const response = await fetch(url);
    expect(response.status).toBe(200);

    // This is where it would fail with "Decompression error: ShortRead"
    const text = await response.text();
    expect(text).toBe(""); // We expect an empty string
  } finally {
    server.stop();
  }
});

// Test with node's zlib to create a proper gzip empty stream
test("empty chunked gzip response (using node:zlib)", async () => {
  // This test uses a custom HTTP handler to ensure proper chunked encoding
  const http = require("node:http");

  // Create a server that responds with an empty gzipped chunked response
  const nodeServer = http.createServer((req, res) => {
    res.writeHead(200, {
      "Content-Type": "text/plain",
      "Content-Encoding": "gzip",
      "Transfer-Encoding": "chunked",
    });

    // Create a gzip stream
    const gzip = createGzip();
    gzip.pipe(res);

    // End without writing any data - should create a valid empty gzip stream
    gzip.end();
  });

  // Start the server
  await new Promise(resolve => {
    nodeServer.listen(0, () => resolve());
  });

  const port = nodeServer.address().port;

  try {
    const url = `http://localhost:${port}`;

    const response = await fetch(url);
    expect(response.status).toBe(200);

    // This is where it would fail with "Decompression error: ShortRead"
    const text = await response.text();
    expect(text).toBe(""); // We expect an empty string
  } finally {
    nodeServer.close();
  }
});
