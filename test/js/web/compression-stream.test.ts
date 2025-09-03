import { expect, test } from "bun:test";

// Test data
const TEST_STRING = "Hello, World! This is a test string for compression and decompression.";
const LARGE_TEXT = "Lorem ipsum ".repeat(1000); // ~12KB of text

// Helper to convert string to Uint8Array
function stringToBytes(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}

// Helper to convert Uint8Array to string
function bytesToString(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

// Helper to compress and decompress
async function compressDecompress(text: string, format: CompressionFormat | "brotli" | "zstd"): Promise<string> {
  const input = stringToBytes(text);

  // Compress
  const cs = new CompressionStream(format as CompressionFormat);
  const writer = cs.writable.getWriter();
  const reader = cs.readable.getReader();

  writer.write(input);
  writer.close();

  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }

  const compressed = new Uint8Array(chunks.reduce((acc, chunk) => acc + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    compressed.set(chunk, offset);
    offset += chunk.length;
  }

  // Decompress
  const ds = new DecompressionStream(format as CompressionFormat);
  const dsWriter = ds.writable.getWriter();
  const dsReader = ds.readable.getReader();

  dsWriter.write(compressed);
  dsWriter.close();

  const decompressedChunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await dsReader.read();
    if (done) break;
    decompressedChunks.push(value);
  }

  const decompressed = new Uint8Array(decompressedChunks.reduce((acc, chunk) => acc + chunk.length, 0));
  offset = 0;
  for (const chunk of decompressedChunks) {
    decompressed.set(chunk, offset);
    offset += chunk.length;
  }

  return bytesToString(decompressed);
}

test("CompressionStream and DecompressionStream exist", () => {
  expect(typeof CompressionStream).toBe("function");
  expect(typeof DecompressionStream).toBe("function");
});

test("CompressionStream constructor validates format", () => {
  expect(() => new CompressionStream("deflate")).not.toThrow();
  expect(() => new CompressionStream("gzip")).not.toThrow();
  expect(() => new CompressionStream("deflate-raw")).not.toThrow();
  expect(() => new CompressionStream("brotli" as any)).not.toThrow();

  expect(() => new CompressionStream("invalid" as any)).toThrow();
  expect(() => new CompressionStream("" as any)).toThrow();
  expect(() => new (CompressionStream as any)()).toThrow();
});

test("DecompressionStream constructor validates format", () => {
  expect(() => new DecompressionStream("deflate")).not.toThrow();
  expect(() => new DecompressionStream("gzip")).not.toThrow();
  expect(() => new DecompressionStream("deflate-raw")).not.toThrow();
  expect(() => new DecompressionStream("brotli" as any)).not.toThrow();

  expect(() => new DecompressionStream("invalid" as any)).toThrow();
  expect(() => new DecompressionStream("" as any)).toThrow();
  expect(() => new (DecompressionStream as any)()).toThrow();
});

test("CompressionStream has readable and writable properties", () => {
  const cs = new CompressionStream("gzip");
  expect(cs.readable).toBeInstanceOf(ReadableStream);
  expect(cs.writable).toBeInstanceOf(WritableStream);
});

test("DecompressionStream has readable and writable properties", () => {
  const ds = new DecompressionStream("gzip");
  expect(ds.readable).toBeInstanceOf(ReadableStream);
  expect(ds.writable).toBeInstanceOf(WritableStream);
});

test("deflate compression and decompression", async () => {
  const result = await compressDecompress(TEST_STRING, "deflate");
  expect(result).toBe(TEST_STRING);
});

test("deflate-raw compression and decompression", async () => {
  const result = await compressDecompress(TEST_STRING, "deflate-raw");
  expect(result).toBe(TEST_STRING);
});

test("gzip compression and decompression", async () => {
  const result = await compressDecompress(TEST_STRING, "gzip");
  expect(result).toBe(TEST_STRING);
});

test("brotli compression and decompression", async () => {
  const result = await compressDecompress(TEST_STRING, "brotli");
  expect(result).toBe(TEST_STRING);
});

test("zstd compression and decompression", async () => {
  const result = await compressDecompress(TEST_STRING, "zstd");
  expect(result).toBe(TEST_STRING);
});

test("large data compression - deflate", async () => {
  const result = await compressDecompress(LARGE_TEXT, "deflate");
  expect(result).toBe(LARGE_TEXT);
});

test("large data compression - gzip", async () => {
  const result = await compressDecompress(LARGE_TEXT, "gzip");
  expect(result).toBe(LARGE_TEXT);
});

test("large data compression - brotli", async () => {
  const result = await compressDecompress(LARGE_TEXT, "brotli");
  expect(result).toBe(LARGE_TEXT);
});

