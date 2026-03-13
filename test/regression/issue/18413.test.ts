import { serve } from "bun";
import { expect, test } from "bun:test";
import { Readable } from "node:stream";
import { createGzip } from "node:zlib";

/**
 * Regression test for issue #18413
 * "Decompression error: ShortRead - empty chunked gzip response breaks fetch()"
 *
 * The issue was in Bun's zlib.zig implementation, which was incorrectly returning
 * error.ShortRead when encountering empty gzip streams (when avail_in == 0).
 *
 * The fix is to call inflate() even when avail_in == 0, as this could be a valid
 * empty gzip stream with proper headers/trailers. If inflate returns BufError
 * with avail_in == 0, then we know we truly need more data and can return ShortRead.
 */

test("empty chunked gzip response should work", async () => {
  using server = serve({
    port: 0,
    async fetch(req) {
      // Create an empty gzip stream
      const gzipStream = createGzip();
      gzipStream.end(); // End immediately without writing data

      // Convert to web stream
      const webStream = Readable.toWeb(gzipStream);

      return new Response(webStream, {
        headers: {
          "Content-Encoding": "gzip",
          "Transfer-Encoding": "chunked",
          "Content-Type": "text/plain",
        },
      });
    },
  });

  const response = await fetch(`http://localhost:${server.port}`);
  expect(response.status).toBe(200);

  // This should not throw "Decompression error: ShortRead"
  const text = await response.text();
  expect(text).toBe(""); // Empty response
});

test("empty gzip response without chunked encoding", async () => {
  using server = serve({
    port: 0,
    async fetch(req) {
      // Create an empty gzip buffer
      const emptyGzip = Bun.gzipSync(Buffer.alloc(0));

      return new Response(emptyGzip, {
        headers: {
          "Content-Encoding": "gzip",
          "Content-Type": "text/plain",
          "Content-Length": emptyGzip.length.toString(),
        },
      });
    },
  });

  const response = await fetch(`http://localhost:${server.port}`);
  expect(response.status).toBe(200);

  const text = await response.text();
  expect(text).toBe("");
});

test("empty chunked response without gzip", async () => {
  using server = serve({
    port: 0,
    async fetch(req) {
      return new Response(
        new ReadableStream({
          start(controller) {
            // Just close immediately
            controller.close();
          },
        }),
        {
          headers: {
            "Transfer-Encoding": "chunked",
            "Content-Type": "text/plain",
          },
        },
      );
    },
  });

  const response = await fetch(`http://localhost:${server.port}`);
  expect(response.status).toBe(200);

  const text = await response.text();
  expect(text).toBe("");
});
