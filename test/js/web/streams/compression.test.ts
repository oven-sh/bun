import { describe, expect, test } from "bun:test";

describe("CompressionStream and DecompressionStream", () => {
  describe("brotli", () => {
    test("compresses data with brotli", async () => {
      const input = "Hello, Bun! This is a test string for brotli compression.";
      const encoder = new TextEncoder();
      const data = encoder.encode(input);

      const compressionStream = new CompressionStream("brotli");
      const writer = compressionStream.writable.getWriter();
      writer.write(data);
      writer.close();

      const compressedChunks: Uint8Array[] = [];
      const reader = compressionStream.readable.getReader();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        compressedChunks.push(value);
      }

      expect(compressedChunks.length).toBeGreaterThan(0);
      const totalLength = compressedChunks.reduce((acc, chunk) => acc + chunk.length, 0);
      expect(totalLength).toBeGreaterThan(0);
    });

    test("decompresses brotli data", async () => {
      const input = "Hello, Bun! This is a test string for brotli decompression.";
      const encoder = new TextEncoder();
      const decoder = new TextDecoder();
      const data = encoder.encode(input);

      // First compress
      const compressionStream = new CompressionStream("brotli");
      const writer = compressionStream.writable.getWriter();
      writer.write(data);
      writer.close();

      const compressedChunks: Uint8Array[] = [];
      const reader = compressionStream.readable.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        compressedChunks.push(value);
      }

      // Concatenate compressed chunks
      const totalLength = compressedChunks.reduce((acc, chunk) => acc + chunk.length, 0);
      const compressed = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of compressedChunks) {
        compressed.set(chunk, offset);
        offset += chunk.length;
      }

      // Then decompress
      const decompressionStream = new DecompressionStream("brotli");
      const decompWriter = decompressionStream.writable.getWriter();
      decompWriter.write(compressed);
      decompWriter.close();

      const decompressedChunks: Uint8Array[] = [];
      const decompReader = decompressionStream.readable.getReader();
      while (true) {
        const { done, value } = await decompReader.read();
        if (done) break;
        decompressedChunks.push(value);
      }

      const decompressedLength = decompressedChunks.reduce((acc, chunk) => acc + chunk.length, 0);
      const decompressed = new Uint8Array(decompressedLength);
      offset = 0;
      for (const chunk of decompressedChunks) {
        decompressed.set(chunk, offset);
        offset += chunk.length;
      }

      const output = decoder.decode(decompressed);
      expect(output).toBe(input);
    });

    test("round-trip compression with brotli", async () => {
      const testData = [
        "Simple string",
        Buffer.alloc(1000, "A").toString(),
        "Mixed 123 !@# symbols",
        "",
        JSON.stringify({ nested: { object: "value" } }),
      ];

      for (const input of testData) {
        const encoder = new TextEncoder();
        const decoder = new TextDecoder();
        const data = encoder.encode(input);

        // Compress and decompress
        const compressed = await new Response(
          new Blob([data]).stream().pipeThrough(new CompressionStream("brotli")),
        ).arrayBuffer();

        const decompressed = await new Response(
          new Blob([compressed]).stream().pipeThrough(new DecompressionStream("brotli")),
        ).arrayBuffer();

        const output = decoder.decode(decompressed);
        expect(output).toBe(input);
      }
    });
  });

  describe("zstd", () => {
    test("compresses data with zstd", async () => {
      const input = "Hello, Bun! This is a test string for zstd compression.";
      const encoder = new TextEncoder();
      const data = encoder.encode(input);

      const compressionStream = new CompressionStream("zstd");
      const writer = compressionStream.writable.getWriter();
      writer.write(data);
      writer.close();

      const compressedChunks: Uint8Array[] = [];
      const reader = compressionStream.readable.getReader();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        compressedChunks.push(value);
      }

      expect(compressedChunks.length).toBeGreaterThan(0);
      const totalLength = compressedChunks.reduce((acc, chunk) => acc + chunk.length, 0);
      expect(totalLength).toBeGreaterThan(0);
    });

    test("decompresses zstd data", async () => {
      const input = "Hello, Bun! This is a test string for zstd decompression.";
      const encoder = new TextEncoder();
      const decoder = new TextDecoder();
      const data = encoder.encode(input);

      // First compress
      const compressionStream = new CompressionStream("zstd");
      const writer = compressionStream.writable.getWriter();
      writer.write(data);
      writer.close();

      const compressedChunks: Uint8Array[] = [];
      const reader = compressionStream.readable.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        compressedChunks.push(value);
      }

      // Concatenate compressed chunks
      const totalLength = compressedChunks.reduce((acc, chunk) => acc + chunk.length, 0);
      const compressed = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of compressedChunks) {
        compressed.set(chunk, offset);
        offset += chunk.length;
      }

      // Then decompress
      const decompressionStream = new DecompressionStream("zstd");
      const decompWriter = decompressionStream.writable.getWriter();
      decompWriter.write(compressed);
      decompWriter.close();

      const decompressedChunks: Uint8Array[] = [];
      const decompReader = decompressionStream.readable.getReader();
      while (true) {
        const { done, value } = await decompReader.read();
        if (done) break;
        decompressedChunks.push(value);
      }

      const decompressedLength = decompressedChunks.reduce((acc, chunk) => acc + chunk.length, 0);
      const decompressed = new Uint8Array(decompressedLength);
      offset = 0;
      for (const chunk of decompressedChunks) {
        decompressed.set(chunk, offset);
        offset += chunk.length;
      }

      const output = decoder.decode(decompressed);
      expect(output).toBe(input);
    });

    test("round-trip compression with zstd", async () => {
      const testData = [
        "Simple string",
        Buffer.alloc(1000, "A").toString(),
        "Mixed 123 !@# symbols",
        "",
        JSON.stringify({ nested: { object: "value" } }),
      ];

      for (const input of testData) {
        const encoder = new TextEncoder();
        const decoder = new TextDecoder();
        const data = encoder.encode(input);

        // Compress and decompress
        const compressed = await new Response(
          new Blob([data]).stream().pipeThrough(new CompressionStream("zstd")),
        ).arrayBuffer();

        const decompressed = await new Response(
          new Blob([compressed]).stream().pipeThrough(new DecompressionStream("zstd")),
        ).arrayBuffer();

        const output = decoder.decode(decompressed);
        expect(output).toBe(input);
      }
    });
  });

  describe("all formats", () => {
    test("works with all compression formats", async () => {
      const formats: Array<"gzip" | "deflate" | "deflate-raw" | "brotli" | "zstd"> = [
        "gzip",
        "deflate",
        "deflate-raw",
        "brotli",
        "zstd",
      ];

      const input = "Test data for all compression formats!";
      const encoder = new TextEncoder();
      const decoder = new TextDecoder();
      const data = encoder.encode(input);

      for (const format of formats) {
        const compressed = await new Response(
          new Blob([data]).stream().pipeThrough(new CompressionStream(format)),
        ).arrayBuffer();

        const decompressed = await new Response(
          new Blob([compressed]).stream().pipeThrough(new DecompressionStream(format)),
        ).arrayBuffer();

        const output = decoder.decode(decompressed);
        expect(output).toBe(input);
      }
    });
  });
});

