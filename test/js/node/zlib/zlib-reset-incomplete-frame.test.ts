// reset() of a gzip compressor whose open member has already given output.
// Node.js refuses it since v26.11.0 (nodejs/node#66179), because the bytes that are already out
// cannot be taken back. This file passes unchanged under Node.js v26.12.1.
import assert from "node:assert";
import { once } from "node:events";
import { finished } from "node:stream/promises";
import { describe, test } from "node:test";
import zlib from "node:zlib";

const { Z_DEFAULT_STRATEGY, Z_FINISH, Z_NO_FLUSH, Z_STREAM_ERROR, Z_SYNC_FLUSH } = zlib.constants;

// The tests reach `_handle`, `_writeState` and `_processChunk`, and the types have no `reset()` for most kinds.
type Stream = any;
type Handle = any;
type Report = { message: string; errno: number; code: string };

const refusal: Report = {
  message: "Cannot reset a gzip stream with an incomplete member; end the stream or start a new gzip compressor",
  errno: Z_STREAM_ERROR,
  code: "ERR_ZLIB_INCOMPLETE_FRAME",
};

// Without an 'error' listener, a stream that reset() destroys throws its error from process.nextTick,
// into the test that runs by then. Each test reads the error from finished().
function quiet(stream: Stream): Stream {
  return stream.on("error", () => {});
}

// A write that fails destroys the stream and does not call its callback, so 'error' and 'close'
// settle the promise too.
function settled(stream: Stream, start: (callback: (error?: Error | null) => void) => void) {
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  const onError = (error: Error) => reject(error);
  const onClose = () => reject(new Error("the stream closed before the callback ran"));
  stream.once("error", onError);
  stream.once("close", onClose);
  start(error => (error ? reject(error) : resolve()));
  return promise.finally(() => {
    stream.off("error", onError);
    stream.off("close", onClose);
  });
}

function flushed(stream: Stream, kind?: number) {
  return settled(stream, callback => (kind === undefined ? stream.flush(callback) : stream.flush(kind, callback)));
}

function written(stream: Stream, chunk: string | Buffer) {
  return settled(stream, callback => stream.write(chunk, callback));
}

function collect(stream: Stream): Buffer[] {
  const chunks: Buffer[] = [];
  stream.on("data", (chunk: Buffer) => chunks.push(chunk));
  return chunks;
}

function reportsOf(handle: Handle, onReport?: (error: Error) => void): Report[] {
  const reports: Report[] = [];
  handle.onerror = (message: string, errno: number, code: string) => {
    reports.push({ message, errno, code });
    onReport?.(Object.assign(new Error(message), { errno, code }));
  };
  return reports;
}

