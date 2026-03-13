import { serve } from "bun";
import { expect, test } from "bun:test";
import { brotliCompressSync } from "node:zlib";

/**
 * Comprehensive truncation and edge case tests for all compression formats
 * Related to issue #18413 - Testing proper handling of truncated streams,
 * empty streams, and delayed chunks.
 */

// Helper to create a server that sends truncated compressed data
function createTruncatedServer(compression: "gzip" | "br" | "zstd" | "deflate", truncateBytes: number = 1) {
  return serve({
    port: 0,
    async fetch(req) {
      let compressed: Uint8Array;
      const data = Buffer.from("Hello World! This is a test message.");

      switch (compression) {
        case "gzip":
          compressed = Bun.gzipSync(data);
          break;
        case "br":
          compressed = brotliCompressSync(data);
          break;
        case "zstd":
          compressed = Bun.zstdCompressSync(data);
          break;
        case "deflate":
          compressed = Bun.deflateSync(data);
          break;
      }

      // Truncate the compressed data
      const truncated = compressed.slice(0, compressed.length - truncateBytes);

      return new Response(truncated, {
        headers: {
          "Content-Encoding": compression,
          "Content-Type": "text/plain",
          "Content-Length": truncated.length.toString(),
        },
      });
    },
  });
}

// Helper to create a server that sends data in delayed chunks
function createDelayedChunksServer(compression: "gzip" | "br" | "zstd" | "deflate", delayMs: number = 100) {
  return serve({
    port: 0,
    async fetch(req) {
      let compressed: Uint8Array;
      const data = Buffer.from("Hello World! This is a test message.");

      switch (compression) {
        case "gzip":
          compressed = Bun.gzipSync(data);
          break;
        case "br":
          compressed = brotliCompressSync(data);
          break;
        case "zstd":
          compressed = Bun.zstdCompressSync(data);
          break;
        case "deflate":
          compressed = Bun.deflateSync(data);
          break;
      }

      // Split compressed data into chunks
      const mid = Math.floor(compressed.length / 2);
      const chunk1 = compressed.slice(0, mid);
      const chunk2 = compressed.slice(mid);

      return new Response(
        new ReadableStream({
          async start(controller) {
            // Send first chunk
            controller.enqueue(chunk1);
            // Delay before sending second chunk
            await Bun.sleep(delayMs);
            controller.enqueue(chunk2);
            controller.close();
          },
        }),
        {
          headers: {
            "Content-Encoding": compression,
            "Transfer-Encoding": "chunked",
            "Content-Type": "text/plain",
          },
        },
      );
    },
  });
}

// Test truncated gzip stream
test("truncated gzip stream should throw error", async () => {
  using server = createTruncatedServer("gzip", 5);

  try {
    const response = await fetch(`http://localhost:${server.port}`);
    await response.text();
    expect.unreachable("Should have thrown decompression error");
  } catch (err: any) {
    expect(err.code || err.name || err.message).toMatch(/ZlibError|ShortRead/);
  }
});

// Test truncated brotli stream
test("truncated brotli stream should throw error", async () => {
  using server = createTruncatedServer("br", 5);

  try {
    const response = await fetch(`http://localhost:${server.port}`);
    await response.text();
    expect.unreachable("Should have thrown decompression error");
  } catch (err: any) {
    expect(err.code || err.name || err.message).toMatch(/BrotliDecompressionError/);
  }
});

// Test truncated zstd stream
test("truncated zstd stream should throw error", async () => {
  using server = createTruncatedServer("zstd", 5);

  try {
    const response = await fetch(`http://localhost:${server.port}`);
    await response.text();
    expect.unreachable("Should have thrown decompression error");
  } catch (err: any) {
    expect(err.code || err.name || err.message).toMatch(/ZstdDecompressionError/);
  }
});

