import { serve } from "bun";
import { expect, test } from "bun:test";

/**
 * Comprehensive test to ensure all compression algorithms handle empty streams correctly
 * Related to issue #18413 - we fixed this for gzip, now verifying brotli and zstd work too
 */

test("empty chunked brotli response should work", async () => {
  using server = serve({
    port: 0,
    async fetch(req) {
      // Create an empty brotli buffer using the proper API
      const { brotliCompressSync } = require("node:zlib");
      const emptyBrotli = brotliCompressSync(Buffer.alloc(0));

      // Return as chunked response
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(emptyBrotli);
            controller.close();
          },
        }),
        {
          headers: {
            "Content-Encoding": "br",
            "Transfer-Encoding": "chunked",
            "Content-Type": "text/plain",
          },
        },
      );
    },
  });

  const response = await fetch(`http://localhost:${server.port}`);
  expect(response.status).toBe(200);

  // Should not throw decompression error
  const text = await response.text();
  expect(text).toBe("");
});

test("empty non-chunked brotli response", async () => {
  using server = serve({
    port: 0,
    async fetch(req) {
      // Create an empty brotli buffer using the proper API
      const { brotliCompressSync } = require("node:zlib");
      const emptyBrotli = brotliCompressSync(Buffer.alloc(0));

      return new Response(emptyBrotli, {
        headers: {
          "Content-Encoding": "br",
          "Content-Type": "text/plain",
          "Content-Length": emptyBrotli.length.toString(),
        },
      });
    },
  });

  const response = await fetch(`http://localhost:${server.port}`);
  expect(response.status).toBe(200);

  const text = await response.text();
  expect(text).toBe("");
});

test("empty chunked zstd response should work", async () => {
  using server = serve({
    port: 0,
    async fetch(req) {
      // Create an empty zstd buffer using the proper API
      const emptyZstd = Bun.zstdCompressSync(Buffer.alloc(0));

      // Return as chunked response
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(emptyZstd);
            controller.close();
          },
        }),
        {
          headers: {
            "Content-Encoding": "zstd",
            "Transfer-Encoding": "chunked",
            "Content-Type": "text/plain",
          },
        },
      );
    },
  });

  const response = await fetch(`http://localhost:${server.port}`);
  expect(response.status).toBe(200);

  // Should not throw decompression error
  const text = await response.text();
  expect(text).toBe("");
});

test("empty non-chunked zstd response", async () => {
  using server = serve({
    port: 0,
    async fetch(req) {
      // Create an empty zstd buffer using the proper API
      const emptyZstd = Bun.zstdCompressSync(Buffer.alloc(0));

      return new Response(emptyZstd, {
        headers: {
          "Content-Encoding": "zstd",
          "Content-Type": "text/plain",
          "Content-Length": emptyZstd.length.toString(),
        },
      });
    },
  });

  const response = await fetch(`http://localhost:${server.port}`);
  expect(response.status).toBe(200);

  const text = await response.text();
  expect(text).toBe("");
});

test("empty chunked deflate response should work", async () => {
  using server = serve({
    port: 0,
    async fetch(req) {
      // Create an empty deflate buffer
      const emptyDeflate = Bun.deflateSync(Buffer.alloc(0));

      // Return as chunked response
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(emptyDeflate);
            controller.close();
          },
        }),
        {
          headers: {
            "Content-Encoding": "deflate",
            "Transfer-Encoding": "chunked",
            "Content-Type": "text/plain",
          },
        },
      );
    },
  });

  const response = await fetch(`http://localhost:${server.port}`);
  expect(response.status).toBe(200);

  // Should not throw decompression error
  const text = await response.text();
  expect(text).toBe("");
});

test("empty non-chunked deflate response", async () => {
  using server = serve({
    port: 0,
    async fetch(req) {
      // Create an empty deflate buffer
      const emptyDeflate = Bun.deflateSync(Buffer.alloc(0));

      return new Response(emptyDeflate, {
        headers: {
          "Content-Encoding": "deflate",
          "Content-Type": "text/plain",
          "Content-Length": emptyDeflate.length.toString(),
        },
      });
    },
  });

  const response = await fetch(`http://localhost:${server.port}`);
  expect(response.status).toBe(200);

  const text = await response.text();
  expect(text).toBe("");
});
