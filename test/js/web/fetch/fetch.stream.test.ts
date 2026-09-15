import type { Socket } from "bun";
import { describe, expect, it, test } from "bun:test";
import { randomFillSync } from "crypto";
import { createReadStream, readFileSync } from "fs";
import { bunEnv, bunExe, gcTick, isWindows, tempDirWithFilesAnon } from "harness";
import http from "http";
import type { AddressInfo } from "net";
import path, { basename, join } from "path";
import { pipeline } from "stream";
import zlib from "zlib";

const files = [
  join(import.meta.dir, "fixture.html"),
  join(import.meta.dir, "fixture.png"),
  join(import.meta.dir, "fixture.png.gz"),
];

const fixtures = {
  "fixture": readFileSync(join(import.meta.dir, "fixture.html")),
  "fixture.png": readFileSync(join(import.meta.dir, "fixture.png")),
  "fixture.png.gz": readFileSync(join(import.meta.dir, "fixture.png.gz")),
};

const invalid = Buffer.from([0xc0]);

const bigText = Buffer.alloc(1 * 1024 * 1024, "a");
const smallText = Buffer.alloc(16 * "Hello".length, "Hello");
const empty = Buffer.alloc(0);

/** Splits `data` into `count` pieces of the same size. The last piece takes the remainder. */
function split(data: Uint8Array, count: number): Uint8Array[] {
  const size = Math.floor(data.byteLength / count);
  return Array.from({ length: count }, (_, i) =>
    data.subarray(size * i, i === count - 1 ? data.byteLength : size * (i + 1)),
  );
}

/** Reads `reader` to the end and returns its chunks. `afterChunk` runs after each chunk. */
async function readChunks<T>(
  reader: ReadableStreamDefaultReader<T>,
  afterChunk?: (chunk: T) => void | Promise<void>,
): Promise<T[]> {
  const chunks: T[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) return chunks;
    chunks.push(value);
    await afterChunk?.(value);
  }
}

/** Awaits `promise`, which has to reject, and returns the reason. */
function rejection(promise: Promise<unknown>): Promise<any> {
  return promise.then(
    () => expect.unreachable("the promise resolved"),
    error => error,
  );
}

/**
 * One response body streamed as separate chunks, with no fixed sleeps between them.
 *
 * By default the reader paces the server: the handler writes piece i, flushes it, and
 * waits until the reader has acknowledged every byte through the end of piece i before
 * it writes piece i+1. Each piece therefore crosses the wire on its own, and a small
 * piece arrives as exactly one read.
 *
 * `readerPaced: false` is for bodies the reader cannot acknowledge piece by piece: a
 * compressed body (the reader only sees decoded bytes) or one consumed with `text()`.
 * The handler then yields 1 ms between pieces. In practice that lets the idle HTTP
 * thread pick each piece up on its own, but no assertion depends on that split.
 *
 * Use one instance per response.
 */
class StreamedBody {
  readonly pieces: Uint8Array[];
  readonly readerPaced: boolean;
  #received = 0;
  #waiting: { bytes: number; resolve: () => void }[] = [];

  constructor(pieces: Uint8Array[], { readerPaced = true }: { readerPaced?: boolean } = {}) {
    this.pieces = pieces;
    this.readerPaced = readerPaced;
  }

  /** Every byte of the body, in order. */
  get content(): Buffer {
    return Buffer.concat(this.pieces);
  }

  /** A 200 response that streams the pieces. */
  response(headers: Record<string, string> = {}): Response {
    const stream = new ReadableStream({
      type: "direct",
      pull: async controller => {
        let sent = 0;
        for (const [i, piece] of this.pieces.entries()) {
          controller.write(piece);
          await controller.flush();
          sent += piece.byteLength;
          // No wait after the last piece, so it and the terminating chunk go out together.
          if (i < this.pieces.length - 1) await (this.readerPaced ? this.#acknowledged(sent) : Bun.sleep(1));
        }
        controller.close();
      },
    });
    return new Response(stream, { status: 200, headers: { "Content-Type": "text/plain", ...headers } });
  }

  /** The reader reports that `count` more bytes arrived. */
  ack(count: number): void {
    this.#received += count;
    this.#waiting = this.#waiting.filter(({ bytes, resolve }) => {
      if (bytes > this.#received) return true;
      resolve();
      return false;
    });
  }