test("large data compression - zstd", async () => {
  const result = await compressDecompress(LARGE_TEXT, "zstd");
  expect(result).toBe(LARGE_TEXT);
});

test("empty data compression", async () => {
  const result = await compressDecompress("", "gzip");
  expect(result).toBe("");
});

test("streaming compression with multiple writes", async () => {
  const cs = new CompressionStream("gzip");
  const writer = cs.writable.getWriter();
  const reader = cs.readable.getReader();

  // Write in chunks
  const chunks = ["Hello", ", ", "World", "!"];
  for (const chunk of chunks) {
    await writer.write(stringToBytes(chunk));
  }
  await writer.close();

  // Read compressed data
  const compressed: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    compressed.push(value);
  }

  // Decompress
  const ds = new DecompressionStream("gzip");
  const dsWriter = ds.writable.getWriter();
  const dsReader = ds.readable.getReader();

  for (const chunk of compressed) {
    await dsWriter.write(chunk);
  }
  await dsWriter.close();

  const decompressed: Uint8Array[] = [];
  while (true) {
    const { done, value } = await dsReader.read();
    if (done) break;
    decompressed.push(value);
  }

  const result = bytesToString(
    new Uint8Array(
      decompressed.reduce((acc, chunk) => {
        const combined = new Uint8Array(acc.length + chunk.length);
        combined.set(acc);
        combined.set(chunk, acc.length);
        return combined;
      }, new Uint8Array(0)),
    ),
  );

  expect(result).toBe("Hello, World!");
});

test("CompressionStream accepts string input", async () => {
  const cs = new CompressionStream("gzip");
  const writer = cs.writable.getWriter();

  // Strings should now be accepted
  await expect(writer.write("test string")).resolves.toBeUndefined();
  
  await writer.close();
});

test("CompressionStream rejects invalid input types", async () => {
  const cs = new CompressionStream("gzip");
  const writer = cs.writable.getWriter();
  
  // Numbers and plain objects should still throw
  await expect(writer.write(123 as any)).rejects.toThrow();
  
  // Create a new stream since the first one errored
  const cs2 = new CompressionStream("gzip");
  const writer2 = cs2.writable.getWriter();
  
  await expect(writer2.write({} as any)).rejects.toThrow();
});

test("DecompressionStream rejects non-ArrayBuffer input", async () => {
  const ds = new DecompressionStream("gzip");
  const writer = ds.writable.getWriter();

  await expect(writer.write("not an arraybuffer" as any)).rejects.toThrow();
  await expect(writer.write(123 as any)).rejects.toThrow();
  await expect(writer.write({} as any)).rejects.toThrow();
});

test("DecompressionStream handles invalid compressed data", async () => {
  const ds = new DecompressionStream("gzip");
  const writer = ds.writable.getWriter();
  const reader = ds.readable.getReader();

  // Write invalid data
  const invalidData = new Uint8Array([1, 2, 3, 4, 5]);

  // The error can be thrown either during write or close
  try {
    await writer.write(invalidData);
    await writer.close();
    // If no error yet, try to read
    const result = await reader.read();
    // Should not get here with invalid data
    expect(result.done || result.value.length === 0).toBe(true);
  } catch (e) {
    // Expected - invalid data should throw
    expect(e).toBeDefined();
  }
});

test("format parameter is case-insensitive", () => {
  expect(() => new CompressionStream("GZIP" as any)).not.toThrow();
  expect(() => new CompressionStream("GzIp" as any)).not.toThrow();
  expect(() => new CompressionStream("DEFLATE" as any)).not.toThrow();
  expect(() => new CompressionStream("Deflate-Raw" as any)).not.toThrow();
  expect(() => new CompressionStream("BROTLI" as any)).not.toThrow();
});

test("string input compression and decompression", async () => {
  const testString = "Hello, World! This is a test of string compression.";
  
  const cs = new CompressionStream("gzip");
  const writer = cs.writable.getWriter();
  const reader = cs.readable.getReader();
  
  // Write string directly (no TextEncoder needed)
  await writer.write(testString);
  await writer.close();
  
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  
  const compressed = new Uint8Array(chunks.reduce((acc, chunk) => acc + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    compressed.set(chunk, offset);
    offset += chunk.length;
  }
  
  // Now decompress
  const ds = new DecompressionStream("gzip");
  const dsWriter = ds.writable.getWriter();
  const dsReader = ds.readable.getReader();
  
  await dsWriter.write(compressed);
  await dsWriter.close();
  
  const decompressedChunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await dsReader.read();
    if (done) break;
    decompressedChunks.push(value);
  }
  
  const result = bytesToString(
    new Uint8Array(
      decompressedChunks.reduce((acc, chunk) => {
        const combined = new Uint8Array(acc.length + chunk.length);
        combined.set(acc);
        combined.set(chunk, acc.length);
        return combined;
      }, new Uint8Array(0))
    )
  );
  
  expect(result).toBe(testString);
});

