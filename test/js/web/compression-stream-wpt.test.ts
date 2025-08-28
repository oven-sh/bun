/**
 * CompressionStream and DecompressionStream Web Platform Tests
 * Based on WebKit's WPT tests from LayoutTests/imported/w3c/web-platform-tests/compression/
 */

import { describe, expect, test } from "bun:test";

// Helper functions
function stringToBytes(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}

function bytesToString(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

async function readableStreamToArray(readable: ReadableStream): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  const reader = readable.getReader();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }

  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }

  return result;
}

async function compressData(data: Uint8Array, format: CompressionFormat): Promise<Uint8Array> {
  const cs = new CompressionStream(format);
  const writer = cs.writable.getWriter();
  writer.write(data);
  writer.close();
  return readableStreamToArray(cs.readable);
}

async function decompressData(data: Uint8Array, format: CompressionFormat): Promise<Uint8Array> {
  const ds = new DecompressionStream(format);
  const writer = ds.writable.getWriter();
  writer.write(data);
  writer.close();
  return readableStreamToArray(ds.readable);
}

async function compressAndDecompress(input: Uint8Array, format: CompressionFormat): Promise<Uint8Array> {
  const compressed = await compressData(input, format);
  return decompressData(compressed, format);
}

// Test data
const TINY_DATA = stringToBytes("x");
const SMALL_DATA = stringToBytes("Hello, World!");
const LARGE_DATA = new Uint8Array(65536).fill(65); // 64KB of 'A's
const EMPTY_DATA = new Uint8Array(0);
const LOREM =
  "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.";
const REPETITIVE_DATA = stringToBytes(LOREM.repeat(100));

// All supported formats
const FORMATS: CompressionFormat[] = ["deflate", "deflate-raw", "gzip", "brotli"];

describe("CompressionStream - Constructor", () => {
  test("constructor with valid formats", () => {
    for (const format of FORMATS) {
      expect(() => new CompressionStream(format)).not.toThrow();
    }
  });

  test("constructor with invalid format throws TypeError", () => {
    expect(() => new CompressionStream("invalid" as any)).toThrow(TypeError);
    expect(() => new CompressionStream("" as any)).toThrow(TypeError);
    expect(() => new CompressionStream(7 as any)).toThrow(TypeError);
    expect(() => new CompressionStream({} as any)).toThrow(TypeError);
  });

  test("constructor with no arguments throws TypeError", () => {
    expect(() => new (CompressionStream as any)()).toThrow(TypeError);
  });

  test("case-insensitive format parameter", () => {
    expect(() => new CompressionStream("GZIP" as any)).not.toThrow();
    expect(() => new CompressionStream("Deflate" as any)).not.toThrow();
    expect(() => new CompressionStream("DEFLATE-raw" as any)).not.toThrow();
    expect(() => new CompressionStream("BrOtLi" as any)).not.toThrow();
  });
});

describe("DecompressionStream - Constructor", () => {
  test("constructor with valid formats", () => {
    for (const format of FORMATS) {
      expect(() => new DecompressionStream(format)).not.toThrow();
    }
  });

  test("constructor with invalid format throws TypeError", () => {
    expect(() => new DecompressionStream("invalid" as any)).toThrow(TypeError);
    expect(() => new DecompressionStream("" as any)).toThrow(TypeError);
    expect(() => new DecompressionStream(7 as any)).toThrow(TypeError);
    expect(() => new DecompressionStream({} as any)).toThrow(TypeError);
  });

  test("constructor with no arguments throws TypeError", () => {
    expect(() => new (DecompressionStream as any)()).toThrow(TypeError);
  });
});

describe("CompressionStream - Properties", () => {
  test("has readable and writable properties", () => {
    const cs = new CompressionStream("gzip");
    expect(cs.readable).toBeInstanceOf(ReadableStream);
    expect(cs.writable).toBeInstanceOf(WritableStream);
  });

  test("properties are read-only", () => {
    const cs = new CompressionStream("gzip");
    const origReadable = cs.readable;
    const origWritable = cs.writable;

    // Properties should be read-only
    // In strict mode this would throw, but getters are inherently read-only
    try {
      (cs as any).readable = "test";
      (cs as any).writable = "test";
    } catch {
      // Expected in strict mode environments
    }

    expect(cs.readable).toBe(origReadable);
    expect(cs.writable).toBe(origWritable);
  });
});

