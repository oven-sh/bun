import { describe, expect, test } from "bun:test";
import zlib from "node:zlib";

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

    // RFC 8878 §3.1: a zstd stream is one or more concatenated frames; a
    // decoder MUST decode each in order. pzstd output is multi-frame by
    // construction, as is `cat a.zst b.zst`.
    test("decompresses a multi-frame zstd stream", async () => {
      const f1 = zlib.zstdCompressSync(Buffer.from("first frame\n"));
      const f2 = zlib.zstdCompressSync(Buffer.from("second frame\n"));
      const cat = Buffer.concat([f1, f2]);

      const out = await new Response(new Blob([cat]).stream().pipeThrough(new DecompressionStream("zstd"))).text();
      expect(out).toBe("first frame\nsecond frame\n");
    });

    // Skippable frame: magic 0x184D2A50..5F, 4-byte LE size, then size bytes.
    const skippable = Buffer.concat([
      Buffer.from([0x55, 0x2a, 0x4d, 0x18]), // magic (variant 5)
      Buffer.from([0x03, 0x00, 0x00, 0x00]), // size = 3
      Buffer.from([0xaa, 0xbb, 0xcc]),
    ]);

    test.each([
      ["zstd frame", zlib.zstdCompressSync(Buffer.from("second frame\n")), "first frame\nsecond frame\n"],
      [
        "skippable frame",
        Buffer.concat([skippable, zlib.zstdCompressSync(Buffer.from("second frame\n"))]),
        "first frame\nsecond frame\n",
      ],
    ] as const)("decompresses a multi-frame zstd stream split across writes (next = %s)", async (_, next, expected) => {
      const f1 = zlib.zstdCompressSync(Buffer.from("first frame\n"));
      const cat = Buffer.concat([f1, next]);

      for (const offset of [1, 2, 3]) {
        const ds = new DecompressionStream("zstd");
        const writer = ds.writable.getWriter();
        const read = new Response(ds.readable).text();
        const split = f1.length + offset;
        await writer.write(cat.subarray(0, split));
        await writer.write(cat.subarray(split));
        await writer.close();
        expect(await read).toBe(expected);
      }
    });

    test("decompresses many concatenated zstd frames larger than one output chunk", async () => {
      const piece = Buffer.alloc(4096, "Z");
      const frame = zlib.zstdCompressSync(piece);
      const frames: Buffer[] = [];
      for (let i = 0; i < 64; i++) frames.push(frame);
      const cat = Buffer.concat(frames);

      const out = Buffer.from(
        await new Response(new Blob([cat]).stream().pipeThrough(new DecompressionStream("zstd"))).arrayBuffer(),
      );
      expect(out.length).toBe(piece.length * 64);
      expect(out.equals(Buffer.alloc(piece.length * 64, "Z"))).toBe(true);
    });

    test("decompresses a zstd stream with a leading skippable frame", async () => {
      const frame = zlib.zstdCompressSync(Buffer.from("payload"));
      const cat = Buffer.concat([skippable, frame, skippable]);

      const out = await new Response(new Blob([cat]).stream().pipeThrough(new DecompressionStream("zstd"))).text();
      expect(out).toBe("payload");
    });

    test("rejects trailing garbage after a zstd frame", async () => {
      const frame = zlib.zstdCompressSync(Buffer.from("hello"));
      const withJunk = Buffer.concat([frame, Buffer.from([0xde, 0xad, 0xbe, 0xef])]);

      const read = new Response(new Blob([withJunk]).stream().pipeThrough(new DecompressionStream("zstd"))).text();
      await expect(read).rejects.toMatchObject({ code: "ERR_TRAILING_JUNK_AFTER_STREAM_END" });
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

  // DecompressionStream rejects trailing bytes after the compressed data. Concatenated
  // gzip members are a single valid stream per RFC 1952 section 2.2, not trailing junk,
  // so they must still decode in full.
  test("gzip decodes concatenated members rather than stopping at the first", async () => {
    const gzip = async (text: string) =>
      new Uint8Array(
        await new Response(new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer(),
      );
    const concatenated = Buffer.concat([await gzip("hello "), await gzip("world")]);

    const decoded = await new Response(
      new Blob([concatenated]).stream().pipeThrough(new DecompressionStream("gzip")),
    ).text();

    expect(decoded).toBe("hello world");
  });
});
