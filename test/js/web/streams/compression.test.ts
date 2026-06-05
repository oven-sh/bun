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

describe("CompressionStream write/read ordering", () => {
  // The implementation buffers output on the readable side: awaiting writes
  // before any reader attaches must not deadlock. (A strictly spec-default
  // TransformStream — readable highWaterMark 0 — would stall here; this pins
  // Bun's long-standing buffered behavior.)
  test("awaiting writes before reading does not deadlock", async () => {
    const cs = new CompressionStream("gzip");
    const writer = cs.writable.getWriter();
    await writer.write(new TextEncoder().encode("hello"));
    await writer.write(new TextEncoder().encode("world"));
    await writer.close();

    const chunks: Uint8Array[] = [];
    for await (const chunk of cs.readable as unknown as AsyncIterable<Uint8Array>) chunks.push(chunk);
    const ds = new DecompressionStream("gzip");
    const w2 = ds.writable.getWriter();
    await w2.write(Buffer.concat(chunks));
    await w2.close();
    const out: Uint8Array[] = [];
    for await (const chunk of ds.readable as unknown as AsyncIterable<Uint8Array>) out.push(chunk);
    expect(Buffer.concat(out).toString()).toBe("helloworld");
  });

  test("writes after a chunk whose output expands past the buffer still resolve before reading", async () => {
    // ~100 bytes of input inflating to 64KB of output blows straight through
    // a single-chunkSize readable budget; the writes that follow must still
    // resolve with no reader attached — the node-adapter implementation
    // accepted ~16KB of *input* regardless of how large the buffered output
    // grew, and this sequence resolved on it.
    const big = zlib.gzipSync(Buffer.alloc(64 * 1024));
    const small = zlib.gzipSync(Buffer.from("hello"));
    const ds = new DecompressionStream("gzip");
    const writer = ds.writable.getWriter();
    await writer.write(big);
    for (let i = 0; i < 8; i++) await writer.write(small);
    // close() cannot settle until the reader drains the buffered output, so
    // capture its settlement and assert it after the drain loop.
    const closed = writer.close().then(
      () => "resolved",
      e => `rejected: ${e}`,
    );
    const out: Uint8Array[] = [];
    for await (const chunk of ds.readable as unknown as AsyncIterable<Uint8Array>) out.push(chunk);
    const total = Buffer.concat(out);
    expect(total.length).toBe(64 * 1024 + 8 * 5);
    expect(total.subarray(64 * 1024).toString()).toBe(Buffer.alloc(8 * 5, "hello").toString());
    expect(await closed).toBe("resolved");
  });

  test("corrupt input rejects with Z_DATA_ERROR", async () => {
    const ds = new DecompressionStream("gzip");
    const writer = ds.writable.getWriter();
    writer.write(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])).catch(() => {});
    writer.close().catch(() => {});
    try {
      for await (const _ of ds.readable as unknown as AsyncIterable<Uint8Array>) {
      }
      expect.unreachable();
    } catch (e) {
      expect((e as { code?: string }).code).toBe("Z_DATA_ERROR");
    }
  });
});

