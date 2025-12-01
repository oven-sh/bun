import { expect, test } from "bun:test";
import zlib from "node:zlib";

test("should handle large data decompression safely", async () => {
  // Create data that decompresses to > 16MB
  const input = "x".repeat(20 * 1024 * 1024); // 20MB of repeated data

  // Compress with pledgedSrcSize so the frame header includes the size
  const compressed = await new Promise<Buffer>((resolve, reject) => {
    zlib.zstdCompress(input, { pledgedSrcSize: input.length }, (err, result) => {
      if (err) reject(err);
      else resolve(result);
    });
  });

  // This should use streaming decompression because reported size > 16MB
  const decompressed = Bun.zstdDecompressSync(compressed);
  expect(decompressed.length).toBe(input.length);
  expect(decompressed.toString()).toBe(input);
});
