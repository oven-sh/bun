import { serve } from "bun";
import { describe, expect, test } from "bun:test";
import { brotliCompressSync } from "node:zlib";

/**
 * Tests that HTTP response decompression enforces output size limits.
 * This hardens the decompression path against responses with
 * disproportionate compression ratios that would otherwise cause
 * unbounded memory growth.
 *
 * The limit is 128 MB, matching the WebSocket decompression limit.
 */

// 128 MB + 1 byte, just over the limit.
// All zeros compresses extremely well - a few hundred bytes compressed for 128MB+ decompressed.
const OVER_LIMIT_SIZE = 128 * 1024 * 1024 + 1;
const overLimitData = Buffer.alloc(OVER_LIMIT_SIZE, 0);

// Pre-compute compressed payloads at module scope to avoid test timeouts.
// gzip/deflate/zstd are fast; brotli is slower but still manageable at module level.
const compressedPayloads = {
  gzip: Bun.gzipSync(overLimitData),
  deflate: Bun.deflateSync(overLimitData),
  zstd: Bun.zstdCompressSync(overLimitData),
  br: brotliCompressSync(overLimitData),
};

// Free the large source buffer now that compression is done
overLimitData.fill(0); // hint to GC

describe("fetch decompression output limits", () => {
  for (const encoding of ["gzip", "br", "zstd", "deflate"] as const) {
    test(`rejects ${encoding} response exceeding decompression limit`, async () => {
      const compressed = compressedPayloads[encoding];
      // Verify the compressed payload is much smaller than the decompressed output
      expect(compressed.length).toBeLessThan(1024 * 1024);

      using server = serve({
        port: 0,
        fetch() {
          return new Response(compressed, {
            headers: {
              "Content-Encoding": encoding,
              "Content-Type": "application/octet-stream",
              "Content-Length": compressed.length.toString(),
            },
          });
        },
      });

      try {
        const resp = await fetch(server.url);
        await resp.arrayBuffer();
        expect.unreachable();
      } catch (e: any) {
        expect(e).toBeDefined();
      }
    }, 30_000);

    test(`allows ${encoding} response within decompression limit`, async () => {
      // 1 MB of data - well within the 128 MB limit
      const originalData = Buffer.alloc(1024 * 1024, 0x41);
      let compressed: Uint8Array;
      switch (encoding) {
        case "gzip":
          compressed = Bun.gzipSync(originalData);
          break;
        case "br":
          compressed = brotliCompressSync(originalData);
          break;
        case "zstd":
          compressed = Bun.zstdCompressSync(originalData);
          break;
        case "deflate":
          compressed = Bun.deflateSync(originalData);
          break;
      }

      using server = serve({
        port: 0,
        fetch() {
          return new Response(compressed, {
            headers: {
              "Content-Encoding": encoding,
              "Content-Type": "application/octet-stream",
              "Content-Length": compressed.length.toString(),
            },
          });
        },
      });

      const resp = await fetch(server.url);
      const body = await resp.arrayBuffer();
      expect(body.byteLength).toBe(originalData.length);
    });
  }

  test("allows gzip response exactly at the limit", async () => {
    // 128 MB exactly should be allowed
    const exactLimitSize = 128 * 1024 * 1024;
    const data = Buffer.alloc(exactLimitSize, 0);
    const compressed = Bun.gzipSync(data);

    using server = serve({
      port: 0,
      fetch() {
        return new Response(compressed, {
          headers: {
            "Content-Encoding": "gzip",
            "Content-Type": "application/octet-stream",
            "Content-Length": compressed.length.toString(),
          },
        });
      },
    });

    const resp = await fetch(server.url);
    const body = await resp.arrayBuffer();
    expect(body.byteLength).toBe(exactLimitSize);
  }, 30_000);

  test("decompress: false bypasses the limit", async () => {
    // When decompress is false, there should be no limit enforced
    // (the compressed data is returned as-is)
    const compressed = compressedPayloads.gzip;

    using server = serve({
      port: 0,
      fetch() {
        return new Response(compressed, {
          headers: {
            "Content-Encoding": "gzip",
            "Content-Type": "application/octet-stream",
            "Content-Length": compressed.length.toString(),
          },
        });
      },
    });

    const resp = await fetch(server.url, { decompress: false });
    const body = await resp.arrayBuffer();
    // Should get the raw compressed bytes back
    expect(body.byteLength).toBe(compressed.length);
  }, 30_000);
});