  /**
   * Reads `reader` to the end and acknowledges each chunk. With `gc`, a full collection
   * runs after the first chunk, while the rest of the body is still in flight.
   */
  read(reader: ReadableStreamDefaultReader<Uint8Array>, { gc = false } = {}): Promise<Uint8Array[]> {
    let first = true;
    return readChunks(reader, async chunk => {
      if (gc && first) await gcTick();
      first = false;
      this.ack(chunk.byteLength);
    });
  }

  #acknowledged(bytes: number): Promise<void> {
    if (this.#received >= bytes) return Promise.resolve();
    return new Promise(resolve => this.#waiting.push({ bytes, resolve }));
  }
}

/** The head of a 200 text/plain response with `headers`, ready to be written before the body. */
function responseHead(headers: Record<string, string | number>): string {
  const lines = ["HTTP/1.1 200 OK", "Content-Type: text/plain"];
  for (const [name, value] of Object.entries(headers)) lines.push(`${name}: ${value}`);
  return lines.join("\r\n") + "\r\n\r\n";
}

/**
 * A raw TCP server that answers every connection with `head` and then `pieces`, each in
 * its own write, without reading the request. `onHead` runs once the head is written.
 */
function rawServer(head: string, pieces: (string | Uint8Array)[], onHead?: (socket: Socket) => void) {
  return Bun.listen({
    hostname: "127.0.0.1",
    port: 0,
    socket: {
      open(socket) {
        socket.write(head);
        onHead?.(socket);
        for (const piece of pieces) socket.write(piece);
        socket.flush();
      },
      data() {},
    },
  });
}

describe.concurrent("fetch() with streaming", () => {
  for (const timeout of [-1, 0, 20, 50, 100]) {
    it(`should be able to fail properly when reading from readable stream with timeout ${timeout}`, async () => {
      // The handler sends one chunk and then holds the stream open until the test ends,
      // so only the signal can settle the read.
      const { promise: hold, resolve: release } = Promise.withResolvers<void>();
      using server = Bun.serve({
        port: 0,
        fetch() {
          return new Response(
            new ReadableStream({
              async start(controller) {
                controller.enqueue("Hello, World!");
                await hold;
                controller.close();
              },
            }),
            { status: 200, headers: { "Content-Type": "text/plain" } },
          );
        },
      });
      try {
        const signal = timeout < 0 ? AbortSignal.abort() : AbortSignal.timeout(timeout);
        const error = await rejection(
          (async () => {
            const res = await fetch(server.url, { signal });
            return readChunks(res.body!.getReader());
          })(),
        );
        expect(error).toBeInstanceOf(DOMException);
        expect({ name: error.name, message: error.message, code: error.code }).toEqual(
          timeout < 0
            ? { name: "AbortError", message: "The operation was aborted.", code: 20 }
            : { name: "TimeoutError", message: "The operation timed out.", code: 23 },
        );
      } finally {
        release();
      }
    });
  }

  // The handler sends one chunk, then waits for `gate` before it sends the rest, so the
  // body is still streaming while the test checks the lock.
  function gatedResponse(gate: Promise<void>): Response {
    return new Response(
      new ReadableStream({
        type: "direct",
        async pull(controller) {
          controller.write("Hello, World!");
          await controller.flush();
          await gate;
          for (let i = 0; i < 3; i++) {
            controller.write("Hello, World!");
            await controller.flush();
          }
          controller.close();
        },
      }),
      { status: 200, headers: { "Content-Type": "text/plain" } },
    );
  }

  it("should be locked after start buffering", async () => {
    const { promise: gate, resolve: openGate } = Promise.withResolvers<void>();
    using server = Bun.serve({ port: 0, fetch: () => gatedResponse(gate) });
    const res = await fetch(server.url);
    const text = res.text();
    expect(() => res.body!.getReader()).toThrow("ReadableStream is locked");
    expect(res.bodyUsed).toBe(true);
    openGate();
    expect(await text).toBe("Hello, World!".repeat(4));
  });

  it("should be locked after start buffering when calling getReader", async () => {
    const { promise: gate, resolve: openGate } = Promise.withResolvers<void>();
    using server = Bun.serve({ port: 0, fetch: () => gatedResponse(gate) });
    const res = await fetch(server.url);
    const body = res.body!;
    const text = res.text();
    expect(body.locked).toBe(true);
    expect(() => body.getReader()).toThrow("ReadableStream is locked");
    openGate();
    expect(await text).toBe("Hello, World!".repeat(4));
  });

  it("throws a TypeError when the request body stream is already locked", async () => {
    using server = Bun.serve({
      port: 0,
      async fetch(req) {
        return new Response(await req.text());
      },
    });

    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("payload"));
        controller.close();
      },
    });
    // A locked (or disturbed) body init is rejected at Request construction with a
    // TypeError (fetch spec; Node agrees on the error), surfaced as a rejected promise.
    stream.getReader();

