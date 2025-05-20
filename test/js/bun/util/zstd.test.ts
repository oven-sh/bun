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
        (await Bun.file(path.join(__dirname, "..", "..", "..", "..", "src", "js_parser.zig")).text()).repeat(50),
      ),
    },
  ];

  // Test various input types
  const inputTypes = [
    {
      name: "Uint8Array",
      convert: (data: Uint8Array) => data,
      extract: (data: Uint8Array) => data,
    },
    {
      name: "Buffer",
      convert: (data: Uint8Array) => Buffer.from(data),
      extract: (data: Buffer) => new Uint8Array(data),
    },
    {
      name: "string",
      convert: (data: Uint8Array) => new TextDecoder().decode(data),
      extract: (data: string) => new TextEncoder().encode(data),
      skip: (testCase: (typeof testCases)[number]) =>
        // Skip random bytes for strings as they may contain invalid UTF-8
        testCase.name === "medium" || testCase.name === "large",
    },
  ];

  // Test compression levels
  const compressionLevels = [1, 3, 9, 22]; // Min, default, higher, max

  describe("zstdCompressSync", () => {
    for (const testCase of testCases) {
      for (const inputType of inputTypes) {
        if (inputType.skip?.(testCase)) continue;

        describe(`with ${testCase.name} ${inputType.name}`, () => {
          for (const level of compressionLevels) {
            it(`compresses at level ${level}`, () => {
              const input = inputType.convert(testCase.data);
              const compressed = zstdCompressSync(input, { level });

              expect(compressed).toBeInstanceOf(Uint8Array);

              // Empty data should compress to very small size
              if (testCase.name === "empty") {
                expect(compressed.byteLength).toBeLessThan(20);
              }
              // Non-empty data should compress to smaller size (unless very small)
              else if (testCase.name !== "small") {
                expect(compressed.byteLength).toBeLessThan(testCase.data.byteLength);
              }

              // Verify compressed format header
              if (compressed.byteLength > 4) {
                // Check for Zstandard frame magic number (0xFD2FB528)
                expect(compressed[0]).toBe(0xfd);
                expect(compressed[1]).toBe(0x2f);
                expect(compressed[2]).toBe(0xb5);
                // We don't check the last byte as version might change
              }
            });
          }
        });
      }
    }

    it("throws on invalid compression level", () => {
      expect(() => zstdCompressSync("test", { level: 0 })).toThrow();
      expect(() => zstdCompressSync("test", { level: 23 })).toThrow();
      expect(() => zstdCompressSync("test", { level: -1 })).toThrow();
    });
  });

  describe("zstdDecompressSync", () => {
    for (const testCase of testCases) {
      for (const inputType of inputTypes) {
        if (inputType.skip?.(testCase)) continue;

        it(`decompresses ${testCase.name} ${inputType.name}`, () => {
          const input = inputType.convert(testCase.data);
          const compressed = zstdCompressSync(input);
          const decompressed = zstdDecompressSync(compressed);

          expect(decompressed).toBeInstanceOf(Uint8Array);

          // Compare with original data
          expect(new Uint8Array(decompressed)).toEqual(inputType.extract(input));
        });
      }
    }

    it("throws on invalid compressed data", () => {
      expect(() => zstdDecompressSync(new Uint8Array([1, 2, 3, 4]))).toThrow();
      expect(() => zstdDecompressSync("not compressed")).toThrow();
    });
  });

  describe("zstdCompress/zstdDecompress", () => {
    for (const testCase of testCases) {
      if (testCase.name === "large") continue; // Skip large for faster async tests

      for (const inputType of inputTypes) {
        if (inputType.skip?.(testCase)) continue;

        for (const level of [1, 22]) {
          // Test min and max levels
          it(`async compresses and decompresses ${testCase.name} ${inputType.name} at level ${level}`, async () => {
            const input = inputType.convert(testCase.data);

            // Test async compression
            const compressed = await zstdCompress(input, { level });
            expect(compressed).toBeInstanceOf(Uint8Array);

            // Test async decompression
            const decompressed = await zstdDecompress(compressed);
            expect(decompressed).toBeInstanceOf(Uint8Array);

            // Compare with original data
            expect(new Uint8Array(decompressed)).toEqual(inputType.extract(input));
          });
        }
      }
    }

    it("rejects on invalid compression level", async () => {
      await expect(zstdCompress("test", { level: 0 })).rejects.toThrow();
      await expect(zstdCompress("test", { level: 23 })).rejects.toThrow();
    });

    it("rejects on invalid compressed data", async () => {
      await expect(zstdDecompress(new Uint8Array([1, 2, 3, 4]))).rejects.toThrow();
      await expect(zstdDecompress("not compressed")).rejects.toThrow();
    });
  });

  describe("roundtrip consistency", () => {
    it("gives identical results between sync and async methods", async () => {
      const input = "Test data for consistency check";

      // Sync compression
      const syncCompressed = zstdCompressSync(input, { level: 5 });

      // Async compression
      const asyncCompressed = await zstdCompress(input, { level: 5 });

      // Compare compressed results (they should be identical with same level)
      expect(new Uint8Array(syncCompressed)).toEqual(new Uint8Array(asyncCompressed));

      // Sync decompression of async compressed data
      const syncDecompressed = zstdDecompressSync(asyncCompressed);

      // Async decompression of sync compressed data
      const asyncDecompressed = await zstdDecompress(syncCompressed);

      // Compare decompressed results
      expect(new Uint8Array(syncDecompressed)).toEqual(new Uint8Array(asyncDecompressed));

      // Verify both match original
      const original = new TextEncoder().encode(input);
      expect(new Uint8Array(syncDecompressed)).toEqual(original);
      expect(new Uint8Array(asyncDecompressed)).toEqual(original);
    });
  });

  describe("performance tests", () => {
    // Performance checks are not assertions but provide useful information
    it("measures compression/decompression performance", () => {
      const SIZE = 1_000_000; // 1MB
      const testData = randomBytes(SIZE);

      // Test sync compression performance
      console.log("\nCompression performance:");
      for (const level of [1, 3, 9, 22]) {
        const start = performance.now();
        const compressed = zstdCompressSync(testData, { level });
        const duration = performance.now() - start;
        const ratio = compressed.byteLength / SIZE;
        console.log(`  Level ${level}: ${(SIZE / duration / 1000).toFixed(2)} MB/s, ratio: ${ratio.toFixed(3)}`);
      }

      // Test sync decompression performance
      console.log("\nDecompression performance:");
      const compressed = zstdCompressSync(testData, { level: 3 });
      const start = performance.now();
      zstdDecompressSync(compressed);
      const duration = performance.now() - start;
      console.log(`  Speed: ${(SIZE / duration / 1000).toFixed(2)} MB/s`);
    });
  });
});
