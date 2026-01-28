import { describe, expect, it } from "bun:test";
import zlib from "node:zlib";

describe("zstd compression with larger inputs", () => {
  it("should handle larger strings", async () => {
    const input = "hello world ".repeat(1000);
    const compressed = await new Promise<Buffer>((resolve, reject) => {
      zlib.zstdCompress(input, (err, result) => {
        if (err) reject(err);
        else resolve(result);
      });
    });
    const decompressed = Bun.zstdDecompressSync(compressed);
    expect(decompressed.toString()).toBe(input);
  });

  it("should handle buffers", async () => {
    const input = Buffer.from("test data ".repeat(500));
    const compressed = await new Promise<Buffer>((resolve, reject) => {
      zlib.zstdCompress(input, (err, result) => {
        if (err) reject(err);
        else resolve(result);
      });
    });
    const decompressed = Bun.zstdDecompressSync(compressed);
    expect(decompressed.toString()).toBe(input.toString());
  });

  it("should respect custom pledgedSrcSize if provided", async () => {
    const input = "custom test";
    const compressed = await new Promise<Buffer>((resolve, reject) => {
      zlib.zstdCompress(input, { pledgedSrcSize: input.length }, (err, result) => {
        if (err) reject(err);
        else resolve(result);
      });
    });
    const decompressed = Bun.zstdDecompressSync(compressed);
    expect(decompressed.toString()).toBe(input);
  });
});