// Test truncated deflate stream
test("truncated deflate stream should throw error", async () => {
  using server = createTruncatedServer("deflate", 1);

  try {
    const response = await fetch(`http://localhost:${server.port}`);
    await response.text();
    expect.unreachable("Should have thrown decompression error");
  } catch (err: any) {
    expect(err.code || err.name || err.message).toMatch(/ZlibError|ShortRead/);
  }
});

// Test delayed chunks for gzip (should succeed)
test("gzip with delayed chunks should succeed", async () => {
  using server = createDelayedChunksServer("gzip", 50);

  const response = await fetch(`http://localhost:${server.port}`);
  const text = await response.text();
  expect(text).toBe("Hello World! This is a test message.");
});

// Test delayed chunks for brotli (should succeed)
test("brotli with delayed chunks should succeed", async () => {
  using server = createDelayedChunksServer("br", 50);

  const response = await fetch(`http://localhost:${server.port}`);
  const text = await response.text();
  expect(text).toBe("Hello World! This is a test message.");
});

// Test delayed chunks for zstd (should succeed)
test("zstd with delayed chunks should succeed", async () => {
  using server = createDelayedChunksServer("zstd", 50);

  const response = await fetch(`http://localhost:${server.port}`);
  const text = await response.text();
  expect(text).toBe("Hello World! This is a test message.");
});

// Test delayed chunks for deflate (should succeed)
test("deflate with delayed chunks should succeed", async () => {
  using server = createDelayedChunksServer("deflate", 50);

  const response = await fetch(`http://localhost:${server.port}`);
  const text = await response.text();
  expect(text).toBe("Hello World! This is a test message.");
});

// Test mismatched Content-Encoding
test("mismatched Content-Encoding should fail gracefully", async () => {
  using server = serve({
    port: 0,
    async fetch(req) {
      // Send gzip data but claim it's brotli
      const gzipped = Bun.gzipSync(Buffer.from("Hello World"));

      return new Response(gzipped, {
        headers: {
          "Content-Encoding": "br",
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
    expect(err.code || err.name || err.message).toMatch(/BrotliDecompressionError/);
  }
});

// Test sending zero-byte compressed body
test("zero-byte body with gzip Content-Encoding and Content-Length: 0", async () => {
  using server = serve({
    port: 0,
    async fetch(req) {
      return new Response(new Uint8Array(0), {
        headers: {
          "Content-Encoding": "gzip",
          "Content-Type": "text/plain",
          "Content-Length": "0",
        },
      });
    },
  });

  // When Content-Length is 0, the decompressor is not invoked, so this succeeds
  const response = await fetch(`http://localhost:${server.port}`);
  const text = await response.text();
  expect(text).toBe("");
});

// Test sending invalid compressed data
test("invalid gzip data should fail", async () => {
  using server = serve({
    port: 0,
    async fetch(req) {
      // Send random bytes claiming to be gzip
      const invalid = new Uint8Array([0xff, 0xff, 0xff, 0xff, 0xff]);

      return new Response(invalid, {
        headers: {
          "Content-Encoding": "gzip",
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
    expect(err.code || err.name || err.message).toMatch(/ZlibError/);
  }
});

// Test sending first chunk delayed with empty initial chunk
test("empty first chunk followed by valid gzip should succeed", async () => {
  using server = serve({
    port: 0,
    async fetch(req) {
      const gzipped = Bun.gzipSync(Buffer.from("Hello World"));

      return new Response(
        new ReadableStream({
          async start(controller) {
            // Send empty chunk first
            controller.enqueue(new Uint8Array(0));
            await Bun.sleep(50);
            // Then send the actual compressed data
            controller.enqueue(gzipped);
            controller.close();
          },
        }),
        {
          headers: {
            "Content-Encoding": "gzip",
            "Transfer-Encoding": "chunked",
            "Content-Type": "text/plain",
          },
        },
      );
    },
  });

  const response = await fetch(`http://localhost:${server.port}`);
  const text = await response.text();
  expect(text).toBe("Hello World");
});