describe("Gzip: reset() in an open member", () => {
  test("after a flush, destroys the stream before it returns", async () => {
    const stream = quiet(zlib.createGzip());
    const chunks = collect(stream);
    stream.write("hello");
    await flushed(stream);
    assert.ok(Buffer.concat(chunks).length > 0);

    assert.strictEqual(stream.reset(), undefined);
    assert.strictEqual(stream.destroyed, true);
    await assert.rejects(finished(stream), { name: "Error", ...refusal });
  });

  test("after output and then a write that gives none", async () => {
    const stream = quiet(zlib.createGzip());
    const chunks = collect(stream);
    stream.write("hello");
    await flushed(stream);
    const given = Buffer.concat(chunks).length;
    assert.ok(given > 0);
    // This write stays in the compressor. The member is still open, and part of it is out.
    await written(stream, "world");
    assert.strictEqual(Buffer.concat(chunks).length, given);

    stream.reset();
    assert.strictEqual(stream.destroyed, true);
    await assert.rejects(finished(stream), { code: "ERR_ZLIB_INCOMPLETE_FRAME" });
  });

  test("is allowed once a finish flush completed it, and the next one is guarded again", async () => {
    const stream = quiet(zlib.createGzip());
    const chunks = collect(stream);
    stream.write("hello");
    // This output makes it open. The finish flush then completes it.
    await flushed(stream);
    assert.ok(Buffer.concat(chunks).length > 0);
    await flushed(stream, Z_FINISH);
    stream.reset();
    assert.strictEqual(stream.destroyed, false);
    stream.write("world");
    await flushed(stream, Z_FINISH);
    // Two complete members decode as one.
    assert.strictEqual(zlib.gunzipSync(Buffer.concat(chunks)).toString(), "helloworld");

    stream.reset();
    stream.write("again");
    await flushed(stream);
    stream.reset();
    assert.strictEqual(stream.destroyed, true);
    await assert.rejects(finished(stream), { code: "ERR_ZLIB_INCOMPLETE_FRAME" });
  });

  test("inside a 'data' listener", async () => {
    const stream = quiet(zlib.createGzip());
    const done = finished(stream);
    const { promise: destroyed, resolve } = Promise.withResolvers<boolean>();
    stream.once("data", () => {
      stream.reset();
      resolve(stream.destroyed);
    });
    stream.write("hello");
    stream.flush();
    // A stream that ends before its first 'data' settles `done`, and 'data' never comes.
    const early = done.then(() => Promise.reject(new Error("the stream finished before 'data'")));
    assert.strictEqual(await Promise.race([destroyed, early]), true);
    await assert.rejects(done, { code: "ERR_ZLIB_INCOMPLETE_FRAME" });
  });

  test("after a synchronous _processChunk()", async () => {
    const stream = quiet(zlib.createGzip());
    const handle = stream._handle;
    // A synchronous _processChunk() closes the handle when it returns. minizlib keeps it open this way.
    const close = handle.close;
    handle.close = () => {};
    const output = stream._processChunk(Buffer.from("hello"), Z_SYNC_FLUSH);
    stream._handle = handle;
    handle.close = close;
    assert.ok(output.length > 0);

    stream.reset();
    assert.strictEqual(stream.destroyed, true);
    await assert.rejects(finished(stream), { code: "ERR_ZLIB_INCOMPLETE_FRAME" });
  });

  test("after params(), which flushes the header", async () => {
    const stream = quiet(zlib.createGzip());
    await settled(stream, callback => stream.params(1, Z_DEFAULT_STRATEGY, callback));
    stream.reset();
    assert.strictEqual(stream.destroyed, true);
    await assert.rejects(finished(stream), { code: "ERR_ZLIB_INCOMPLETE_FRAME" });
  });

  test("on the native handle, reports to onerror and keeps what is open", () => {
    const stream = quiet(zlib.createGzip());
    const handle = stream._handle;
    const reports = reportsOf(handle);
    const input = Buffer.from("hello hello hello hello");
    const output = Buffer.alloc(4096);
    try {
      // 4 bytes of room: the output starts, and its end does not fit.
      handle.writeSync(Z_FINISH, input, 0, input.length, output, 0, 4);
      handle.reset();
      assert.deepStrictEqual(reports, [refusal]);

      // The refused reset() dropped nothing: the rest arrives, and all of it decodes.
      const unread = stream._writeState[1];
      handle.writeSync(Z_FINISH, input, input.length - unread, unread, output, 4, output.length - 4);
      const length = output.length - stream._writeState[0];
      assert.strictEqual(zlib.gunzipSync(output.subarray(0, length)).toString(), input.toString());

      // It is complete now, so reset() is allowed.
      handle.reset();
      assert.strictEqual(reports.length, 1);
    } finally {
      stream.destroy();
    }
  });

  test("on the native handle, after output and then a write that gives none", () => {
    const stream = quiet(zlib.createGzip());
    const handle = stream._handle;
    const reports = reportsOf(handle);
    const input = Buffer.from("hello");
    const output = Buffer.alloc(4096);
    try {
      handle.writeSync(Z_SYNC_FLUSH, input, 0, input.length, output, 0, output.length);
      assert.ok(stream._writeState[0] < output.length);
      handle.writeSync(Z_NO_FLUSH, input, 0, input.length, output, 0, output.length);
      assert.deepStrictEqual([...stream._writeState], [output.length, 0]);
      handle.reset();
      assert.deepStrictEqual(reports, [refusal]);
    } finally {
      stream.destroy();
    }
  });

  test("on the native handle, after a write() on the thread pool", async () => {
    const stream = quiet(zlib.createGzip());
    const handle = new stream._handle.constructor(zlib.constants.GZIP);
    stream.destroy();
    const { promise: wrote, resolve, reject } = Promise.withResolvers<void>();
    handle.init(15, 6, 8, Z_DEFAULT_STRATEGY, new Uint32Array(2), resolve, undefined);
    const reports = reportsOf(handle, reject);
    const input = Buffer.from("hello");
    const output = Buffer.alloc(4096);
    try {
      handle.write(Z_SYNC_FLUSH, input, 0, input.length, output, 0, output.length);
      await wrote;
      handle.reset();
      assert.deepStrictEqual(reports, [refusal]);
    } finally {
      handle.close();
    }
  });
});