// Ported behaviors from Node v26's webstreams adapters
// (upstream: test-whatwg-webstreams-compression.js and
// lib/internal/webstreams/compression.js validateBufferSourceChunk).
describe("CompressionStream chunk handling (Node v26 semantics)", () => {
  test("accepts ArrayBuffer chunks", async () => {
    const input = "hello arraybuffer world";
    const data = new TextEncoder().encode(input);

    const cs = new CompressionStream("gzip");
    const writer = cs.writable.getWriter();
    writer.write(data.buffer);
    writer.close();

    const compressedChunks: Uint8Array[] = [];
    const reader = cs.readable.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      compressedChunks.push(value);
    }
    expect(compressedChunks.length).toBeGreaterThan(0);

    const ds = new DecompressionStream("gzip");
    const dWriter = ds.writable.getWriter();
    for (const chunk of compressedChunks) dWriter.write(chunk);
    dWriter.close();

    const out: Uint8Array[] = [];
    const dReader = ds.readable.getReader();
    while (true) {
      const { done, value } = await dReader.read();
      if (done) break;
      out.push(value);
    }
    expect(new TextDecoder().decode(Buffer.concat(out))).toBe(input);
  });

  test("rejects SharedArrayBuffer chunks with ERR_INVALID_ARG_TYPE", async () => {
    const cs = new CompressionStream("gzip");
    const writer = cs.writable.getWriter();
    expect.assertions(1);
    try {
      await writer.write(new SharedArrayBuffer(8));
    } catch (e: any) {
      expect(e.code).toBe("ERR_INVALID_ARG_TYPE");
    }
  });

  test("a synchronously-invalid chunk errors both sides instead of hanging the readable", async () => {
    const cs = new CompressionStream("gzip");
    const writer = cs.writable.getWriter();
    const reader = cs.readable.getReader();

    const writeError = writer.write(42).catch(e => e);
    // Without the kDestroyOnSyncError handling the readable side hangs
    // forever here.
    const readError = reader.read().catch(e => e);

    const [we, re] = await Promise.all([writeError, readError]);
    expect(we.code).toBe("ERR_INVALID_ARG_TYPE");
    expect(re.code).toBe("ERR_INVALID_ARG_TYPE");
  });

  test("brotli decoder errors surface as TypeError with the original code as own property", async () => {
    const ds = new DecompressionStream("brotli");
    const writer = ds.writable.getWriter();
    const reader = ds.readable.getReader();

    writer.write(new Uint8Array([0xff, 0xff, 0xff, 0xff, 0xff, 0xff])).catch(() => {});
    writer.close().catch(() => {});

    expect.assertions(4);
    try {
      while (true) {
        const { done } = await reader.read();
        if (done) break;
      }
    } catch (e: any) {
      expect(e).toBeInstanceOf(TypeError);
      expect(Object.hasOwn(e, "code")).toBe(true);
      // Node builds these as "ERR_" + BrotliDecoderErrorString(), and brotli
      // returns the macro PREFIX+NAME ("_ERROR_FORMAT_" + "PADDING_2"), so the
      // double underscore is what node:zlib emits.
      expect(e.code).toBe("ERR__ERROR_FORMAT_PADDING_2");
      expect(e.cause.code).toBe(e.code);
    }
  });
});
