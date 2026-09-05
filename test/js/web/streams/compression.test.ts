import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN } from "harness";
import { once } from "node:events";
import { addAbortSignal } from "node:stream";
import zlib from "node:zlib";

// CompressionStream et al are C++ subclasses of JSTransformStream so that
// $inheritsTransformStream() returns true (node:stream utils). The JS-visible
// prototype chain is unchanged, and TransformStream.prototype's own brand-
// checked getters still reject them (Web IDL: separate interfaces).
test.each([
  () => new CompressionStream("gzip"),
  () => new DecompressionStream("gzip"),
  () => new TextEncoderStream(),
  () => new TextDecoderStream(),
])("TransformStream.prototype getters reject native transform subclasses (%#)", ctor => {
  const x = ctor();
  expect(x instanceof TransformStream).toBe(false);
  const get = Object.getOwnPropertyDescriptor(TransformStream.prototype, "readable")!.get!;
  expect(() => get.call(x)).toThrow();
});

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

    // https://github.com/oven-sh/bun/issues/41439
    // A flushed brotli chunk must come out in full once its write settles. The
    // decoder used to stop after one 16 KiB output buffer and keep the rest
    // until the next compressed chunk was written.
    test("DecompressionStream delivers the whole flushed chunk before the next write", async () => {
      const firstLine = Buffer.alloc(40000, "x").toString() + "\n";
      const secondLine = "done\n";

      const compressor = zlib.createBrotliCompress();
      const compressed: Buffer[] = [];
      compressor.on("data", chunk => compressed.push(chunk));
      await new Promise<void>(resolve => {
        compressor.write(firstLine);
        compressor.flush(resolve);
      });
      const firstPart = Buffer.concat(compressed.splice(0));
      compressor.end(secondLine);
      await once(compressor, "end");
      const restPart = Buffer.concat(compressed.splice(0));

      const ds = new DecompressionStream("brotli");
      const writer = ds.writable.getWriter();
      const reader = ds.readable.getReader();
      let received = 0;
      const readAll = (async () => {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          received += value.byteLength;
        }
      })();

      // The write settles only once every output step of the chunk is done.
      await writer.write(firstPart);
      // Let the pending reads above settle before we count.
      await new Promise(resolve => setImmediate(resolve));
      expect(received).toBe(firstLine.length);

      await writer.write(restPart);
      await writer.close();
      await readAll;
      expect(received).toBe(firstLine.length + secondLine.length);
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

  // Chunks larger than 128KB are handed to the threadpool so the codec work
  // doesn't block the JS thread; these cover byte-identical output on that
  // path and that the write promise is observably asynchronous.
  describe("large chunks (>128KB async codec path)", () => {
    function randomBytes(len: number) {
      const out = new Uint8Array(len);
      for (let off = 0; off < len; off += 65536) {
        crypto.getRandomValues(out.subarray(off, Math.min(off + 65536, len)));
      }
      return out;
    }

    test("2MB chunk round-trips through CompressionStream('gzip') -> DecompressionStream('gzip')", async () => {
      const big = randomBytes(2 * 1024 * 1024);

      const cs = new CompressionStream("gzip");
      const cw = cs.writable.getWriter();
      const compressedP = new Response(cs.readable).arrayBuffer();
      await cw.write(big);
      await cw.close();
      const compressed = new Uint8Array(await compressedP);
      expect(compressed.byteLength).toBeGreaterThan(0);

      const ds = new DecompressionStream("gzip");
      const dw = ds.writable.getWriter();
      const decompressedP = new Response(ds.readable).arrayBuffer();
      await dw.write(compressed);
      await dw.close();
      const decompressed = Buffer.from(await decompressedP);

      expect(decompressed.byteLength).toBe(big.byteLength);
      expect(Buffer.compare(decompressed, Buffer.from(big.buffer))).toBe(0);
    });

    test("DecompressionStream('gzip') handles a single >128KB compressed chunk", async () => {
      const big = randomBytes(2 * 1024 * 1024);
      // Incompressible input so the gzipped output itself exceeds the 128KB
      // threshold and takes the threadpool path as a single write.
      const compressed = zlib.gzipSync(big);
      expect(compressed.byteLength).toBeGreaterThan(128 * 1024);

      const ds = new DecompressionStream("gzip");
      const dw = ds.writable.getWriter();
      const outP = new Response(ds.readable).arrayBuffer();
      await dw.write(compressed);
      await dw.close();
      const out = Buffer.from(await outP);

      expect(out.byteLength).toBe(big.byteLength);
      expect(Buffer.compare(out, Buffer.from(big.buffer))).toBe(0);
    });

    test("writing a 2MB chunk does not block the JS thread (setImmediate fires before the write settles)", async () => {
      const big = randomBytes(2 * 1024 * 1024);
      const cs = new CompressionStream("gzip");
      const writer = cs.writable.getWriter();
      const drained = cs.readable.pipeTo(new WritableStream({ write() {} }));

      const order: string[] = [];
      const writeP = writer.write(big).then(() => order.push("write"));
      await new Promise<void>(r =>
        setImmediate(() => {
          order.push("immediate");
          r();
        }),
      );
      await writeP;
      expect(order).toEqual(["immediate", "write"]);

      await writer.close();
      await drained;
    });

    // Async-codec × native-sink: deliverAsync's m_nativeSinkPtr arm. The other
    // >128KB tests drain via Response().arrayBuffer() (no native sink); the
    // other Bun.serve tests enqueue ≤64KB (below the async threshold).
    test("CompressionStream('gzip') -> native HTTP response sink handles a single >128KB chunk", async () => {
      const big = randomBytes(256 * 1024);
      await using server = Bun.serve({
        port: 0,
        fetch() {
          const body = new ReadableStream({
            start(c) {
              c.enqueue(big.slice());
              c.close();
            },
          });
          return new Response(body.pipeThrough(new CompressionStream("gzip")));
        },
      });
      const res = await fetch(server.url);
      const out = Buffer.from(await new Response(res.body!.pipeThrough(new DecompressionStream("gzip"))).arrayBuffer());
      expect(out.byteLength).toBe(big.byteLength);
      expect(Buffer.compare(out, Buffer.from(big.buffer))).toBe(0);
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
    // Per the TransformStream spec the transform step (and its chunk
    // validation) waits for the readable side to lift backpressure first.
    cs.readable
      .getReader()
      .read()
      .catch(() => {});
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

  // Native-sink output path: when cs.readable is consumed by a native JSSink
  // (here HTTPResponseSink via Bun.serve), the transform arms write coder output
  // straight to the sink's m_sinkPtr instead of wrapping each chunk in a
  // JSUint8Array and enqueueing it on the readable.
  test.each(["gzip", "brotli", "zstd", "deflate"] as const)(
    "CompressionStream(%s) -> native HTTP response sink round-trips",
    async format => {
      await using server = Bun.serve({
        port: 0,
        fetch() {
          const body = new ReadableStream({
            start(c) {
              for (let i = 0; i < 50; i++) c.enqueue(new Uint8Array(1024).fill(65 + (i % 26)));
              c.close();
            },
          });
          return new Response(body.pipeThrough(new CompressionStream(format)));
        },
      });
      const buf = new Uint8Array(await (await fetch(server.url)).arrayBuffer());
      const out = new Uint8Array(
        await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream(format))).arrayBuffer(),
      );
      expect(out.byteLength).toBe(51200);
      for (let i = 0; i < 50; i++) expect(out[i * 1024]).toBe(65 + (i % 26));
    },
  );

  // 64 KiB chunks. A paused pipe holds whatever the socket buffers plus a few userland buffers
  // absorb (Linux loopback autotunes to several MB per direction, so 100-250 chunks is normal);
  // 32 MiB is beyond any of that, so a source that gets this far was never paused.
  const RUNAWAY = 512;

  /**
   * A pull source of copies of `chunk` that keeps producing until `endAfter()` or RUNAWAY.
   * With `numbered`, each copy carries its 1-based pull number in its first 4 bytes, so a
   * consumer can check that it received every block in order.
   */
  function countingSource(chunk: Uint8Array, numbered = false) {
    let pulls = 0;
    let closeAt = RUNAWAY;
    const block = (n: number) => {
      const copy = Buffer.from(chunk);
      if (numbered) copy.writeUInt32BE(n, 0);
      return copy;
    };
    const stream = new ReadableStream({
      pull(c) {
        pulls++;
        c.enqueue(block(pulls));
        if (pulls >= closeAt) c.close();
      },
    });
    return {
      stream,
      block,
      get pulls() {
        return pulls;
      },
      /** Ends the stream `n` pulls from now; returns the pull count it will end at. */
      endAfter(n: number) {
        closeAt = Math.min(closeAt, pulls + n);
        return closeAt;
      },
    };
  }

  // Resolves once `source` has stopped pulling (no new pull across 50 consecutive 5 ms samples)
  // or ran away to RUNAWAY. Where it parks depends on the kernel, so callers only assert that it
  // parked below RUNAWAY, never at a specific count.
  async function waitUntilParked(source: { readonly pulls: number }) {
    let last = source.pulls;
    let stable = 0;
    while (stable < 50 && source.pulls < RUNAWAY) {
      await Bun.sleep(5);
      const now = source.pulls;
      if (now === last) stable++;
      else {
        stable = 0;
        last = now;
      }
    }
    return source.pulls;
  }

  // Native-sink backpressure: when the HTTP response sink's socket buffer fills
  // (slow client), the transform arm's writeBytes returns a pending promise and
  // the writable side parks on m_nativeSinkReadyPromise. Without that, a fast
  // source with a stalled client fills the sink buffer unboundedly.
  //
  // The stalled client is a raw socket paused before it sends the request, so
  // nothing reads until the stall is observed. The kernel then absorbs only the
  // server's send buffer plus the client's untouched receive buffer. A fetch()
  // client would not do: it reads ahead in bursts, and every read lets TCP
  // receive autotuning grow the window, up to tcp_rmem[2] (32 MiB since Linux
  // 6.16), which holds RUNAWAY chunks on its own.
  test("CompressionStream -> native HTTP sink applies backpressure to a stalled client", async () => {
    // Incompressible data so the gzipped output is ~as large as the input.
    const chunk = crypto.getRandomValues(new Uint8Array(64 * 1024));
    // Backpressure parks after ~tens of pulls (a few MB of socket+sink buffer /
    // 64KB); 200 is enough headroom to distinguish "parked" from "ran away"
    // without pushing ~32MB through gzip+HTTP under debug+ASAN.
    // OHOS network buffers are larger than Linux's, so the sink parks later
    // (200 x 64KB stalls never parked there); 4096 keeps the test meaningful
    // (~256MB through gzip under debug) while still bounding a runaway pull
    // loop.
    const TOTAL = 4096;
    let source!: ReturnType<typeof countingSource>;
    const { promise: requested, resolve: onRequest } = Promise.withResolvers<void>();
    await using server = Bun.serve({
      port: 0,
      fetch() {
        source = countingSource(chunk, true);
        onRequest();
        return new Response(source.stream.pipeThrough(new CompressionStream("gzip")));
      },
    });
    const received: Buffer[] = [];
    const { promise: closed, resolve: onClose } = Promise.withResolvers<void>();
    using socket = await Bun.connect({
      hostname: server.url.hostname,
      port: server.port,
      socket: {
        open(s) {
          s.pause();
          s.write("GET / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n");
        },
        data(_s, data) {
          received.push(data);
        },
        close() {
          onClose();
        },
      },
    });
    await requested;
    const pullsWhileStalled = await waitUntilParked(source);
    expect(pullsWhileStalled).toBeGreaterThan(0);
    expect(pullsWhileStalled).toBeLessThan(RUNAWAY);
    // Reading again must resume the parked pull loop and run it to the end.
    const closeAt = source.endAfter(8);
    socket.resume();
    await closed;
    expect(source.pulls).toBe(closeAt);

    // The stall and the resume must not lose or reorder output: de-chunk the
    // response and compare the gunzipped body with the numbered source blocks.
    const raw = Buffer.concat(received);
    const headEnd = raw.indexOf("\r\n\r\n");
    const head = raw.subarray(0, headEnd).toString();
    expect(head).toStartWith("HTTP/1.1 200");
    expect(head.toLowerCase()).toContain("transfer-encoding: chunked");
    const body: Buffer[] = [];
    for (let i = headEnd + 4; ; ) {
      const sizeEnd = raw.indexOf("\r\n", i);
      const size = parseInt(raw.subarray(i, sizeEnd).toString(), 16);
      if (sizeEnd < 0 || Number.isNaN(size)) throw new Error(`malformed chunk framing at offset ${i}`);
      if (size === 0) break;
      body.push(raw.subarray(sizeEnd + 2, sizeEnd + 2 + size));
      i = sizeEnd + 2 + size + 2;
    }
    const out = zlib.gunzipSync(Buffer.concat(body));
    expect(out.byteLength).toBe(closeAt * chunk.byteLength);
    for (let n = 1; n <= closeAt; n++) {
      const got = out.subarray((n - 1) * chunk.byteLength, n * chunk.byteLength);
      if (!got.equals(source.block(n))) {
        throw new Error(`block ${n} of ${closeAt} is block ${got.readUInt32BE(0)} of the source, or corrupt`);
      }
    }
  });

  test("request body -> DecompressionStream propagates backpressure to the client", async () => {
    const chunk = crypto.getRandomValues(new Uint8Array(64 * 1024));
    const compressed = new Uint8Array(
      await new Response(new Blob([chunk]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer(),
    );
    const source = countingSource(compressed);
    let clientPullsWhileServerStalled = -1;
    let closeAt = -1;
    await using server = Bun.serve({
      port: 0,
      async fetch(req) {
        const reader = req.body!.pipeThrough(new DecompressionStream("gzip")).getReader();
        await reader.read();
        // Stall: the client's pull loop either parks on backpressure or runs away.
        clientPullsWhileServerStalled = await waitUntilParked(source);
        closeAt = source.endAfter(8);
        while (!(await reader.read()).done) {}
        return new Response("ok");
      },
    });
    const res = await fetch(server.url, { method: "POST", body: source.stream, duplex: "half" } as RequestInit);
    expect(await res.text()).toBe("ok");
    expect(clientPullsWhileServerStalled).toBeGreaterThan(0);
    expect(clientPullsWhileServerStalled).toBeLessThan(RUNAWAY);
    expect(source.pulls).toBe(closeAt);
  });

  test("req.clone().textStream() -> TextEncoderStream -> CompressionStream -> Response round-trips", async () => {
    const input = Buffer.alloc(64 * 1024, "The quick brown fox. ").toString();
    await using server = Bun.serve({
      port: 0,
      fetch(req) {
        const cloned = req.clone();
        return new Response(
          cloned.textStream().pipeThrough(new TextEncoderStream()).pipeThrough(new CompressionStream("gzip")),
        );
      },
    });
    const res = await fetch(server.url, { method: "POST", body: input });
    const out = await new Response(res.body!.pipeThrough(new DecompressionStream("gzip"))).text();
    expect(out).toBe(input);
  });

  // readable highWaterMark is 1 (matching Node.js and Chromium), so a single
  // write completes before any reader is attached.
  test("a single write completes without a reader attached", async () => {
    const cs = new CompressionStream("gzip");
    const writer = cs.writable.getWriter();
    await writer.write(new Uint8Array(1024));
    void writer.close();
    const out = await Array.fromAsync(cs.readable);
    expect(out.length).toBeGreaterThan(0);
  });

  // Backpressure still kicks in once the readable queue is full.
  test("a second write stays pending until the readable side is drained", async () => {
    const cs = new CompressionStream("gzip");
    const writer = cs.writable.getWriter();
    const reader = cs.readable.getReader();

    await writer.write(new Uint8Array(1024));
    const second = writer.write(new Uint8Array(1024));
    const raced = await Promise.race([second.then(() => "done"), Bun.sleep(0).then(() => "pending")]);
    expect(raced).toBe("pending");

    const { value } = await reader.read();
    expect(value!.byteLength).toBeGreaterThan(0);
    await second;

    void writer.close();
    while (!(await reader.read()).done) {}
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

// One input chunk can expand enormously (a few hundred bytes of brotli or zstd
// decode to gigabytes), so the coder emits its output in steps of at most the
// stream's highWaterMark (64 KiB unless passed to the constructor), or the
// chunk's own size if that is larger, and waits between steps while the readable
// side (or the native sink) is full. A consumer that enforces a size limit in
// its read loop, or simply reads slowly, sees the expansion one piece at a time,
// and the write() that carried the chunk settles only once the whole expansion
// has been pulled.
describe("bounded output per input chunk", () => {
  const kDefaultHighWaterMark = 64 * 1024;
  const EXPANDED = 4 * 1024 * 1024;
  const expanded = Buffer.alloc(EXPANDED, 0x41);
  const bombs = {
    gzip: (plain: Buffer = expanded) => zlib.gzipSync(plain),
    deflate: (plain: Buffer = expanded) => zlib.deflateSync(plain),
    "deflate-raw": (plain: Buffer = expanded) => zlib.deflateRawSync(plain),
    brotli: (plain: Buffer = expanded) =>
      zlib.brotliCompressSync(plain, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5 } }),
    zstd: (plain: Buffer = expanded) => zlib.zstdCompressSync(plain),
  };
  const inflaters = {
    gzip: zlib.gunzipSync,
    deflate: zlib.inflateSync,
    "deflate-raw": zlib.inflateRawSync,
    brotli: zlib.brotliDecompressSync,
    zstd: zlib.zstdDecompressSync,
  };
  const formats = Object.keys(bombs) as (keyof typeof bombs)[];

  function randomBytes(len: number) {
    const out = Buffer.alloc(len);
    for (let off = 0; off < len; off += 65536) crypto.getRandomValues(out.subarray(off, Math.min(off + 65536, len)));
    return out;
  }

  function largest(pieces: Uint8Array[]) {
    return pieces.reduce((max, piece) => Math.max(max, piece.byteLength), 0);
  }

  // Reads until `length` bytes have arrived; every piece is returned so callers
  // can check how the expansion was split up.
  async function readExactly(reader: ReadableStreamDefaultReader<Uint8Array>, length: number) {
    const pieces: Uint8Array[] = [];
    let total = 0;
    while (total < length) {
      const { value, done } = await reader.read();
      expect(done).toBe(false);
      pieces.push(value!);
      total += value!.byteLength;
    }
    expect(total).toBe(length);
    return pieces;
  }

  test.each(formats)(
    "DecompressionStream(%s): one small chunk expands step by step as the reader pulls",
    async format => {
      const bomb = bombs[format]();
      // The whole expansion arrives in one write, well under the thread-pool threshold.
      expect(bomb.byteLength).toBeLessThan(kDefaultHighWaterMark);

      const ds = new DecompressionStream(format);
      const writer = ds.writable.getWriter();
      const reader = ds.readable.getReader();
      const write = writer.write(bomb);

      const first = await reader.read();
      expect(first.done).toBe(false);
      expect(first.value!.byteLength).toBeLessThanOrEqual(kDefaultHighWaterMark);
      // The readable holds one piece, so the coder is now parked with the rest of
      // the expansion still undecoded and the write that carried it still in flight.
      expect(await Promise.race([write.then(() => "settled"), Bun.sleep(0).then(() => "pending")])).toBe("pending");

      const rest = await readExactly(reader, EXPANDED - first.value!.byteLength);
      expect(largest(rest)).toBeLessThanOrEqual(kDefaultHighWaterMark);
      expect(Buffer.concat([first.value!, ...rest]).equals(expanded)).toBe(true);

      await write;
      await writer.close();
      expect(await reader.read()).toEqual({ value: undefined, done: true });
    },
  );

  test("cancelling the readable mid-expansion settles the in-flight write instead of hanging it", async () => {
    const ds = new DecompressionStream("brotli");
    const writer = ds.writable.getWriter();
    const reader = ds.readable.getReader();
    const write = writer.write(bombs.brotli());

    const first = await reader.read();
    expect(first.value!.byteLength).toBeLessThanOrEqual(kDefaultHighWaterMark);

    await reader.cancel(new Error("too large"));
    // The readable will never pull again; the parked chunk is abandoned rather
    // than left pending forever (which would also hang the erroring writable).
    expect(await write).toBeUndefined();
    await expect(writer.closed).rejects.toThrow("too large");
  });

  // The producer giving up is the other way a pending chunk can end: the abort
  // has to wait for the in-flight write, so the chunk is given up when the
  // writable starts erroring, even though nobody is reading.
  test("writer.abort() mid-expansion settles and errors the readable", async () => {
    const ds = new DecompressionStream("brotli");
    const writer = ds.writable.getWriter();
    const reader = ds.readable.getReader();
    const write = writer.write(bombs.brotli());

    const first = await reader.read();
    expect(first.value!.byteLength).toBeLessThanOrEqual(kDefaultHighWaterMark);

    await writer.abort(new Error("stop"));
    expect(await write).toBeUndefined();
    await expect(writer.closed).rejects.toThrow("stop");
    // The abort algorithm errored the readable (dropping the piece it still held).
    await expect(reader.read()).rejects.toThrow("stop");
  });

  // node:stream's addAbortSignal() errors the writable through its controller, the
  // other route into the erroring state (it clears the sink's algorithms on the way).
  test("addAbortSignal() on the writable mid-expansion settles the write", async () => {
    const ds = new DecompressionStream("brotli");
    const writer = ds.writable.getWriter();
    const reader = ds.readable.getReader();
    const write = writer.write(bombs.brotli());

    const first = await reader.read();
    expect(first.value!.byteLength).toBeLessThanOrEqual(kDefaultHighWaterMark);

    const controller = new AbortController();
    addAbortSignal(controller.signal, ds.writable);
    controller.abort();
    expect(await write).toBeUndefined();
    await expect(writer.closed).rejects.toMatchObject({ name: "AbortError" });
  });

  // An abort during close() is different: the close in progress wins, so a flush
  // being drained keeps going and the reader still gets all of it.
  test("writer.abort() during a multi-step flush does not truncate it", async () => {
    const input = randomBytes(100 * 1024);
    const cs = new CompressionStream("zstd");
    const writer = cs.writable.getWriter();
    const reader = cs.readable.getReader();
    await writer.write(input);
    const closed = writer.close();

    const first = await reader.read();
    expect(first.value!.byteLength).toBe(kDefaultHighWaterMark);
    const aborted = writer.abort(new Error("stop"));

    const pieces = [first.value!];
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      pieces.push(value);
    }
    expect(zlib.zstdDecompressSync(Buffer.concat(pieces)).equals(input)).toBe(true);
    expect(await Promise.all([closed, aborted])).toEqual([undefined, undefined]);
  });

  test("a request body bomb trips a streaming size guard after one step, not after the whole expansion", async () => {
    const limit = 256 * 1024;
    await using server = Bun.serve({
      port: 0,
      async fetch(req) {
        const reader = req.body!.pipeThrough(new DecompressionStream("brotli")).getReader();
        let total = 0;
        let largestPiece = 0;
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          total += value.byteLength;
          largestPiece = Math.max(largestPiece, value.byteLength);
          if (total > limit) {
            await reader.cancel();
            break;
          }
        }
        return Response.json({ total, largestPiece }, { status: total > limit ? 413 : 200 });
      },
    });

    const res = await fetch(server.url, { method: "POST", body: bombs.brotli() });
    expect(res.status).toBe(413);
    const { total, largestPiece } = (await res.json()) as { total: number; largestPiece: number };
    expect(largestPiece).toBeLessThanOrEqual(kDefaultHighWaterMark);
    // The guard fires on the step that crosses the limit; nothing beyond it was decoded.
    expect(total).toBeLessThanOrEqual(limit + kDefaultHighWaterMark);
  });

  test("DecompressionStream -> native HTTP response sink delivers a large expansion in steps", async () => {
    const plain = Buffer.alloc(16 * 1024 * 1024, 0x5a);
    const bomb = bombs.zstd(plain);
    await using server = Bun.serve({
      port: 0,
      fetch() {
        return new Response(new Blob([bomb]).stream().pipeThrough(new DecompressionStream("zstd")));
      },
    });

    // The server pushes into the socket until the sink reports backpressure and
    // parks mid-chunk; draining the body then resumes it step by step.
    const res = await fetch(server.url);
    const body = Buffer.from(await res.arrayBuffer());
    expect(body.byteLength).toBe(plain.byteLength);
    expect(body.equals(plain)).toBe(true);
  });

  test("a >128 KiB compressed chunk (thread-pool path) is also delivered in bounded steps", async () => {
    // Incompressible prefix to push the compressed chunk over the thread-pool
    // threshold, followed by a highly compressible expansion. A chunk bigger than
    // the high water mark may produce up to its own size per step.
    const plain = Buffer.concat([randomBytes(160 * 1024), expanded]);
    const compressed = zlib.gzipSync(plain);
    expect(compressed.byteLength).toBeGreaterThan(128 * 1024);

    const ds = new DecompressionStream("gzip");
    const writer = ds.writable.getWriter();
    const reader = ds.readable.getReader();
    const write = writer.write(compressed);

    const pieces = await readExactly(reader, plain.byteLength);
    expect(pieces.length).toBeGreaterThanOrEqual(2);
    expect(largest(pieces)).toBeLessThanOrEqual(compressed.byteLength);
    expect(Buffer.concat(pieces).equals(plain)).toBe(true);

    await write;
    await writer.close();
    expect(await reader.read()).toEqual({ value: undefined, done: true });
  });

  test("a >128 KiB chunk that is not valid input errors both sides through the thread-pool path", async () => {
    const ds = new DecompressionStream("gzip");
    const writer = ds.writable.getWriter();
    const readAll = new Response(ds.readable).arrayBuffer().then(
      () => null,
      e => e,
    );
    const write = writer.write(randomBytes(200 * 1024)).then(
      () => null,
      e => e,
    );
    const [readError, writeError] = await Promise.all([readAll, write]);
    expect(readError).toBeInstanceOf(TypeError);
    expect(writeError).toBe(readError);
  });

  test.each([16 * 1024, 1024 * 1024])(
    "the constructor's highWaterMark (%i) sets the step size",
    async highWaterMark => {
      const ds = new DecompressionStream("brotli", { highWaterMark });
      const writer = ds.writable.getWriter();
      const reader = ds.readable.getReader();
      const write = writer.write(bombs.brotli());

      const pieces = await readExactly(reader, EXPANDED);
      expect(largest(pieces)).toBe(highWaterMark);
      expect(Buffer.concat(pieces).equals(expanded)).toBe(true);

      await write;
      await writer.close();
    },
  );

  test("highWaterMark: Infinity turns the splitting off", async () => {
    const ds = new DecompressionStream("zstd", { highWaterMark: Infinity });
    const writer = ds.writable.getWriter();
    const reader = ds.readable.getReader();
    const write = writer.write(bombs.zstd());

    const first = await reader.read();
    expect(first.value!.byteLength).toBe(EXPANDED);
    await write;
    await writer.close();
  });

  test("CompressionStream takes the same option", async () => {
    // zstd holds these back and emits them all from the flush, whose input is
    // empty, so the high water mark alone bounds the pieces (64 KiB by default).
    const highWaterMark = 8 * 1024;
    const chunks = Array.from({ length: 8 }, () => randomBytes(highWaterMark));
    const cs = new CompressionStream("zstd", { highWaterMark });
    const writer = cs.writable.getWriter();
    const written = (async () => {
      for (const chunk of chunks) await writer.write(chunk);
      await writer.close();
    })();

    const pieces = await Array.fromAsync(cs.readable);
    await written;
    expect(largest(pieces)).toBeLessThanOrEqual(highWaterMark);
    expect(pieces.length).toBeGreaterThanOrEqual(8);
    expect(zlib.zstdDecompressSync(Buffer.concat(pieces)).equals(Buffer.concat(chunks))).toBe(true);
  });

  test("the second argument is validated like a queuing strategy", () => {
    expect(() => new DecompressionStream("gzip", { highWaterMark: -1 })).toThrow(RangeError);
    expect(() => new CompressionStream("gzip", { highWaterMark: NaN })).toThrow(RangeError);
    expect(() => new DecompressionStream("gzip", 4096 as any)).toThrow(TypeError);
    expect(new DecompressionStream("gzip", {})).toBeInstanceOf(DecompressionStream);
    expect(new DecompressionStream("gzip", undefined)).toBeInstanceOf(DecompressionStream);
  });

  // A client that goes away mid-expansion closes the response sink under the
  // transform. The chunk being drained into it has to be given up so the
  // transform's writable can finish erroring, which is what lets pipeThrough
  // cancel the source; otherwise the source is never told and the handler's
  // pipeline stays pending forever.
  test("a client disconnecting mid-expansion propagates back to the source of the pipeline", async () => {
    const sourceCancelled = Promise.withResolvers<unknown>();
    await using server = Bun.serve({
      port: 0,
      fetch() {
        const source = new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(bombs.brotli()));
          },
          cancel(reason) {
            sourceCancelled.resolve(reason);
          },
        });
        return new Response(source.pipeThrough(new DecompressionStream("brotli")));
      },
    });

    const res = await fetch(server.url);
    const reader = res.body!.getReader();
    expect((await reader.read()).done).toBe(false);
    await reader.cancel();
    await sourceCancelled.promise;
  });

  // The encoders are stepped the same way. Incompressible input comes out
  // slightly larger than it went in, so highWaterMark-sized chunks overflow a
  // step by a few bytes; brotli and zstd hold everything back until the flush,
  // which then spans several steps.
  test.each(formats)("CompressionStream(%s): output larger than one step is emitted in pieces", async format => {
    const chunks = [
      randomBytes(kDefaultHighWaterMark),
      randomBytes(kDefaultHighWaterMark),
      randomBytes(kDefaultHighWaterMark),
    ];
    const cs = new CompressionStream(format);
    const writer = cs.writable.getWriter();
    const written = (async () => {
      for (const chunk of chunks) await writer.write(chunk);
      await writer.close();
    })();

    const pieces = await Array.fromAsync(cs.readable);
    await written;
    expect(largest(pieces)).toBeLessThanOrEqual(kDefaultHighWaterMark);
    expect(inflaters[format](Buffer.concat(pieces)).equals(Buffer.concat(chunks))).toBe(true);
  });

  // The close algorithm clears the transform's algorithms (which normally frees
  // the coder) as soon as the flush arm returns, while a flush this large is
  // still parked part-way through. The coder has to survive until the flush has
  // actually been drained, here into the native response sink.
  test.each(["zstd", "brotli"] as const)(
    "CompressionStream(%s) -> native HTTP response sink: a flush spanning several steps is delivered in full",
    async format => {
      const input = randomBytes(200 * 1024);
      await using server = Bun.serve({
        port: 0,
        fetch() {
          return new Response(new Blob([input]).stream().pipeThrough(new CompressionStream(format)));
        },
      });

      const body = Buffer.from(await (await fetch(server.url)).arrayBuffer());
      expect(inflaters[format](body).equals(input)).toBe(true);
    },
  );

  // reader.cancel() after writer.close() is the one terminal that does not go
  // through the transform's cancel reaction (the close already owns the finish
  // promise, so the source cancel algorithm just returns it), and the cancelled
  // readable will never pull again. A flush parked between steps at that point
  // still has to be woken up, or close() and cancel() both stay pending forever.
  // Both encoders hold incompressible input back until the flush: zstd's ~100 KiB
  // flush takes two steps (parked after the first, cancelled with no read in
  // between), and brotli's ~200 KiB one takes four (the second read is served by
  // the resumed flush, which then parks again before the cancel lands).
  test.each([
    { format: "zstd", writes: [100 * 1024], readsBeforeCancel: 0 },
    { format: "brotli", writes: [100 * 1024, 100 * 1024], readsBeforeCancel: 2 },
  ] as const)(
    "reader.cancel() after writer.close() settles both while a $format flush is parked (reads first: $readsBeforeCancel)",
    async ({ format, writes, readsBeforeCancel }) => {
      const cs = new CompressionStream(format);
      const writer = cs.writable.getWriter();
      const reader = cs.readable.getReader();
      for (const size of writes) await writer.write(randomBytes(size));
      const closed = writer.close();

      for (let i = 0; i < readsBeforeCancel; i++) {
        const { value, done } = await reader.read();
        expect(done).toBe(false);
        expect(value!.byteLength).toBeLessThanOrEqual(kDefaultHighWaterMark);
      }
      const cancelled = reader.cancel();
      // close() and cancel() share the transform's finish promise; the abandoned
      // flush resolves it rather than leaving both pending forever.
      expect(await Promise.all([closed, cancelled])).toEqual([undefined, undefined]);
    },
  );
});