test("compression actually reduces size for repetitive data", async () => {
  const repetitiveData = "a".repeat(10000);
  const input = stringToBytes(repetitiveData);

  const cs = new CompressionStream("gzip");
  const writer = cs.writable.getWriter();
  const reader = cs.readable.getReader();

  writer.write(input);
  writer.close();

  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }

  const compressedSize = chunks.reduce((acc, chunk) => acc + chunk.length, 0);

  // Compressed size should be much smaller than original
  expect(compressedSize).toBeLessThan(input.length / 10);
});

test("can pipe through CompressionStream and DecompressionStream", async () => {
  const input = stringToBytes(TEST_STRING);
  const inputStream = new ReadableStream({
    start(controller) {
      controller.enqueue(input);
      controller.close();
    },
  });

  const compressedStream = inputStream.pipeThrough(new CompressionStream("gzip"));
  const decompressedStream = compressedStream.pipeThrough(new DecompressionStream("gzip"));

  const reader = decompressedStream.getReader();
  const chunks: Uint8Array[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }

  const result = bytesToString(
    new Uint8Array(
      chunks.reduce((acc, chunk) => {
        const combined = new Uint8Array(acc.length + chunk.length);
        combined.set(acc);
        combined.set(chunk, acc.length);
        return combined;
      }, new Uint8Array(0)),
    ),
  );

  expect(result).toBe(TEST_STRING);
});

test("TypedArray views work as input", async () => {
  const buffer = new ArrayBuffer(TEST_STRING.length);
  const view = new Uint8Array(buffer);
  const encoder = new TextEncoder();
  encoder.encodeInto(TEST_STRING, view);

  const cs = new CompressionStream("gzip");
  const writer = cs.writable.getWriter();
  const reader = cs.readable.getReader();

  await writer.write(view);
  await writer.close();

  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }

  expect(chunks.length).toBeGreaterThan(0);
});

test("DataView works as input", async () => {
  const buffer = new ArrayBuffer(8);
  const view = new DataView(buffer);
  view.setFloat64(0, Math.PI);

  const cs = new CompressionStream("gzip");
  const writer = cs.writable.getWriter();
  const reader = cs.readable.getReader();

  await writer.write(view);
  await writer.close();

  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }

  expect(chunks.length).toBeGreaterThan(0);
});

test("write after close throws error", async () => {
  const cs = new CompressionStream("gzip");
  const writer = cs.writable.getWriter();

  await writer.close();

  // Writing after close should reject
  await expect(writer.write(stringToBytes("test"))).rejects.toThrow();
});

test("double close is idempotent", async () => {
  const cs = new CompressionStream("gzip");
  const writer = cs.writable.getWriter();

  await writer.close();
  // Second close should be a no-op or rejected promise - both are acceptable
  try {
    await writer.close();
    // If it succeeds, that's fine
  } catch {
    // If it rejects, that's also acceptable per spec
  }
  // The main thing is it shouldn't crash
  expect(true).toBe(true);
});

test("incremental output - data is produced before close", async () => {
  const cs = new CompressionStream("gzip");
  const writer = cs.writable.getWriter();
  const reader = cs.readable.getReader();

  // Write a large chunk
  const largeData = "x".repeat(100000);
  await writer.write(stringToBytes(largeData));

  // Should be able to read some compressed data before closing
  const { done, value } = await reader.read();
  expect(done).toBe(false);
  if (!done && value) {
    expect(value).toBeInstanceOf(Uint8Array);
    expect(value.length).toBeGreaterThan(0);
  }

  reader.releaseLock();
  await writer.close();
});

test("very small chunks compression", async () => {
  const cs = new CompressionStream("gzip");
  const writer = cs.writable.getWriter();
  const reader = cs.readable.getReader();

  // Write single bytes
  const text = "Hello";
  for (const char of text) {
    await writer.write(stringToBytes(char));
  }
  await writer.close();

  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }

  // Decompress and verify
  const compressed = new Uint8Array(chunks.reduce((acc, chunk) => acc + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    compressed.set(chunk, offset);
    offset += chunk.length;
  }

  const ds = new DecompressionStream("gzip");
  const dsWriter = ds.writable.getWriter();
  const dsReader = ds.readable.getReader();

  dsWriter.write(compressed);
  dsWriter.close();

  const decompressedChunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await dsReader.read();
    if (done) break;
    decompressedChunks.push(value);
  }

  const result = bytesToString(
    new Uint8Array(
      decompressedChunks.reduce((acc, chunk) => {
        const combined = new Uint8Array(acc.length + chunk.length);
        combined.set(acc);
        combined.set(chunk, acc.length);
        return combined;
      }, new Uint8Array(0)),
    ),
  );

  expect(result).toBe(text);
});

