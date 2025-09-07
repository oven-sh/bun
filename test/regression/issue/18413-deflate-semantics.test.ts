import { serve } from "bun";
import { expect, test } from "bun:test";
import { deflateRawSync, deflateSync } from "node:zlib";

/**
 * Test deflate semantics - both zlib-wrapped and raw deflate
 *
 * HTTP Content-Encoding: deflate is ambiguous:
 * - RFC 2616 (HTTP/1.1) says it should be zlib format (RFC 1950)
 * - Many implementations incorrectly use raw deflate (RFC 1951)
 *
 * Bun should handle both gracefully, auto-detecting the format.
 */

// Test data
const testData = Buffer.from("Hello, World! This is a test of deflate encoding.");

// Test zlib-wrapped deflate (RFC 1950 - has 2-byte header and 4-byte Adler32 trailer)
test("deflate with zlib wrapper should work", async () => {
  using server = serve({
    port: 0,
    async fetch(req) {
      // Create zlib-wrapped deflate (this is what the spec says deflate should be)
      const compressed = deflateSync(testData);

      // Verify it has a zlib header: CMF must be 0x78 and (CMF<<8 | FLG) % 31 == 0
      expect(compressed[0]).toBe(0x78);
      expect(((compressed[0] << 8) | compressed[1]) % 31).toBe(0);
      return new Response(compressed, {
        headers: {
          "Content-Encoding": "deflate",
          "Content-Type": "text/plain",
        },
      });
    },
  });

  const response = await fetch(`http://localhost:${server.port}`);
  const text = await response.text();
  expect(text).toBe(testData.toString());
});

// Test raw deflate (RFC 1951 - no header/trailer, just compressed data)
test("raw deflate without zlib wrapper should work", async () => {
  using server = serve({
    port: 0,
    async fetch(req) {
      // Create raw deflate (no zlib wrapper)
      const compressed = deflateRawSync(testData);

      // Verify it doesn't have zlib header (shouldn't start with 0x78)
      expect(compressed[0]).not.toBe(0x78);

      return new Response(compressed, {
        headers: {
          "Content-Encoding": "deflate",
          "Content-Type": "text/plain",
        },
      });
    },
  });

  const response = await fetch(`http://localhost:${server.port}`);
  const text = await response.text();
  expect(text).toBe(testData.toString());
});

// Test empty zlib-wrapped deflate
test("empty zlib-wrapped deflate should work", async () => {
  using server = serve({
    port: 0,
    async fetch(req) {
      const compressed = deflateSync(Buffer.alloc(0));

      return new Response(compressed, {
        headers: {
          "Content-Encoding": "deflate",
          "Content-Type": "text/plain",
        },
      });
    },
  });

  const response = await fetch(`http://localhost:${server.port}`);
  const text = await response.text();
  expect(text).toBe("");
});

// Test empty raw deflate
test("empty raw deflate should work", async () => {
  using server = serve({
    port: 0,
    async fetch(req) {
      const compressed = deflateRawSync(Buffer.alloc(0));

      return new Response(compressed, {
        headers: {
          "Content-Encoding": "deflate",
          "Content-Type": "text/plain",
        },
      });
    },
  });

  const response = await fetch(`http://localhost:${server.port}`);
  const text = await response.text();
  expect(text).toBe("");
});

// Test chunked zlib-wrapped deflate
test("chunked zlib-wrapped deflate should work", async () => {
  using server = serve({
    port: 0,
    async fetch(req) {
      const compressed = deflateSync(testData);
      const mid = Math.floor(compressed.length / 2);

      return new Response(
        new ReadableStream({
          async start(controller) {
            controller.enqueue(compressed.slice(0, mid));
            await Bun.sleep(50);
            controller.enqueue(compressed.slice(mid));
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
  const text = await response.text();
  expect(text).toBe(testData.toString());
});

// Test chunked raw deflate
test("chunked raw deflate should work", async () => {
  using server = serve({
    port: 0,
    async fetch(req) {
      const compressed = deflateRawSync(testData);
      const mid = Math.floor(compressed.length / 2);

      return new Response(
        new ReadableStream({
          async start(controller) {
            controller.enqueue(compressed.slice(0, mid));
            await Bun.sleep(50);
            controller.enqueue(compressed.slice(mid));
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
  const text = await response.text();
  expect(text).toBe(testData.toString());
});

// Test truncated zlib-wrapped deflate (missing trailer)
test("truncated zlib-wrapped deflate should fail", async () => {
  using server = serve({
    port: 0,
    async fetch(req) {
      const compressed = deflateSync(testData);
      // Remove the 4-byte Adler32 trailer
      const truncated = compressed.slice(0, -4);

      return new Response(truncated, {
        headers: {
          "Content-Encoding": "deflate",
          "Content-Type": "text/plain",
        },
      });
    },
  });

  try {
    const response = await fetch(`http://localhost:${server.port}`);
    await response.text();
    expect.unreachable("Should have thrown decompression error");
  } catch (err: any) {
    expect(err.code).toMatch(/ZlibError|ShortRead/);
  }
});

// Test invalid deflate data (not deflate at all)
test("invalid deflate data should fail", async () => {
  using server = serve({
    port: 0,
    async fetch(req) {
      // Random bytes that are neither zlib-wrapped nor raw deflate
      const invalid = new Uint8Array([0xff, 0xfe, 0xfd, 0xfc, 0xfb]);

      return new Response(invalid, {
        headers: {
          "Content-Encoding": "deflate",
          "Content-Type": "text/plain",
        },
      });
    },
  });

  try {
    const response = await fetch(`http://localhost:${server.port}`);
    await response.text();
    expect.unreachable("Should have thrown decompression error");
  } catch (err: any) {
    expect(err.code).toMatch(/ZlibError/);
  }
});

/**
 * Documentation of deflate semantics in Bun:
 *
 * When Content-Encoding: deflate is received, Bun's HTTP client should:
 * 1. Attempt to decompress as zlib format (RFC 1950) first
 * 2. If that fails with a header error, retry as raw deflate (RFC 1951)
 * 3. This handles both correct implementations and common misimplementations
 *
 * The zlib format has:
 * - 2-byte header with compression method and flags
 * - Compressed data using DEFLATE algorithm
 * - 4-byte Adler-32 checksum trailer
 *
 * Raw deflate has:
 * - Just the compressed data, no header or trailer
 *
 * Empty streams:
 * - Empty zlib-wrapped: Has header and trailer, total ~8 bytes
 * - Empty raw deflate: Minimal DEFLATE stream, ~2-3 bytes
 */