// The native coder (a gzip deflate context is ~280 KiB of zlib state) must be
// released eagerly at the transform's terminal (ClearAlgorithms: post-flush,
// error, cancel), not left to the cell's finalizer. Finalizers run late, so a
// busy loop of pipelines whose SOURCE errors otherwise retains every context:
// Bun.gc(true) cannot reclaim them and RSS grows by ~280 KiB per iteration.
// The 60s timeout covers the debug/ASAN child: 512 pipelines plus a full GC
// per RSS sample outlive the default per-test timeout there.
test("errored pipeline releases the compression coder eagerly", async () => {
  const src = `
      const N = 512, WARM = 64;
      const rss = () => { Bun.gc(true); return process.memoryUsage().rss; };
      async function run() {
        let n = 0;
        const source = new ReadableStream({
          pull(c) {
            n++;
            if (n > 5) throw new Error("source failed");
            c.enqueue(new Uint8Array(8192).fill(n));
          },
        });
        try {
          await new Response(source.pipeThrough(new CompressionStream("gzip"))).arrayBuffer();
        } catch (error) {
          if (error instanceof Error && error.message === "source failed") return;
          throw error;
        }
        throw new Error("expected the pipeline to reject with the source error");
      }
      for (let i = 0; i < WARM; i++) await run();
      const before = rss();
      for (let i = WARM; i < N; i++) await run();
      console.log(JSON.stringify({ deltaMiB: (rss() - before) / 1048576 }));
    `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", src],
    env: {
      ...bunEnv,
      // Under ASAN the freed contexts land in the allocator quarantine
      // (default quarantine_size_mb=256) instead of being returned, so the
      // RSS delta over-reports by far more than the retention this guards
      // against even when nothing leaks.
      ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "quarantine_size_mb=0"].filter(Boolean).join(":"),
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  const { deltaMiB } = JSON.parse(stdout.trim());
  // 448 retained gzip contexts measure ~130 MiB (bun 1.3.14, whose
  // node:zlib-backed implementation freed them only via finalizer); eager
  // release measures 7 MiB release / 8 MiB debug+ASAN.
  expect(deltaMiB).toBeLessThan(64);
  expect(exitCode).toBe(0);
}, 60_000);