    await expect(fetch(server.url, { method: "POST", body: stream })).rejects.toThrow(
      expect.objectContaining({ name: "TypeError", message: "Body object should not be disturbed or locked" }),
    );
  });

  it("can deflate with and without headers #4478", async () => {
    using server = Bun.serve({
      port: 0,
      fetch(req) {
        const content = req.url.endsWith("/with_headers")
          ? zlib.deflateSync(Buffer.from("Hello, World"))
          : zlib.deflateRawSync(Buffer.from("Hello, World"));
        return new Response(content, {
          headers: {
            "Content-Type": "text/plain",
            "Content-Encoding": "deflate",
            "Access-Control-Allow-Origin": "*",
          },
        });
      },
    });
    for (const pathname of ["/with_headers", "/"]) {
      const res = await fetch(new URL(pathname, server.url));
      expect(res.status).toBe(200);
      expect(res.headers.get("content-encoding")).toBe("deflate");
      expect(await res.text()).toBe("Hello, World");
    }
  });

  for (const file of files) {
    it(`stream can handle response.body + await response.something() #4500 (${basename(file)})`, async () => {
      const expected = readFileSync(file);
      const errors: unknown[] = [];
      const server = http.createServer((req, res) => {
        res.writeHead(200, { "Content-Type": "text/plain" });
        pipeline(createReadStream(file), res, error => {
          if (error) errors.push(error);
        });
      });
      try {
        const { promise: listening, resolve: onListening } = Promise.withResolvers<void>();
        server.listen(0, "127.0.0.1", onListening);
        await listening;
        const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
        for (let i = 0; i < 10; i++) {
          const response = await fetch(url);
          expect(response.status).toBe(200);
          expect(response.headers.get("content-type")).toBe("text/plain");
          expect(response.body).toBeInstanceOf(ReadableStream);
          const blob = await response.blob();
          expect(blob.size).toBe(expected.byteLength);
          expect(Buffer.from(await blob.arrayBuffer())).toEqual(expected);
        }
        expect(errors).toEqual([]);
      } finally {
        server.closeAllConnections();
        server.close();
      }
    });
  }

  it("stream still works after response get out of scope", async () => {
    const body = new StreamedBody(split(Buffer.from("Hello, world!\n".repeat(5)), 4));
    using server = Bun.serve({ port: 0, fetch: () => body.response() });

    // Only the reader survives this call. The Response it came from is unreachable.
    async function getReader() {
      return (await fetch(server.url)).body!.getReader();
    }
    await gcTick();
    const reader = await getReader();
    await gcTick();
    // A collection before every read: the reader alone has to keep the stream alive.
    const chunks = await readChunks(reader, async chunk => {
      await gcTick();
      body.ack(chunk.byteLength);
    });
    await gcTick();
    expect(chunks.map(chunk => Buffer.from(chunk).toString())).toEqual(
      body.pieces.map(piece => Buffer.from(piece).toString()),
    );
    expect(Buffer.concat(chunks)).toEqual(body.content);
  });

  it("response inspected size should reflect stream state", async () => {
    const body = new StreamedBody(split(Buffer.from("Bun!\n".repeat(4)), 4));
    using server = Bun.serve({ port: 0, fetch: () => body.response() });

    function inspectBytes(response: Response) {
      const match = /Response \(([0-9]+) bytes\)/.exec(Bun.inspect(response, { depth: 0 }));
      return match ? parseInt(match[1], 10) : null;
    }

    const res = await fetch(server.url);
    await gcTick();
    const reader = res.body!.getReader();
    const sizes: (number | null)[] = [];
    const chunks = await readChunks(reader, async chunk => {
      sizes.push(inspectBytes(res));
      if (sizes.length === 1) await gcTick();
      body.ack(chunk.byteLength);
    });
    expect(chunks.map(chunk => chunk.byteLength)).toEqual([5, 5, 5, 5]);
    expect(sizes).toEqual([5, 10, 15, 20]);
    expect(inspectBytes(res)).toBe(20);
  });

  it("can handle multiple simultaneous requests", async () => {
    const content = Buffer.from("Hello, world!\n".repeat(5));
    // One paced body per request, picked by the request path.
    const bodies = Array.from({ length: 6 }, () => new StreamedBody(split(content, 4)));
    using server = Bun.serve({
      port: 0,
      fetch: req => bodies[Number(new URL(req.url).pathname.slice(1))].response(),
    });

    async function doRequest(i: number) {
      const res = await fetch(new URL(String(i), server.url));
      const chunks = await bodies[i].read(res.body!.getReader());
      expect(chunks.length).toBe(4);
      expect(Buffer.concat(chunks)).toEqual(content);
    }

    await Promise.all(bodies.map((_, i) => doRequest(i)));
  });

  it("can handle transforms", async () => {
    const content = "Hello, world!\n".repeat(5);
    const body = new StreamedBody(split(Buffer.from(content), 4));
    using server = Bun.serve({ port: 0, fetch: () => body.response() });

    const res = await fetch(server.url);
    const transform = new TransformStream<Uint8Array, string>({
      transform(chunk, controller) {
        controller.enqueue(Buffer.from(chunk).toString("utf8").toUpperCase());
      },
    });
    const reader = res.body!.pipeThrough(transform).getReader();
    // Every byte maps to one character, so the length of a string chunk is its byte count.
    const chunks = await readChunks(reader, chunk => body.ack(chunk.length));
    expect(chunks).toEqual(body.pieces.map(piece => Buffer.from(piece).toString().toUpperCase()));
    expect(chunks.join("")).toBe(content.toUpperCase());
  });

  it("can handle gz images", async () => {
    using server = Bun.serve({
      port: 0,
      fetch() {
        return new Response(fixtures["fixture.png.gz"], {
          status: 200,
          headers: {
            "Content-Type": "text/plain",
            "Content-Encoding": "gzip",
          },
        });
      },
    });

    const res = await fetch(server.url);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-encoding")).toBe("gzip");
    const chunks = await readChunks(res.body!.getReader());
    expect(Buffer.concat(chunks)).toEqual(fixtures["fixture.png"]);
  });

  it("can proxy fetch with Bun.serve", async () => {
    const content = Buffer.alloc(64 * 1024, "a");
    const body = new StreamedBody(split(content, 5));
    using origin = Bun.serve({ port: 0, fetch: () => body.response() });
    using proxy = Bun.serve({
      port: 0,
      async fetch() {
        const response = await fetch(origin.url);
        return new Response(response.body, {
          status: 200,
          headers: { "Content-Type": "text/plain" },
        });
      },
    });

    const res = await fetch(proxy.url);
    await gcTick();
    const reader = res.body!.getReader();
    // The acks travel through the proxy: the origin writes piece i+1 only after this
    // reader has all of piece i, so the body arrives in at least one read per piece.
    const chunks = await body.read(reader, { gc: true });
    expect(res.status).toBe(200);
    expect(chunks.length).toBeGreaterThanOrEqual(body.pieces.length);
    expect(Buffer.concat(chunks)).toEqual(content);
  });

  const matrix = [
    { name: "small", data: fixtures["fixture"] },
    { name: "small text", data: smallText },
    { name: "big text", data: bigText },
    { name: "img", data: fixtures["fixture.png"] },
    { name: "empty", data: empty },
  ];
  for (const fixture of matrix) {
    for (const fixtureb of matrix) {
      it(`can handle fixture ${fixture.name} x ${fixtureb.name}`, async () => {
        const body = new StreamedBody([fixture.data, fixtureb.data]);
        using server = Bun.serve({ port: 0, fetch: () => body.response() });

        const res = await fetch(server.url);
        await gcTick();
        expect(res.status).toBe(200);
        expect(res.headers.get("transfer-encoding")).toBe("chunked");
        const chunks = await body.read(res.body!.getReader());
        expect(Buffer.concat(chunks)).toEqual(body.content);
      });
    }
  }

  // `corruptError` is the error code a corrupted body of that encoding rejects with.
  const types: { headers: Record<string, string>; compression: string; corruptError: string | null }[] = [
    { headers: {}, compression: "no", corruptError: null },
    { headers: { "Content-Encoding": "gzip" }, compression: "gzip", corruptError: "ZlibError" },
    { headers: { "Content-Encoding": "gzip" }, compression: "gzip-libdeflate", corruptError: "ZlibError" },
    { headers: { "Content-Encoding": "deflate" }, compression: "deflate", corruptError: "ZlibError" },
    { headers: { "Content-Encoding": "deflate" }, compression: "deflate-libdeflate", corruptError: "ZlibError" },
    { headers: { "Content-Encoding": "deflate" }, compression: "deflate_with_headers", corruptError: "ZlibError" },
    { headers: { "Content-Encoding": "br" }, compression: "br", corruptError: "BrotliDecompressionError" },
    { headers: { "Content-Encoding": "zstd" }, compression: "zstd", corruptError: "ZstdDecompressionError" },
  ];

  function compress(compression: string, data: Uint8Array): Uint8Array {
    switch (compression) {
      case "gzip-libdeflate":
      case "gzip":
        return Bun.gzipSync(data, {
          library: compression === "gzip-libdeflate" ? "libdeflate" : "zlib",
          level: 1, // fastest compression
        });
      case "deflate-libdeflate":
      case "deflate":
        return Bun.deflateSync(data, {
          library: compression === "deflate-libdeflate" ? "libdeflate" : "zlib",
          level: 1, // fastest compression
        });
      case "deflate_with_headers":
        return zlib.deflateSync(data, {
          level: 1, // fastest compression
        });
      case "br":
        return zlib.brotliCompressSync(data, {
          params: {
            [zlib.constants.BROTLI_PARAM_QUALITY]: 0,
            [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_GENERIC,
            [zlib.constants.BROTLI_PARAM_SIZE_HINT]: 0,
          },
        });
      case "zstd":
        return zlib.zstdCompressSync(data, {});
      default:
        return data;
    }
  }

  for (const { headers, compression, corruptError } of types) {
    // Only an identity body can be acknowledged piece by piece (see StreamedBody).
    const readerPaced = compression === "no";

    it(`with invalid utf8 with ${compression} compression`, async () => {
      const content = Buffer.concat([invalid, Buffer.from("Hello, world!\n".repeat(5), "utf8"), invalid]);
      const body = new StreamedBody(split(compress(compression, content), 4), { readerPaced });
      using server = Bun.serve({ port: 0, fetch: () => body.response(headers) });

      const res = await fetch(server.url);
      await gcTick();
      const chunks = await body.read(res.body!.getReader(), { gc: true });
      expect(res.status).toBe(200);
      expect(res.headers.get("content-encoding")).toBe(headers["Content-Encoding"] ?? null);
      expect(Buffer.concat(chunks)).toEqual(content);
    });

    it(`chunked response works (single chunk) with ${compression} compression`, async () => {
      const content = "Hello, world!\n".repeat(5);
      const data = compress(compression, Buffer.from(content, "utf8"));
      // text() cannot acknowledge chunks, so its body is not reader paced.
      const textBody = new StreamedBody([data], { readerPaced: false });
      const readerBody = new StreamedBody([data], { readerPaced });
      const bodies = [textBody, readerBody];
      using server = Bun.serve({ port: 0, fetch: () => bodies.shift()!.response(headers) });

      let res = await fetch(server.url);
      await gcTick();
      expect(await res.text()).toBe(content);

      res = await fetch(server.url);
      await gcTick();
      const chunks = await readerBody.read(res.body!.getReader());
      expect(chunks.length).toBe(1);
      expect(Buffer.concat(chunks).toString("utf8")).toBe(content);
    });

    it(`chunked response works (multiple chunks) with ${compression} compression`, async () => {
      const content = "Hello, world!\n".repeat(5);
      const pieces = split(compress(compression, Buffer.from(content, "utf8")), 4);
      // text() cannot acknowledge chunks, so its body is not reader paced.
      const textBody = new StreamedBody(pieces, { readerPaced: false });
      const readerBody = new StreamedBody(pieces, { readerPaced });
      const bodies = [textBody, readerBody];
      using server = Bun.serve({ port: 0, fetch: () => bodies.shift()!.response(headers) });

      let res = await fetch(server.url);
      await gcTick();
      expect(await res.text()).toBe(content);

      res = await fetch(server.url);
      await gcTick();
      const chunks = await readerBody.read(res.body!.getReader(), { gc: true });
      expect(res.headers.get("transfer-encoding")).toBe("chunked");
      if (readerPaced) {
        // Identity pieces arrive one read each. A decoder may merge or split them.
        expect(chunks.map(chunk => Buffer.from(chunk).toString())).toEqual(
          pieces.map(piece => Buffer.from(piece).toString()),
        );
      }
      expect(Buffer.concat(chunks).toString("utf8")).toBe(content);
    });

    it(`Content-Length response works (single part) with ${compression} compression`, async () => {
      const content = Buffer.alloc(1024, "a").toString();
      const data = compress(compression, Buffer.from(content));
      using server = Bun.serve({
        port: 0,
        fetch() {
          return new Response(data, {
            status: 200,
            headers: { "Content-Type": "text/plain", ...headers },
          });
        },
      });

      let res = await fetch(server.url);
      await gcTick();
      expect(await res.text()).toBe(content);

      res = await fetch(server.url);
      await gcTick();
      expect(res.headers.get("content-length")).toBe(String(data.byteLength));
      const chunks = await readChunks(res.body!.getReader());
      expect(chunks.length).toBe(1);
      expect(Buffer.concat(chunks).toString("utf8")).toBe(content);
    });

    it(`Content-Length response works (multiple parts) with ${compression} compression`, async () => {
      const rawBytes = Buffer.allocUnsafe(1024 * 1024);
      // Random data doesn't compress well. We need enough random data that
      // the compressed data is larger than 64 bytes.
      randomFillSync(rawBytes);
      const content = rawBytes.toString("hex");
      const contentBuffer = Buffer.from(content);
      const pieces = split(compress(compression, contentBuffer), 10);

      // The handler enqueues the first piece, then waits until the client has the
      // response head before it enqueues the rest, so the body always crosses the wire
      // in more than one chunk. One gate per request.
      const gates = [Promise.withResolvers<void>(), Promise.withResolvers<void>()];
      let requests = 0;
      using server = Bun.serve({
        port: 0,
        fetch() {
          const gate = gates[requests++].promise;
          let next = 0;
          return new Response(
            new ReadableStream({
              async pull(controller) {
                if (next === 1) await gate;
                controller.enqueue(pieces[next++]);
                if (next === pieces.length) controller.close();
              },
            }),
            {
              status: 200,
              headers: { "Content-Type": "text/plain", ...headers },
            },
          );
        },
      });

      let res = await fetch(server.url);
      gates[0].resolve();
      await gcTick();
      expect(await res.text()).toBe(content);

      res = await fetch(server.url);
      gates[1].resolve();
      await gcTick();
      const reader = res.body!.getReader();

      let currentRange = 0;
      const chunks = await readChunks(reader, async chunk => {
        // Check the content is what is expected at this time.
        // We're avoiding calling .buffer since that changes the internal representation in JSC and we want to test the raw data.
        expect(contentBuffer.compare(chunk, undefined, undefined, currentRange, currentRange + chunk.length)).toBe(0);
        const isFirstChunk = currentRange === 0;
        currentRange += chunk.length;
        // One collection while the rest of the body is still in flight.
        if (isFirstChunk) await gcTick();
      });
      expect(Buffer.concat(chunks).toString("utf8")).toBe(content);
      expect(chunks.length).toBeGreaterThan(1);

      currentRange = 0;
      for (const chunk of chunks) {
        // Check that each chunk hasn't been modified.
        // We want to be 100% sure that there is no accidental memory re-use here.
        expect(contentBuffer.compare(chunk, undefined, undefined, currentRange, currentRange + chunk.length)).toBe(0);
        currentRange += chunk.length;
      }
    });

    it(`Extra data should be ignored on streaming (multiple chunks, TCP server) with ${compression} compression`, async () => {
      const content = "Hello".repeat(5);
      const compressed = compress(compression, Buffer.from(content, "utf8"));
      using server = rawServer(responseHead({ ...headers, "Content-Length": compressed.byteLength }), [
        ...split(compressed, 5),
        "Extra Data!",
        "Extra Data!",
      ]);

      const res = await fetch(`http://127.0.0.1:${server.port}`);
      await gcTick();
      expect(res.status).toBe(200);
      expect(res.headers.get("content-length")).toBe(String(compressed.byteLength));
      const chunks = await readChunks(res.body!.getReader());
      expect(Buffer.concat(chunks).toString("utf8")).toBe(content);
    });

    it(`Missing data should timeout on streaming (multiple chunks, TCP server) with ${compression} compression`, async () => {
      const content = "Hello".repeat(5);
      const compressed = compress(compression, Buffer.from(content, "utf8"));
      // 10 extra bytes that the server never sends.
      using server = rawServer(
        responseHead({ ...headers, "Content-Length": compressed.byteLength + 10 }),
        split(compressed, 5),
      );

      const received: Uint8Array[] = [];
      const error = await rejection(
        (async () => {
          const res = await fetch(`http://127.0.0.1:${server.port}`, { signal: AbortSignal.timeout(1000) });
          await gcTick();
          await readChunks(res.body!.getReader(), chunk => {
            received.push(chunk);
          });
        })(),
      );
      expect(error).toBeInstanceOf(DOMException);
      expect(error.name).toBe("TimeoutError");
      // Whatever was decoded before the timeout is a prefix of the content.
      expect(content).toStartWith(Buffer.concat(received).toString("utf8"));
    });

    if (corruptError !== null) {
      it(`can handle corrupted ${compression} compression`, async () => {
        const content = "Hello".repeat(5);
        const compressed = compress(compression, Buffer.from(content, "utf8"));
        const pieces = split(compressed, 5);
        // Corrupt the first byte of every piece (the views share the compressed buffer).
        for (const piece of pieces) piece[0] = 0;
        using server = rawServer(responseHead({ ...headers, "Content-Length": compressed.byteLength }), pieces);

        const url = `http://127.0.0.1:${server.port}`;
        const error = await rejection(
          (async () => {
            const res = await fetch(url);
            await gcTick();
            await readChunks(res.body!.getReader());
          })(),
        );
        expect(error).toBeInstanceOf(TypeError);
        expect(error.code).toBe(corruptError);
        expect(error.message).toStartWith(`${corruptError} fetching "${url}/"`);
      });
    }

    it(`can handle socket close with ${compression} compression`, async () => {
      const content = "Hello".repeat(5);
      const compressed = compress(compression, Buffer.from(content, "utf8"));
      const { promise: opened, resolve: onHead } = Promise.withResolvers<Socket>();
      // 10 extra bytes that the server never sends, so the close below cuts the body short.
      using server = rawServer(
        responseHead({ ...headers, "Content-Length": compressed.byteLength + 10 }),
        split(compressed, 5),
        onHead,
      );

      const received: Uint8Array[] = [];
      const error = await rejection(
        (async () => {
          const res = await fetch(`http://127.0.0.1:${server.port}`);
          const socket = await opened;
          await gcTick();
          const reader = res.body!.getReader();
          const reading = readChunks(reader, chunk => {
            received.push(chunk);
          });
          // Close the server side while the first read is pending.
          socket.end();
          await reading;
        })(),
      );
      expect(error).toBeInstanceOf(TypeError);
      expect(error.code).toBe("ECONNRESET");
      expect(content).toStartWith(Buffer.concat(received).toString("utf8"));
    });
  }

  it.skipIf(
    // The C program is POSIX only
    isWindows,
  )("should drain response body from HTTP thread when server sends chunk then stops (chunked encoding)", async () => {
    // This test reproduces a bug where the HTTP client wasn't asking the HTTP thread
    // to drain pending response body bytes. If the server sent headers + first chunk,
    // then stopped sending data (but kept connection open), the read would hang forever.
    //
    // We use a C server with blocking sockets instead of Bun.listen because Bun's sockets
    // are non-blocking and event-driven, which makes it difficult to reliably reproduce
    // the exact timing conditions needed to trigger this bug. The C server uses blocking
    // write() calls that ensure data is buffered in the kernel before the server stops
    // sending, forcing the HTTP client to drain the response body from the HTTP thread.
    const dir = tempDirWithFilesAnon({ "a": "// a" });
    {
      await using proc = Bun.spawn({
        cmd: [
          "cc",
          "-Wno-error",
          "-w",
          path.join(import.meta.dirname, "http-chunked-server.c"),
          "-o",
          "http-chunked-server",
        ],
        cwd: dir,
        stdout: "inherit",
        stderr: "inherit",
        stdin: "ignore",
      });
      expect(await proc.exited).toBe(0);
    }

    await using server = Bun.spawn({
      cmd: [path.join(dir, "http-chunked-server")],
      stdout: "pipe",
      stderr: "inherit",
      stdin: "ignore",
    });

    const url = new URL("http://127.0.0.1:" + (await server.stdout.text()).trim());

    const response = await fetch(url.toString(), {});
    const reader = response.body!.getReader();

    // Read the data - this should not hang
    const result = (await reader.read()) as ReadableStreamDefaultReadResult<any>;

    // Verify we got the data without hanging
    expect(result.done).toBe(false);
    expect(result.value).toBeDefined();
    expect(new TextDecoder().decode(result.value!)).toBe("hello\n");
    server.kill("SIGTERM");
  });
});