describe("DecompressionStream - Properties", () => {
  test("has readable and writable properties", () => {
    const ds = new DecompressionStream("gzip");
    expect(ds.readable).toBeInstanceOf(ReadableStream);
    expect(ds.writable).toBeInstanceOf(WritableStream);
  });
});

describe("Compression - Basic functionality", () => {
  for (const format of FORMATS) {
    test(`${format}: compress and decompress tiny data`, async () => {
      const result = await compressAndDecompress(TINY_DATA, format);
      expect(result).toEqual(TINY_DATA);
    });

    test(`${format}: compress and decompress small data`, async () => {
      const result = await compressAndDecompress(SMALL_DATA, format);
      expect(result).toEqual(SMALL_DATA);
    });

    test(`${format}: compress and decompress large data`, async () => {
      const result = await compressAndDecompress(LARGE_DATA, format);
      expect(result).toEqual(LARGE_DATA);
    });

    test(`${format}: compress and decompress empty data`, async () => {
      const result = await compressAndDecompress(EMPTY_DATA, format);
      expect(result).toEqual(EMPTY_DATA);
    });

    test(`${format}: compress and decompress repetitive data`, async () => {
      const result = await compressAndDecompress(REPETITIVE_DATA, format);
      expect(result).toEqual(REPETITIVE_DATA);
    });
  }
});

describe("Compression - Multiple chunks", () => {
  test("compress data written in multiple chunks", async () => {
    const cs = new CompressionStream("gzip");
    const writer = cs.writable.getWriter();

    // Write in 3 chunks
    await writer.write(stringToBytes("Hello"));
    await writer.write(stringToBytes(", "));
    await writer.write(stringToBytes("World!"));
    await writer.close();

    const compressed = await readableStreamToArray(cs.readable);

    // Decompress to verify
    const decompressed = await decompressData(compressed, "gzip");
    expect(bytesToString(decompressed)).toBe("Hello, World!");
  });

  test("decompress data fed in multiple chunks", async () => {
    // First compress the data
    const compressed = await compressData(SMALL_DATA, "gzip");

    // Split compressed data into chunks
    const mid = Math.floor(compressed.length / 2);
    const chunk1 = compressed.slice(0, mid);
    const chunk2 = compressed.slice(mid);

    // Decompress in chunks
    const ds = new DecompressionStream("gzip");
    const writer = ds.writable.getWriter();
    await writer.write(chunk1);
    await writer.write(chunk2);
    await writer.close();

    const decompressed = await readableStreamToArray(ds.readable);
    expect(decompressed).toEqual(SMALL_DATA);
  });
});

describe("Compression - Including empty chunks", () => {
  test("compress with empty chunks interspersed", async () => {
    const cs = new CompressionStream("gzip");
    const writer = cs.writable.getWriter();

    await writer.write(stringToBytes("Hello"));
    await writer.write(new Uint8Array(0)); // Empty chunk
    await writer.write(stringToBytes(", "));
    await writer.write(new Uint8Array(0)); // Empty chunk
    await writer.write(stringToBytes("World!"));
    await writer.close();

    const compressed = await readableStreamToArray(cs.readable);
    const decompressed = await decompressData(compressed, "gzip");
    expect(bytesToString(decompressed)).toBe("Hello, World!");
  });
});

describe("Compression - Bad chunks", () => {
  test("CompressionStream rejects non-BufferSource chunks", async () => {
    const cs = new CompressionStream("gzip");
    const writer = cs.writable.getWriter();

    await expect(writer.write("string" as any)).rejects.toThrow(TypeError);
    await expect(writer.write(42 as any)).rejects.toThrow(TypeError);
    await expect(writer.write(true as any)).rejects.toThrow(TypeError);
    await expect(writer.write({} as any)).rejects.toThrow(TypeError);
    await expect(writer.write([] as any)).rejects.toThrow(TypeError);
    await expect(writer.write(null as any)).rejects.toThrow(TypeError);
    await expect(writer.write(undefined as any)).rejects.toThrow(TypeError);
  });

  test("DecompressionStream rejects non-BufferSource chunks", async () => {
    const ds = new DecompressionStream("gzip");
    const writer = ds.writable.getWriter();

    await expect(writer.write("string" as any)).rejects.toThrow(TypeError);
    await expect(writer.write(42 as any)).rejects.toThrow(TypeError);
    await expect(writer.write(true as any)).rejects.toThrow(TypeError);
    await expect(writer.write({} as any)).rejects.toThrow(TypeError);
  });
});

