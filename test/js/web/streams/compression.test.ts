import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN } from "harness";
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

  // Poll `get()` once per tick until it stays unchanged for 5 consecutive
  // samples (parked on backpressure) or reaches `total` (ran away). The caller
  // asserts the parked value is < total.
  async function waitUntilStable(get: () => number, total: number) {
    let last = get();
    let stable = 0;
    while (stable < 5 && get() < total) {
      await Bun.sleep(1);
      const now = get();
      if (now === last) stable++;
      else {
        stable = 0;
        last = now;
      }
    }
  }

  // Native-sink backpressure: when the HTTP response sink's socket buffer fills
  // (slow client), the transform arm's writeBytes returns a pending promise and
  // the writable side parks on m_nativeSinkReadyPromise. Without that, a fast
  // source with a stalled client fills the sink buffer unboundedly.
  test("CompressionStream -> native HTTP sink applies backpressure to a stalled client", async () => {
    let pulls = 0;
    // Incompressible data so the gzipped output is ~as large as the input.
    const chunk = crypto.getRandomValues(new Uint8Array(64 * 1024));
    // Backpressure parks after ~tens of pulls (a few MB of socket+sink buffer /
    // 64KB); 200 is enough headroom to distinguish "parked" from "ran away"
    // without pushing ~32MB through gzip+HTTP under debug+ASAN.
    const TOTAL = 200;
    await using server = Bun.serve({
      port: 0,
      fetch() {
        const body = new ReadableStream({
          pull(c) {
            pulls++;
            c.enqueue(chunk.slice());
            if (pulls >= TOTAL) c.close();
          },
        });
        return new Response(body.pipeThrough(new CompressionStream("gzip")));
      },
    });
    const res = await fetch(server.url);
    const reader = res.body!.getReader();
    await reader.read();
    // Let the server's pull loop run until it either parks on backpressure or
    // runs away to TOTAL.
    await waitUntilStable(() => pulls, TOTAL);
    const pullsWhileStalled = pulls;
    while (!(await reader.read()).done) {}
    // Without backpressure the pull loop reaches TOTAL while the client is
    // stalled; with it, pulls stay bounded by the socket + sink buffer
    // (~a few MB / 64KB ≈ tens of pulls).
    expect(pullsWhileStalled).toBeLessThan(TOTAL);
    expect(pulls).toBe(TOTAL);
  });

  test("request body -> DecompressionStream propagates backpressure to the client", async () => {
    let clientPulls = 0;
    let clientPullsWhileServerStalled = -1;
    const chunk = crypto.getRandomValues(new Uint8Array(64 * 1024));
    const compressed = new Uint8Array(
      await new Response(new Blob([chunk]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer(),
    );
    const TOTAL = 200;
    const { promise: drain, resolve: startDrain } = Promise.withResolvers<void>();
    await using server = Bun.serve({
      port: 0,
      async fetch(req) {
        const reader = req.body!.pipeThrough(new DecompressionStream("gzip")).getReader();
        await reader.read();
        // Stall: let the client's pull loop either park or run away.
        await waitUntilStable(() => clientPulls, TOTAL);
        clientPullsWhileServerStalled = clientPulls;
        startDrain();
        while (!(await reader.read()).done) {}
        return new Response("ok");
      },
    });
    const body = new ReadableStream({
      pull(c) {
        clientPulls++;
        c.enqueue(compressed.slice());
        if (clientPulls >= TOTAL) c.close();
      },
    });
    const res = await fetch(server.url, { method: "POST", body, duplex: "half" } as RequestInit);
    await drain;
    expect(await res.text()).toBe("ok");
    expect(clientPullsWhileServerStalled).toBeGreaterThan(0);
    expect(clientPullsWhileServerStalled).toBeLessThan(TOTAL);
    expect(clientPulls).toBe(TOTAL);
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