// Every behavior in this block was verified against Node v24 (except the
// brotli/zstd cases — formats Node doesn't support — which pin Bun's
// pre-existing behavior).
describe("CompressionStream Node.js compatibility", () => {
  async function collect(readable: ReadableStream<Uint8Array>): Promise<Uint8Array[]> {
    const chunks: Uint8Array[] = [];
    for await (const chunk of readable as unknown as AsyncIterable<Uint8Array>) chunks.push(chunk);
    return chunks;
  }

  async function drain(
    stream: CompressionStream | DecompressionStream,
    inputs: Array<string | ArrayBufferView>,
  ): Promise<Buffer> {
    const writer = stream.writable.getWriter();
    const collected = collect(stream.readable);
    try {
      for (const input of inputs) await writer.write(input);
      await writer.close();
    } catch (e) {
      // The readable rejects with the same stream error; settle it so the
      // write/close error is the one that propagates.
      await collected.catch(() => {});
      throw e;
    }
    return Buffer.concat(await collected);
  }

  async function decompress(format: string, inputs: Array<string | ArrayBufferView>): Promise<Buffer> {
    return drain(new DecompressionStream(format as Bun.CompressionFormat), inputs);
  }

  async function roundTrip(format: string, inputs: Array<string | ArrayBufferView>): Promise<Buffer> {
    return decompress(format, [await drain(new CompressionStream(format as Bun.CompressionFormat), inputs)]);
  }

  describe("input chunk types", () => {
    test("accepts string, DataView, TypedArray and offset subarray like node", async () => {
      expect(await roundTrip("gzip", ["hello"])).toEqual(Buffer.from("hello"));

      const bytes = new TextEncoder().encode("hello");
      expect(await roundTrip("gzip", [new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)])).toEqual(
        Buffer.from("hello"),
      );

      // A non-byte TypedArray is interpreted as its underlying bytes.
      expect(await roundTrip("gzip", [new Uint16Array([0x6568, 0x6c6c, 0x6f])])).toEqual(
        Buffer.from([0x68, 0x65, 0x6c, 0x6c, 0x6f, 0x00]),
      );

      // Only the view's window, not its whole backing buffer.
      const big = Buffer.alloc(32, 0xff);
      big.set(bytes, 10);
      expect(await roundTrip("gzip", [big.subarray(10, 15)])).toEqual(Buffer.from("hello"));
    });

    test.each([
      ["ArrayBuffer", () => new TextEncoder().encode("hello").buffer],
      ["number", () => 42],
      ["undefined", () => undefined],
      ["plain object", () => ({})],
      ["Blob", () => new Blob(["hello"])],
    ] as Array<[string, () => unknown]>)("rejects %s with ERR_INVALID_ARG_TYPE like node", async (_label, make) => {
      const cs = new CompressionStream("gzip");
      const writer = cs.writable.getWriter();
      const collected = collect(cs.readable).catch(() => []);
      const err = (await writer.write(make() as Uint8Array).then(
        () => null,
        e => e,
      )) as { code?: string; constructor: unknown } | null;
      expect(err).not.toBeNull();
      expect(err!.constructor).toBe(TypeError);
      expect(err!.code).toBe("ERR_INVALID_ARG_TYPE");
      // The failed write errors the whole stream. (Node instead leaves the
      // stream wedged — later writes never settle — so this pins the only
      // sane teardown.)
      expect(
        (
          await writer.closed.then(
            () => null,
            (e: { code?: string }) => e,
          )
        )?.code,
      ).toBe("ERR_INVALID_ARG_TYPE");
      await collected;
    });

    test("rejects null with ERR_STREAM_NULL_VALUES like node", async () => {
      const cs = new CompressionStream("gzip");
      const writer = cs.writable.getWriter();
      const collected = collect(cs.readable).catch(() => []);
      const err = (await writer.write(null as unknown as Uint8Array).then(
        () => null,
        e => e,
      )) as { code?: string } | null;
      expect(err?.code).toBe("ERR_STREAM_NULL_VALUES");
      await collected;
    });

    test("rejects a view over a detached ArrayBuffer with TypeError like node", async () => {
      const buffer = new ArrayBuffer(5);
      const view = new Uint8Array(buffer);
      structuredClone(buffer, { transfer: [buffer] }); // detach
      const cs = new CompressionStream("gzip");
      const writer = cs.writable.getWriter();
      const collected = collect(cs.readable).catch(() => []);
      const err = await writer.write(view).then(
        () => null,
        e => e,
      );
      expect(err).toBeInstanceOf(TypeError);
      await collected;
    });
  });

  describe("empty input", () => {
    test("empty chunks and an empty stream still produce a valid compressed stream", async () => {
      for (const format of ["gzip", "deflate", "deflate-raw", "brotli", "zstd"]) {
        expect(await roundTrip(format, [new Uint8Array(0)])).toEqual(Buffer.alloc(0));
        expect(await roundTrip(format, [])).toEqual(Buffer.alloc(0));
      }
    });

    test("closing an empty gzip/deflate/brotli DecompressionStream rejects with Z_BUF_ERROR like node", async () => {
      for (const format of ["gzip", "deflate", "deflate-raw", "brotli"]) {
        const err = (await decompress(format, []).then(
          () => null,
          e => e,
        )) as { code?: string } | null;
        expect(err?.code).toBe("Z_BUF_ERROR");
      }
    });

    test("closing an empty zstd DecompressionStream produces empty output", async () => {
      expect(await decompress("zstd", [])).toEqual(Buffer.alloc(0));
    });
  });

  describe("malformed compressed input", () => {
    test("truncated gzip rejects with Z_BUF_ERROR on close like node", async () => {
      const gzipped = zlib.gzipSync(Buffer.alloc(1000, "a"));
      const err = (await decompress("gzip", [gzipped.subarray(0, gzipped.length - 5)]).then(
        () => null,
        e => e,
      )) as { code?: string } | null;
      expect(err?.code).toBe("Z_BUF_ERROR");
    });

    test("trailing garbage after the gzip stream rejects with Z_DATA_ERROR like node", async () => {
      const payload = Buffer.concat([zlib.gzipSync(Buffer.from("hello")), Buffer.from("garbage!")]);
      const err = (await decompress("gzip", [payload]).then(
        () => null,
        e => e,
      )) as { code?: string } | null;
      expect(err?.code).toBe("Z_DATA_ERROR");
    });

    test("trailing bytes the engine leaves unconsumed at stream end are discarded like node", async () => {
      // The engine stops at stream end with the trailing bytes unconsumed
      // and no error; node's drive loop treats leftover input with spare
      // output as end-of-stream and discards it (lib/zlib.js
      // processCallback) instead of re-feeding bytes the engine refuses.
      // (gzip with NON-zero trailing bytes takes the multi-member path and
      // rejects instead — pinned above; zero bytes are member padding.)
      const payload = Buffer.from("hello");
      const cases: Array<[string, Buffer]> = [
        ["deflate", Buffer.concat([zlib.deflateSync(payload), Buffer.from([1])])],
        ["deflate-raw", Buffer.concat([zlib.deflateRawSync(payload), Buffer.from([1, 2, 3])])],
        ["gzip", Buffer.concat([zlib.gzipSync(payload), Buffer.alloc(8)])],
        ["brotli", Buffer.concat([zlib.brotliCompressSync(payload), Buffer.from([1, 2, 3])])],
        ["zstd", Buffer.concat([zlib.zstdCompressSync(payload), Buffer.from([1, 2, 3])])],
      ];
      for (const [format, input] of cases) {
        expect([format, (await decompress(format, [input])).toString()]).toEqual([format, "hello"]);
      }
    });

    test("corrupt zstd input carries the zstd error code", async () => {
      const err = (await decompress("zstd", [new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])]).then(
        () => null,
        e => e,
      )) as { code?: string } | null;
      expect(err?.code).toBe("ZSTD_error_prefix_unknown");
    });

    test("a corrupt chunk errors pending and subsequent operations like node", async () => {
      const ds = new DecompressionStream("gzip");
      const writer = ds.writable.getWriter();
      const reader = ds.readable.getReader();
      // (Node resolves this write — its adapter buffers the chunk before the
      // engine sees it — where the synchronous engine rejects it; the spec
      // propagates transform errors to the write. Don't pin the timing, pin
      // where the error surfaces and what it carries.)
      await writer.write(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])).catch(() => {});
      const readErr = (await reader.read().then(
        () => null,
        e => e,
      )) as { code?: string } | null;
      expect(readErr?.constructor).toBe(TypeError);
      expect(readErr?.code).toBe("Z_DATA_ERROR");
      expect(
        await writer.close().then(
          () => "resolved",
          () => "rejected",
        ),
      ).toBe("rejected");
    });
  });

  describe("gzip specifics", () => {
    test("concatenated gzip members decompress to the concatenated payload like node", async () => {
      const payload = Buffer.concat([zlib.gzipSync(Buffer.from("hello")), zlib.gzipSync(Buffer.from("world"))]);
      expect((await decompress("gzip", [payload])).toString()).toBe("helloworld");
    });

    test("decompressing byte-at-a-time yields the full payload", async () => {
      const expected = Buffer.alloc(300, "x");
      const gzipped = zlib.gzipSync(expected) as Buffer;
      const inputs = Array.from(gzipped, byte => new Uint8Array([byte]));
      expect(await decompress("gzip", inputs)).toEqual(expected);
    });
  });

  describe("output", () => {
    test("chunks are plain Uint8Arrays like node", async () => {
      const cs = new CompressionStream("gzip");
      const writer = cs.writable.getWriter();
      const collected = collect(cs.readable);
      await writer.write(Buffer.alloc(100, "a"));
      await writer.close();
      const chunks = await collected;
      expect(chunks.length).toBeGreaterThan(0);
      for (const chunk of chunks) {
        expect(Object.getPrototypeOf(chunk)).toBe(Uint8Array.prototype);
      }
    });

    test("chunks expose no bytes beyond their view — no recycled heap memory reachable", async () => {
      // Each output chunk is an exact-size allocation: chunk.buffer must not
      // reach past the view's window at all, so there is no spare region
      // that could disclose previous heap contents.
      const cs = new CompressionStream("gzip");
      const writer = cs.writable.getWriter();
      const collected = collect(cs.readable);
      await writer.write(Buffer.from("hello"));
      await writer.close();
      const chunks = await collected;
      for (const chunk of chunks) {
        expect(chunk.byteOffset).toBe(0);
        expect(chunk.buffer.byteLength).toBe(chunk.byteLength);
      }
    });

    test("byte-at-a-time decompression yields bounded exact-size chunks", async () => {
      // Incompressible input dribbled in byte-at-a-time makes the engine
      // emit many small output chunks. Each is an independent exact-size
      // allocation no larger than the native output granularity (16KB) —
      // the native drive adopts the engine's output buffers instead of
      // copying them into JS-side staging.
      const payload = new Uint8Array(1024);
      crypto.getRandomValues(payload);
      const gzipped = zlib.gzipSync(payload) as Buffer;

      const ds = new DecompressionStream("gzip");
      const writer = ds.writable.getWriter();
      const collected = collect(ds.readable);
      for (const byte of gzipped) await writer.write(new Uint8Array([byte]));
      await writer.close();
      const chunks = await collected;

      expect(Buffer.concat(chunks)).toEqual(Buffer.from(payload));
      expect(chunks.length).toBeGreaterThan(1);
      for (const chunk of chunks) {
        expect(chunk.byteLength).toBeLessThanOrEqual(16384);
        expect(chunk.buffer.byteLength).toBe(chunk.byteLength);
      }
    });

    test("multi-chunk payloads round-trip for every format", async () => {
      const incompressible = new Uint8Array(1024 * 1024);
      crypto.getRandomValues(incompressible);
      const compressible = Buffer.alloc(2 * 1024 * 1024, "abcdefgh");
      for (const format of ["gzip", "deflate", "deflate-raw", "brotli", "zstd"]) {
        expect(await roundTrip(format, [incompressible])).toEqual(Buffer.from(incompressible));
        expect(await roundTrip(format, [compressible])).toEqual(compressible);
      }
    });

    test("output bytes match node:zlib for gzip", async () => {
      const payload = Buffer.alloc(100_000, "compression streams test ");
      expect(await decompress("gzip", [zlib.gzipSync(payload)])).toEqual(payload);
      const compressed = await drain(new CompressionStream("gzip"), [payload]);
      expect(zlib.gunzipSync(compressed)).toEqual(payload);
    });
  });

  describe("teardown", () => {
    test("reader.cancel() errors the writable with the cancel reason like node", async () => {
      const cs = new CompressionStream("gzip");
      const writer = cs.writable.getWriter();
      const reader = cs.readable.getReader();
      await writer.write(Buffer.from("hello"));
      await reader.cancel("because");
      expect(
        await writer.write(Buffer.from("world")).then(
          () => null,
          e => e,
        ),
      ).toBe("because");
      expect(
        await writer.closed.then(
          () => null,
          (e: unknown) => e,
        ),
      ).toBe("because");
    });

    test("writer.abort() errors pending reads with the abort reason like node", async () => {
      const cs = new CompressionStream("gzip");
      const writer = cs.writable.getWriter();
      const reader = cs.readable.getReader();
      await writer.write(Buffer.from("hello"));
      const boom = new Error("boom");
      await writer.abort(boom);
      expect(
        await reader.read().then(
          () => null,
          e => e,
        ),
      ).toBe(boom);
    });

    test("a fresh stream can be torn down immediately", async () => {
      // No writes at all — cancel/abort must not trip over the engine.
      await new CompressionStream("gzip").readable.cancel("x");
      await new DecompressionStream("gzip").writable.abort("y");
      const cs = new CompressionStream("zstd");
      await Promise.all([cs.readable.cancel(), cs.writable.abort()].map(p => p.catch(() => {})));
    });
  });
});