describe("Compression - BufferSource types", () => {
  const testData = new Uint8Array([72, 101, 108, 108, 111]); // "Hello"

  test("accepts Uint8Array", async () => {
    const result = await compressAndDecompress(testData, "gzip");
    expect(result).toEqual(testData);
  });

  test("accepts ArrayBuffer", async () => {
    const buffer = testData.buffer;
    const cs = new CompressionStream("gzip");
    const writer = cs.writable.getWriter();
    await writer.write(buffer);
    await writer.close();

    const compressed = await readableStreamToArray(cs.readable);
    const decompressed = await decompressData(compressed, "gzip");
    expect(decompressed).toEqual(testData);
  });

  test("accepts DataView", async () => {
    const view = new DataView(testData.buffer);
    const cs = new CompressionStream("gzip");
    const writer = cs.writable.getWriter();
    await writer.write(view);
    await writer.close();

    const compressed = await readableStreamToArray(cs.readable);
    const decompressed = await decompressData(compressed, "gzip");
    expect(decompressed).toEqual(testData);
  });

  test("accepts Int8Array", async () => {
    const int8 = new Int8Array(testData.buffer);
    const cs = new CompressionStream("gzip");
    const writer = cs.writable.getWriter();
    await writer.write(int8);
    await writer.close();

    const compressed = await readableStreamToArray(cs.readable);
    const decompressed = await decompressData(compressed, "gzip");
    expect(decompressed).toEqual(testData);
  });

  test("accepts Uint16Array", async () => {
    const data = new Uint16Array([0x4865, 0x6c6c, 0x6f00]); // "Hello" in 16-bit
    const cs = new CompressionStream("gzip");
    const writer = cs.writable.getWriter();
    await writer.write(data);
    await writer.close();

    const compressed = await readableStreamToArray(cs.readable);
    expect(compressed.length).toBeGreaterThan(0);
  });
});

describe("Decompression - Corrupt input", () => {
  test("DecompressionStream handles corrupt gzip data", async () => {
    const ds = new DecompressionStream("gzip");
    const writer = ds.writable.getWriter();
    const reader = ds.readable.getReader();

    // Write invalid gzip data
    const corruptData = new Uint8Array([0x1f, 0x8b, 0xff, 0xff, 0xff, 0xff]);

    try {
      await writer.write(corruptData);
      await writer.close();
      await reader.read();
      // Should not succeed with corrupt data
      throw new Error("Should have thrown on corrupt data");
    } catch (e: any) {
      // Expected - should throw on corrupt data
      expect(e.message).not.toBe("Should have thrown on corrupt data");
    }
  });

  test("DecompressionStream handles truncated data", async () => {
    // Get valid compressed data
    const compressed = await compressData(SMALL_DATA, "gzip");

    // Truncate it
    const truncated = compressed.slice(0, Math.floor(compressed.length / 2));

    const ds = new DecompressionStream("gzip");
    const writer = ds.writable.getWriter();

    try {
      await writer.write(truncated);
      await writer.close();

      // Try to read the data
      const result = await readableStreamToArray(ds.readable);
      // If it doesn't throw, the result should be incomplete
      expect(result.length).toBeLessThan(SMALL_DATA.length);
    } catch (e) {
      // Expected to throw - truncated data should be detected
      expect(e).toBeDefined();
    }
  });
});

describe("Compression - Output characteristics", () => {
  test("compression reduces size for repetitive data", async () => {
    const repetitive = new Uint8Array(10000).fill(97); // 10KB of 'a'
    const compressed = await compressData(repetitive, "gzip");

    // Should compress very well
    expect(compressed.length).toBeLessThan(repetitive.length / 10);
  });

  test("compression may increase size for random data", async () => {
    // Generate random data
    const random = new Uint8Array(100);
    for (let i = 0; i < random.length; i++) {
      random[i] = Math.floor(Math.random() * 256);
    }

    const compressed = await compressData(random, "gzip");

    // Random data doesn't compress well, might even be larger
    expect(compressed.length).toBeGreaterThanOrEqual(random.length * 0.9);
  });
});