describe("Gzip: reset() is allowed while no part of a member is out", () => {
  const input = Buffer.from("hello");

  test("a finish write completes the member only if its end fits in the output", () => {
    // At level 0 a member is 10 bytes of header, one stored block of 5 + n bytes, and 8 bytes of trailer.
    for (const [length, expected] of [
      [64 - 23, []],
      [64 - 22, [refusal]],
    ] as const) {
      const stream = quiet(zlib.createGzip({ level: 0 }));
      const handle = stream._handle;
      const reports = reportsOf(handle);
      const output = Buffer.alloc(64);
      try {
        handle.writeSync(Z_FINISH, Buffer.alloc(length, "a"), 0, length, output, 0, output.length);
        // The output is full in both cases.
        assert.deepStrictEqual([...stream._writeState], [0, 0]);
        handle.reset();
        assert.deepStrictEqual(reports, expected);
      } finally {
        stream.destroy();
      }
    }
  });

  test("a write with no room for the header gives no output", () => {
    const stream = quiet(zlib.createGzip());
    const handle = stream._handle;
    const reports = reportsOf(handle);
    try {
      handle.writeSync(Z_NO_FLUSH, input, 0, input.length, Buffer.alloc(64), 0, 0);
      assert.deepStrictEqual([...stream._writeState], [0, input.length]);
      handle.reset();
      assert.deepStrictEqual(reports, []);
    } finally {
      stream.destroy();
    }
  });

  test("a write after the end of the member fails and gives no output", () => {
    const stream = quiet(zlib.createGzip());
    const handle = stream._handle;
    const reports = reportsOf(handle);
    const output = Buffer.alloc(64);
    try {
      handle.writeSync(Z_FINISH, input, 0, input.length, output, 0, output.length);
      assert.deepStrictEqual(reports, []);
      handle.writeSync(Z_NO_FLUSH, input, 0, input.length, output, 0, output.length);
      assert.deepStrictEqual(reports, [{ message: "stream error", errno: Z_STREAM_ERROR, code: "Z_STREAM_ERROR" }]);
      handle.reset();
      assert.strictEqual(reports.length, 1);
    } finally {
      stream.destroy();
    }
  });
});

// Node.js refuses none of these.
const neverRefused: [name: string, create: () => Stream][] = [
  ["Deflate", () => zlib.createDeflate()],
  ["DeflateRaw", () => zlib.createDeflateRaw()],
  ["BrotliCompress", () => zlib.createBrotliCompress()],
];

for (const [name, create] of neverRefused) {
  test(`${name}: reset() after a flush is allowed`, async () => {
    const stream = quiet(create());
    const chunks = collect(stream);
    stream.write("hello");
    await flushed(stream);
    assert.ok(Buffer.concat(chunks).length > 0);
    stream.reset();
    assert.strictEqual(stream.destroyed, false);
    stream.end("world");
    await finished(stream);
  });
}

const decompressors: [name: string, create: () => Stream, compress: (data: Buffer) => Buffer][] = [
  ["Gunzip", () => zlib.createGunzip(), zlib.gzipSync],
  ["Inflate", () => zlib.createInflate(), zlib.deflateSync],
  ["InflateRaw", () => zlib.createInflateRaw(), zlib.deflateRawSync],
  ["Unzip", () => zlib.createUnzip(), zlib.gzipSync],
  ["BrotliDecompress", () => zlib.createBrotliDecompress(), zlib.brotliCompressSync],
  ["ZstdDecompress", () => zlib.createZstdDecompress(), zlib.zstdCompressSync],
];

for (const [name, create, compress] of decompressors) {
  test(`${name}: reset() in the middle of the input is allowed`, async () => {
    const data = Buffer.alloc(100_000, "abcdefghij");
    const frame = compress(data);
    const stream = quiet(create());
    const chunks = collect(stream);
    await written(stream, frame.subarray(0, frame.length >> 1));
    stream.reset();
    assert.strictEqual(stream.destroyed, false);

    chunks.length = 0;
    stream.end(frame);
    await once(stream, "end");
    assert.ok(Buffer.concat(chunks).equals(data));
  });
}

const everyKind: [name: string, create: () => Stream][] = [
  ["Gzip", () => zlib.createGzip()],
  ...neverRefused,
  ["ZstdCompress", () => zlib.createZstdCompress()],
  ...decompressors.map(([name, create]): [string, () => Stream] => [name, create]),
];

for (const [name, create] of everyKind) {
  test(`${name}: reset() of a destroyed stream throws ERR_INTERNAL_ASSERTION`, () => {
    const stream = create();
    stream.destroy();
    assert.throws(() => stream.reset(), {
      name: "Error",
      code: "ERR_INTERNAL_ASSERTION",
      message:
        "zlib binding closed\n" +
        "This is caused by either a bug in Node.js or incorrect usage of Node.js internals.\n" +
        "Please open an issue with this stack trace at https://github.com/nodejs/node/issues\n",
    });
  });
}