describe("engine lifecycle", () => {
  // The native transformer holds a zlib/brotli/zstd context (~256KB for
  // deflate). These loops create far more streams than would fit in memory
  // if any teardown path leaked the context: completed, cancelled
  // mid-stream, aborted, and abandoned-to-GC streams must all release it.
  const RSS_BUDGET_MB = 256;

  async function rssGrowthMB(fn: () => Promise<void>): Promise<number> {
    Bun.gc(true);
    const before = process.memoryUsage.rss();
    await fn();
    Bun.gc(true);
    return (process.memoryUsage.rss() - before) / 1024 / 1024;
  }

  test("completed streams release the engine", async () => {
    const growth = await rssGrowthMB(async () => {
      for (let i = 0; i < 500; i++) {
        const cs = new CompressionStream("gzip");
        const writer = cs.writable.getWriter();
        const reads = (async () => {
          for await (const _ of cs.readable as unknown as AsyncIterable<Uint8Array>) {
          }
        })();
        await writer.write(new Uint8Array(1024));
        await writer.close();
        await reads;
      }
    });
    expect(growth).toBeLessThan(RSS_BUDGET_MB);
  });

  test("cancelled and aborted streams release the engine", async () => {
    const growth = await rssGrowthMB(async () => {
      for (let i = 0; i < 500; i++) {
        const cs = new CompressionStream(i % 2 ? "gzip" : "zstd");
        const writer = cs.writable.getWriter();
        await writer.write(new Uint8Array(1024)).catch(() => {});
        if (i % 2) {
          await cs.readable.cancel("done");
          await writer.abort("done").catch(() => {});
        } else {
          await writer.abort("done").catch(() => {});
          await cs.readable.cancel("done").catch(() => {});
        }
      }
    });
    expect(growth).toBeLessThan(RSS_BUDGET_MB);
  });

  test("abandoned streams release the engine via GC", async () => {
    const growth = await rssGrowthMB(async () => {
      for (let i = 0; i < 1000; i++) {
        // No flush, no cancel — the only release path is finalization.
        const cs = new CompressionStream("deflate");
        const writer = cs.writable.getWriter();
        await writer.write(new Uint8Array(64)).catch(() => {});
        if (i % 100 === 99) Bun.gc(true);
      }
    });
    expect(growth).toBeLessThan(RSS_BUDGET_MB);
  });
});
