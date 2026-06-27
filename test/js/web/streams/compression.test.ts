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

// Node's DecompressionStream rejects any input left over after the end of the
// compressed stream (lib/zlib.js `rejectGarbageAfterEnd`, passed by
// lib/internal/webstreams/compression.js). Previously Bun dropped the extra
// bytes and resolved successfully with a truncated result.
describe("DecompressionStream trailing data (Node v26 semantics)", () => {
  type Format = "deflate" | "deflate-raw" | "gzip" | "brotli" | "zstd";

  async function decompress(format: Format, chunks: Uint8Array[]): Promise<string> {
    const ds = new DecompressionStream(format);
    const writer = ds.writable.getWriter();
    const readAll = (async () => {
      const out: Uint8Array[] = [];
      const reader = ds.readable.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        out.push(value);
      }
      return new TextDecoder().decode(Buffer.concat(out));
    })();
    const writeAll = (async () => {
      for (const chunk of chunks) await writer.write(chunk);
      await writer.close();
    })();
    // Settle both sides so a rejection on one never goes unhandled.
    const [read, write] = await Promise.allSettled([readAll, writeAll]);
    if (write.status === "rejected") throw write.reason;
    if (read.status === "rejected") throw read.reason;
    return read.value;
  }

  async function rejection(promise: Promise<unknown>): Promise<any> {
    return await promise.then(
      value => ({ resolved: value }),
      error => error,
    );
  }

  function expectTrailingJunkError(err: any) {
    expect(err).toBeInstanceOf(TypeError);
    expect(err.code).toBe("ERR_TRAILING_JUNK_AFTER_STREAM_END");
    expect(err.message).toBe("Trailing junk found after the end of the compressed stream");
  }

  const compressors: Record<Format, (input: string) => Uint8Array> = {
    "deflate": input => zlib.deflateSync(input),
    "deflate-raw": input => zlib.deflateRawSync(input),
    "gzip": input => zlib.gzipSync(input),
    "brotli": input => zlib.brotliCompressSync(input),
    "zstd": input => zlib.zstdCompressSync(input),
  };
  const formats = Object.keys(compressors) as Format[];

  // gzip is excluded here: non-zero trailing bytes after a gzip member are fed
  // back to zlib as a second member and already failed with Z_DATA_ERROR.
  test.each(formats.filter(format => format !== "gzip"))(
    "%s rejects trailing junk appended to the compressed data",
    async format => {
      const bad = Buffer.concat([compressors[format]("AAAA"), Buffer.from("JUNK")]);
      expectTrailingJunkError(await rejection(decompress(format, [bad])));
    },
  );

  test("gzip rejects trailing junk appended to the compressed data", async () => {
    const bad = Buffer.concat([compressors.gzip("AAAA"), Buffer.from("JUNK")]);
    const err = await rejection(decompress("gzip", [bad]));
    // The junk is parsed as a second gzip member, so zlib reports it itself.
    expect(err).toBeInstanceOf(TypeError);
    expect(err.cause?.code).toBe("Z_DATA_ERROR");
  });

  test.each(["deflate", "deflate-raw", "brotli"] as Format[])(
    "%s rejects junk written after the stream already ended",
    async format => {
      const chunks = [compressors[format]("AAAA"), Buffer.from("JUNK")];
      expectTrailingJunkError(await rejection(decompress(format, chunks)));
    },
  );

  test("deflate rejects a second concatenated stream instead of silently dropping it", async () => {
    const a = compressors.deflate("AAAA");
    const b = compressors.deflate("BBBB");
    expectTrailingJunkError(await rejection(decompress("deflate", [Buffer.concat([a, b])])));
  });

  // Zero bytes are skipped by the multi-member loop (historically used for
  // padding), but node still rejects them in DecompressionStream.
  test("gzip rejects trailing zero-byte padding", async () => {
    const padded = Buffer.concat([compressors.gzip("AAAA"), Buffer.alloc(4)]);
    expectTrailingJunkError(await rejection(decompress("gzip", [padded])));
  });

  test("gzip still concatenates multiple members", async () => {
    const a = compressors.gzip("AAAA");
    const b = compressors.gzip("BBBB");
    expect(await decompress("gzip", [Buffer.concat([a, b])])).toBe("AAAABBBB");
    expect(await decompress("gzip", [a, b])).toBe("AAAABBBB");
  });

  test.each(formats)("%s still decompresses a clean stream", async format => {
    expect(await decompress(format, [compressors[format]("AAAA")])).toBe("AAAA");
  });

  test("the readable side errors too when piping", async () => {
    const bad = Buffer.concat([compressors.deflate("AAAA"), Buffer.from("JUNK")]);
    const response = new Response(new Blob([bad]).stream().pipeThrough(new DecompressionStream("deflate")));
    expectTrailingJunkError(await rejection(response.arrayBuffer()));
  });
});