// ByteStream::on_data used to call signal_drained() before taking the pending
// buffer action out of its cell; the drain signal can re-enter and consume the
// action, so the unwrap() that followed panicked and killed the process
// (seen as a crash when aborting fetches with parked reads on streaming
// bodies). The race is timing-dependent, so this stress fixture exercises the
// abort paths and asserts every parked consumer settles with exit code 0.
test.concurrent("aborting streaming fetches with parked body consumers settles them without crashing", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), join(import.meta.dir, "fetch-abort-parked-reads-fixture.ts")],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(stdout).toBe("done 12\n");
  expect(exitCode).toBe(0);
});

// Deterministic version of the regression above: the re-entrant consumption is
// not reachable from plain JS (the in-tree producers defer their drain
// signals), so the fixture installs a bun:internal-for-testing producer whose
// drain signal re-enters on_cancel, consuming the parked body.text() buffer
// action from inside on_data(Err) exactly where the wild crash did.
test.concurrent(
  "buffer action consumed re-entrantly during on_data(Err) settles text() instead of crashing",
  async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), join(import.meta.dir, "bytestream-cancel-on-drain-fixture.ts")],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    expect(stdout).toBe("rejected:TypeError\n");
    expect(exitCode).toBe(0);
  },
);

// https://github.com/oven-sh/bun/issues/41439
// A flushed zstd chunk that decodes to more than 4096 bytes must reach the
// reader in full. The decoder used to hand over 4096 bytes and keep the rest
// until the next compressed chunk arrived.
test("fetch zstd streaming body delivers the whole flushed chunk at once", async () => {
  const firstLine = Buffer.alloc(20000, "x").toString() + "\n";
  const secondLine = "done\n";

  // Compress the two lines as one zstd stream, with a flush after the first
  // line, so the server can send each compressed part on its own.
  const compressor = zlib.createZstdCompress();
  const compressed: Buffer[] = [];
  compressor.on("data", chunk => compressed.push(chunk));
  await new Promise<void>(resolve => {
    compressor.write(firstLine);
    compressor.flush(resolve);
  });
  const firstPart = Buffer.concat(compressed.splice(0));
  const ended = new Promise<void>(resolve => compressor.once("end", resolve));
  compressor.end(secondLine);
  await ended;
  const restPart = Buffer.concat(compressed.splice(0));
  expect(firstPart.byteLength).toBeGreaterThan(0);
  expect(restPart.byteLength).toBeGreaterThan(0);

  const { promise: sendRest, resolve: releaseRest } = Promise.withResolvers<void>();
  using server = Bun.serve({
    port: 0,
    fetch() {
      return new Response(
        new ReadableStream({
          async start(controller) {
            controller.enqueue(firstPart);
            await sendRest;
            controller.enqueue(restPart);
            controller.close();
          },
        }),
        { headers: { "Content-Encoding": "zstd", "Content-Type": "application/x-ndjson" } },
      );
    },
  });

  const response = await fetch(server.url, { headers: { "Accept-Encoding": "zstd" } });
  const reader = response.body!.getReader();

  const first = await reader.read();
  expect(first.done).toBe(false);
  expect(first.value!.byteLength).toBe(firstLine.length);
  expect(Buffer.from(first.value!).toString()).toBe(firstLine);

  releaseRest();
  let rest = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    rest += Buffer.from(value).toString();
  }
  expect(rest).toBe(secondLine);
});