// Chunks > 128 KiB run the codec on a WorkPool thread. VM teardown
// (Heap::lastChanceToFinalize) runs the cell's CFinalizer even while that
// transform is mid-flight — it must release the cell's reference, not free
// the coder under the pool thread (heap-use-after-free in the brotli encoder,
// caught by ASAN). BUN_DESTRUCT_VM_ON_EXIT=1 (which CI's test runner sets)
// makes process.exit() take that teardown path on the main thread. ASAN-only:
// without ASAN the stray write into freed pages is not reliably observable.
// The 30s timeout covers the debug/ASAN child's startup plus teardown.
test.skipIf(!isASAN)(
  "process.exit during an in-flight off-thread transform does not free the coder under the pool thread",
  async () => {
    const src = `
      const s = new CompressionStream("brotli");
      const w = s.writable.getWriter();
      const big = new Uint8Array(6 << 20);
      for (let i = 0; i < big.length; i += 3) big[i] = (i * 2654435761) >>> 24;
      w.write(big).catch(() => {});
      w.close().catch(() => {});
      s.readable.getReader().read().catch(() => {});
      // One macrotask turn so the write's transform step has dispatched to the
      // pool; the 6 MiB brotli step runs for seconds, so exit lands mid-flight.
      setTimeout(() => {
        console.log("exiting");
        process.exit(0);
      }, 15);
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", src],
      env: {
        ...bunEnv,
        BUN_DESTRUCT_VM_ON_EXIT: "1",
        // Exiting mid-transform deliberately abandons the in-flight task (and
        // the coder reference it holds); LSAN would report that bounded leak.
        ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "detect_leaks=0"].filter(Boolean).join(":"),
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).not.toContain("AddressSanitizer");
    expect(stdout).toContain("exiting");
    expect(exitCode).toBe(0);
  },
  30_000,
);
