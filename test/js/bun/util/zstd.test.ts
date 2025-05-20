import { describe, expect, it } from "bun:test";
import { randomBytes } from "crypto";
import { zstdCompressSync, zstdDecompressSync, zstdCompress, zstdDecompress } from "bun";
import path from "path";

describe("Zstandard compression", async () => {
  // Test data of various sizes
  const testCases = [
    // { name: "empty", data: new Uint8Array(0) },
    { name: "small", data: new TextEncoder().encode("Hello, World!") },
    { name: "medium", data: await Bun.file(path.join(__dirname, "..", "..", "..", "bun.lock")).bytes() },
    {
      name: "large",
      data: Buffer.from(
        (await Bun.file(path.join(__dirname, "..", "..", "..", "..", "src", "js_parser.zig")).text()).repeat(5),
      ),
    },
  ] as const;

  for (const { data: input, name } of testCases) {
    describe(name + " (" + input.length + " bytes)", () => {
      for (let level = 1; level <= 22; level++) {
        it("level " + level, async () => {
          // Sync compression
          const syncCompressed = zstdCompressSync(input, { level });

          // Async compression
          const asyncCompressed = await zstdCompress(input, { level });

          // Compare compressed results (they should be identical with same level)
          expect(syncCompressed).toStrictEqual(asyncCompressed);

          // Sync decompression of async compressed data
          const syncDecompressed = zstdDecompressSync(asyncCompressed);

          // Async decompression of sync compressed data
          const asyncDecompressed = await zstdDecompress(syncCompressed);

          // Compare decompressed results
          expect(syncDecompressed).toStrictEqual(asyncDecompressed);

          // Verify both match original
          expect(syncDecompressed).toStrictEqual(input);
          expect(asyncDecompressed).toStrictEqual(input);
        });
      }
    });
  }
});
