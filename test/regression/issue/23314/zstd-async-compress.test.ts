import { describe, expect, it } from "bun:test";
import zlib from "node:zlib";

// The zlib sync and async implementations create different outputs
// This may not be a bug in itself, but the async version creates data that causes an out of memory error when decompressed with Bun.zstdDecompressSync
describe("zstd compression compatibility", () => {
  it("should decompress data compressed with zlib.zstdCompressSync", () => {
    const input = "hello world";
    const compressed = zlib.zstdCompressSync(input);
    const decompressed = Bun.zstdDecompressSync(compressed);
    expect(decompressed.toString()).toBe(input);
  });

  it("should decompress data compressed with zlib.zstdCompress (async)", async () => {
    const input = "hello world";
    const compressed = await new Promise<Buffer>((resolve, reject) => {
      zlib.zstdCompress(input, (err, result) => {
        if (err) reject(err);
        else resolve(result);
      });
    });
    const decompressed = Bun.zstdDecompressSync(compressed);
    expect(decompressed.toString()).toBe(input);
  });

  it("should decompress data compressed with zlib.zstdCompress using Bun.zstdDecompress", async () => {
    const input = "hello world";
    const compressed = await new Promise<Buffer>((resolve, reject) => {
      zlib.zstdCompress(input, (err, result) => {
        if (err) reject(err);
        else resolve(result);
      });
    });
    const decompressed = await Bun.zstdDecompress(compressed);
    expect(decompressed.toString()).toBe(input);
  });
});
