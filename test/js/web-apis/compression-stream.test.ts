import { describe, it, expect, test } from "bun:test";

describe("CompressionStream", () => {
  it("should be defined globally", () => {
    expect(CompressionStream).toBeDefined();
    expect(DecompressionStream).toBeDefined();
  });

  it("should create with default gzip format", () => {
    const cs = new CompressionStream();
    expect(cs).toBeInstanceOf(CompressionStream);
    expect(cs.readable).toBeInstanceOf(ReadableStream);
    expect(cs.writable).toBeInstanceOf(WritableStream);
  });

  it("should accept valid formats", () => {
    const formats: CompressionFormat[] = ["gzip", "deflate", "deflate-raw"];
    for (const format of formats) {
      const cs = new CompressionStream(format);
      expect(cs).toBeInstanceOf(CompressionStream);
    }
  });

  it("should reject invalid formats", () => {
    expect(() => new CompressionStream("invalid" as CompressionFormat)).toThrow();
    expect(() => new CompressionStream("brotli" as CompressionFormat)).toThrow(); // Not implemented yet
  });

  it("should compress and decompress data roundtrip", async () => {
    const input = "Hello, World! ".repeat(100);
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    // Compress
    const cs = new CompressionStream("gzip");
    const writer = cs.writable.getWriter();
    const reader = cs.readable.getReader();

    writer.write(encoder.encode(input));
    writer.close();

    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }

    const compressed = new Blob(chunks);
    expect(compressed.size).toBeLessThan(input.length);

    // Decompress
    const ds = new DecompressionStream("gzip");
    const decompressWriter = ds.writable.getWriter();
    const decompressReader = ds.readable.getReader();

    for (const chunk of chunks) {
      await decompressWriter.write(chunk);
    }
    await decompressWriter.close();

    const decompressedChunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await decompressReader.read();
      if (done) break;
      decompressedChunks.push(value);
    }

    const decompressed = new Blob(decompressedChunks);
    const result = decoder.decode(await decompressed.arrayBuffer());
    expect(result).toBe(input);
  });

  it("should handle empty input", async () => {
    const cs = new CompressionStream();
    const writer = cs.writable.getWriter();
    const reader = cs.readable.getReader();

    await writer.close();

    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }

    expect(chunks.length).toBeGreaterThan(0); // Should have gzip headers at least
  });

  test("should work with pipeTo/pipeThrough", async () => {
    const input = "Test data for piping";
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    const inputStream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(input));
        controller.close();
      },
    });

    const cs = new CompressionStream();
    const ds = new DecompressionStream();

    const result = await inputStream
      .pipeThrough(cs)
      .pipeThrough(ds)
      .pipeThrough(new TextDecoderStream());

    const reader = result.getReader();
    let output = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      output += value;
    }

    expect(output).toBe(input);
  });

  test("deflate format roundtrip", async () => {
    const input = "Deflate compression test";
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    // Compress with deflate
    const cs = new CompressionStream("deflate");
    const writer = cs.writable.getWriter();
    const reader = cs.readable.getReader();

    await writer.write(encoder.encode(input));
    await writer.close();

    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }

    // Decompress with deflate
    const ds = new DecompressionStream("deflate");
    const decompressWriter = ds.writable.getWriter();
    const decompressReader = ds.readable.getReader();

    for (const chunk of chunks) {
      await decompressWriter.write(chunk);
    }
    await decompressWriter.close();

    const decompressedChunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await decompressReader.read();
      if (done) break;
      decompressedChunks.push(value);
    }

    const decompressed = new Blob(decompressedChunks);
    const result = decoder.decode(await decompressed.arrayBuffer());
    expect(result).toBe(input);
  });

  test("should handle large data", async () => {
    const largeData = "x".repeat(1024 * 1024); // 1MB of data
    const encoder = new TextEncoder();

    const cs = new CompressionStream();
    const writer = cs.writable.getWriter();
    const reader = cs.readable.getReader();

    await writer.write(encoder.encode(largeData));
    await writer.close();

    let compressedSize = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      compressedSize += value.length;
    }

    // Compression should significantly reduce size for repetitive data
    expect(compressedSize).toBeLessThan(largeData.length / 10);
  });

  test("should handle multiple writes", async () => {
    const chunks = ["Hello", " ", "World", "!"];
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    const cs = new CompressionStream();
    const ds = new DecompressionStream();

    const writer = cs.writable.getWriter();
    for (const chunk of chunks) {
      await writer.write(encoder.encode(chunk));
    }
    await writer.close();

    await cs.readable.pipeTo(ds.writable);

    const reader = ds.readable.getReader();
    let result = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      result += decoder.decode(value, { stream: true });
    }

    expect(result).toBe(chunks.join(""));
  });
});

describe("DecompressionStream", () => {
  it("should reject invalid compressed data", async () => {
    const ds = new DecompressionStream();
    const writer = ds.writable.getWriter();
    const reader = ds.readable.getReader();

    // Write invalid data
    await writer.write(new Uint8Array([1, 2, 3, 4, 5]));
    await writer.close();

    // Should fail when trying to decompress
    await expect(reader.read()).rejects.toThrow();
  });

  it("should handle format mismatch", async () => {
    const encoder = new TextEncoder();

    // Compress as gzip
    const cs = new CompressionStream("gzip");
    const writer = cs.writable.getWriter();
    await writer.write(encoder.encode("test"));
    await writer.close();

    const chunks: Uint8Array[] = [];
    const reader = cs.readable.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }

    // Try to decompress as deflate (should fail)
    const ds = new DecompressionStream("deflate");
    const dsWriter = ds.writable.getWriter();
    const dsReader = ds.readable.getReader();

    for (const chunk of chunks) {
      await dsWriter.write(chunk);
    }
    await dsWriter.close();

    // Should fail when reading
    await expect(dsReader.read()).rejects.toThrow();
  });
});