describe("Compression - Streaming behavior", () => {
  test("can pipe through CompressionStream", async () => {
    const input = new ReadableStream({
      start(controller) {
        controller.enqueue(SMALL_DATA);
        controller.close();
      },
    });

    const compressed = input.pipeThrough(new CompressionStream("gzip"));
    const result = await readableStreamToArray(compressed);

    expect(result.length).toBeGreaterThan(0);
  });

  test("can pipe through both CompressionStream and DecompressionStream", async () => {
    const input = new ReadableStream({
      start(controller) {
        controller.enqueue(SMALL_DATA);
        controller.close();
      },
    });

    const processed = input.pipeThrough(new CompressionStream("gzip")).pipeThrough(new DecompressionStream("gzip"));

    const result = await readableStreamToArray(processed);
    expect(result).toEqual(SMALL_DATA);
  });
});

describe("Compression - Large data handling", () => {
  test("compress very large data (1MB)", async () => {
    const largeData = new Uint8Array(1024 * 1024).fill(65); // 1MB of 'A's
    const compressed = await compressData(largeData, "gzip");

    // Should compress extremely well
    expect(compressed.length).toBeLessThan(largeData.length / 100);

    // Verify decompression
    const decompressed = await decompressData(compressed, "gzip");
    expect(decompressed).toEqual(largeData);
  }, 10000); // Increase timeout for large data
});

describe("Compression - Format-specific tests", () => {
  test("deflate-raw produces different output than deflate", async () => {
    const deflateCompressed = await compressData(SMALL_DATA, "deflate");
    const deflateRawCompressed = await compressData(SMALL_DATA, "deflate-raw");

    // deflate-raw should be slightly smaller (no header/trailer)
    expect(deflateRawCompressed.length).toBeLessThan(deflateCompressed.length);
  });

  test("gzip includes header with magic number", async () => {
    const compressed = await compressData(SMALL_DATA, "gzip");

    // gzip magic number: 0x1f 0x8b
    expect(compressed[0]).toBe(0x1f);
    expect(compressed[1]).toBe(0x8b);
  });

  test("brotli compression works", async () => {
    const compressed = await compressData(REPETITIVE_DATA, "brotli");
    const decompressed = await decompressData(compressed, "brotli");

    expect(decompressed).toEqual(REPETITIVE_DATA);

    // Brotli should compress repetitive data very well
    expect(compressed.length).toBeLessThan(REPETITIVE_DATA.length / 10);
  });
});

describe("Compression - Error recovery", () => {
  test("new CompressionStream after error", async () => {
    // Cause an error
    const cs1 = new CompressionStream("gzip");
    const writer1 = cs1.writable.getWriter();
    await expect(writer1.write("invalid" as any)).rejects.toThrow();

    // Should be able to create a new one
    const cs2 = new CompressionStream("gzip");
    const writer2 = cs2.writable.getWriter();
    await writer2.write(SMALL_DATA);
    await writer2.close();

    const compressed = await readableStreamToArray(cs2.readable);
    expect(compressed.length).toBeGreaterThan(0);
  });
});

// Test for output being Uint8Array (per spec)
describe("Output type verification", () => {
  test("CompressionStream outputs Uint8Array chunks", async () => {
    const cs = new CompressionStream("gzip");
    const writer = cs.writable.getWriter();
    const reader = cs.readable.getReader();

    writer.write(SMALL_DATA);
    writer.close();

    const { value } = await reader.read();
    expect(value).toBeInstanceOf(Uint8Array);
  });

  test("DecompressionStream outputs Uint8Array chunks", async () => {
    const compressed = await compressData(SMALL_DATA, "gzip");

    const ds = new DecompressionStream("gzip");
    const writer = ds.writable.getWriter();
    const reader = ds.readable.getReader();

    writer.write(compressed);
    writer.close();

    const { value } = await reader.read();
    expect(value).toBeInstanceOf(Uint8Array);
  });
});