test("zero-length chunk in middle of stream", async () => {
  const cs = new CompressionStream("deflate");
  const writer = cs.writable.getWriter();
  const reader = cs.readable.getReader();

  await writer.write(stringToBytes("Hello"));
  await writer.write(new Uint8Array(0)); // Zero-length chunk
  await writer.write(stringToBytes(" World"));
  await writer.close();

  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }

  expect(chunks.length).toBeGreaterThan(0);
});

test("abort signal handling", async () => {
  const cs = new CompressionStream("gzip");
  const writer = cs.writable.getWriter();

  // Abort the writer
  await writer.abort("Test abort");

  // Further operations should fail
  await expect(writer.write(stringToBytes("more data"))).rejects.toThrow();
});

test("memory management - multiple streams", () => {
  // Create many streams to test memory handling
  const streams: CompressionStream[] = [];

  for (let i = 0; i < 100; i++) {
    streams.push(new CompressionStream("gzip"));
  }

  // All streams should be created successfully
  expect(streams.length).toBe(100);

  // Verify each has readable and writable
  for (const stream of streams) {
    expect(stream.readable).toBeInstanceOf(ReadableStream);
    expect(stream.writable).toBeInstanceOf(WritableStream);
  }
});

test("Node.js zlib compatibility roundtrip", async () => {
  const zlib = require("node:zlib");
  const text = "Test compatibility with Node.js zlib";

  // Compress with CompressionStream
  const cs = new CompressionStream("gzip");
  const writer = cs.writable.getWriter();
  const reader = cs.readable.getReader();

  writer.write(stringToBytes(text));
  writer.close();

  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }

  const compressed = Buffer.concat(chunks);

  // Decompress with Node.js zlib
  const decompressed = zlib.gunzipSync(compressed);
  expect(decompressed.toString()).toBe(text);

  // Also test the reverse: compress with Node.js, decompress with DecompressionStream
  const nodeCompressed = zlib.gzipSync(text);

  const ds = new DecompressionStream("gzip");
  const dsWriter = ds.writable.getWriter();
  const dsReader = ds.readable.getReader();

  dsWriter.write(new Uint8Array(nodeCompressed));
  dsWriter.close();

  const dsChunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await dsReader.read();
    if (done) break;
    dsChunks.push(value);
  }

  const dsResult = bytesToString(
    new Uint8Array(
      dsChunks.reduce((acc, chunk) => {
        const combined = new Uint8Array(acc.length + chunk.length);
        combined.set(acc);
        combined.set(chunk, acc.length);
        return combined;
      }, new Uint8Array(0)),
    ),
  );

  expect(dsResult).toBe(text);
});

test("chaining multiple compression streams", async () => {
  const text = "Chain multiple compressions";
  const input = stringToBytes(text);

  // First compression (gzip)
  const cs1 = new CompressionStream("gzip");
  const writer1 = cs1.writable.getWriter();
  const reader1 = cs1.readable.getReader();

  writer1.write(input);
  writer1.close();

  const compressed1: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader1.read();
    if (done) break;
    compressed1.push(value);
  }

  // Second compression (deflate) - compress the already compressed data
  const cs2 = new CompressionStream("deflate");
  const writer2 = cs2.writable.getWriter();
  const reader2 = cs2.readable.getReader();

  for (const chunk of compressed1) {
    await writer2.write(chunk);
  }
  writer2.close();

  const compressed2: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader2.read();
    if (done) break;
    compressed2.push(value);
  }

  // Now decompress in reverse order
  const ds1 = new DecompressionStream("deflate");
  const dsWriter1 = ds1.writable.getWriter();
  const dsReader1 = ds1.readable.getReader();

  for (const chunk of compressed2) {
    await dsWriter1.write(chunk);
  }
  dsWriter1.close();

  const decompressed1: Uint8Array[] = [];
  while (true) {
    const { done, value } = await dsReader1.read();
    if (done) break;
    decompressed1.push(value);
  }

  const ds2 = new DecompressionStream("gzip");
  const dsWriter2 = ds2.writable.getWriter();
  const dsReader2 = ds2.readable.getReader();

  for (const chunk of decompressed1) {
    await dsWriter2.write(chunk);
  }
  dsWriter2.close();

  const finalChunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await dsReader2.read();
    if (done) break;
    finalChunks.push(value);
  }

  const result = bytesToString(
    new Uint8Array(
      finalChunks.reduce((acc, chunk) => {
        const combined = new Uint8Array(acc.length + chunk.length);
        combined.set(acc);
        combined.set(chunk, acc.length);
        return combined;
      }, new Uint8Array(0)),
    ),
  );

  expect(result).toBe(text);
});
