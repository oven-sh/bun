// reset() of a zstd compressor whose open frame has already given output.
// Node.js refuses it since v26.11.0 (nodejs/node#66088), because the bytes that are already out
// cannot be taken back. This file passes unchanged under Node.js v26.12.1.
import assert from "node:assert";
import { once } from "node:events";
import { finished } from "node:stream/promises";
import { describe, test } from "node:test";
import zlib from "node:zlib";

const { ZSTD_e_continue, ZSTD_e_end, ZSTD_e_flush } = zlib.constants;
const ZSTD_error_stage_wrong = 60;

// The tests reach `_handle`, `_writeState` and `_processChunk`, and the types have no `reset()` for zstd streams.
type Stream = any;
type Handle = any;
type Report = { message: string; errno: number; code: string };

const refusal: Report = {
  message: "Cannot reset a zstd stream with an incomplete frame; end the frame or discard the output produced so far",
  errno: ZSTD_error_stage_wrong,
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

function init(handle: Handle, writeState: Uint32Array, callback: () => void) {
  handle.init(new Uint32Array(0), undefined, writeState, callback);
}

describe("ZstdCompress: reset() in an open frame", () => {
  test("after a flush, destroys the stream before it returns", async () => {
    const stream = quiet(zlib.createZstdCompress());
    const chunks = collect(stream);
    stream.write("hello");
    await flushed(stream);
    assert.ok(Buffer.concat(chunks).length > 0);

    assert.strictEqual(stream.reset(), undefined);
    assert.strictEqual(stream.destroyed, true);
    await assert.rejects(finished(stream), { name: "Error", ...refusal });
  });

  test("after output and then a write that gives none", async () => {
    const stream = quiet(zlib.createZstdCompress());
    const chunks = collect(stream);
    stream.write("hello");
    await flushed(stream);
    const given = Buffer.concat(chunks).length;
    assert.ok(given > 0);
    // This write stays in the compressor. The frame is still open, and part of it is out.
    await written(stream, "world");
    assert.strictEqual(Buffer.concat(chunks).length, given);

    stream.reset();
    assert.strictEqual(stream.destroyed, true);
    await assert.rejects(finished(stream), { code: "ERR_ZLIB_INCOMPLETE_FRAME" });
  });

  test("is allowed once a finish flush completed it, and the next one is guarded again", async () => {
    const stream = quiet(zlib.createZstdCompress());
    const chunks = collect(stream);
    stream.write("hello");
    // This output makes it open. The finish flush then completes it.
    await flushed(stream);
    assert.ok(Buffer.concat(chunks).length > 0);
    await flushed(stream, ZSTD_e_end);
    stream.reset();
    assert.strictEqual(stream.destroyed, false);
    stream.write("world");
    await flushed(stream, ZSTD_e_end);
    // Two complete frames decode as one.
    assert.strictEqual(zlib.zstdDecompressSync(Buffer.concat(chunks)).toString(), "helloworld");

    stream.reset();
    stream.write("again");
    await flushed(stream);
    stream.reset();
    assert.strictEqual(stream.destroyed, true);
    await assert.rejects(finished(stream), { code: "ERR_ZLIB_INCOMPLETE_FRAME" });
  });

  test("inside a 'data' listener", async () => {
    const stream = quiet(zlib.createZstdCompress());
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
    const stream = quiet(zlib.createZstdCompress());
    const handle = stream._handle;
    // A synchronous _processChunk() closes the handle when it returns. minizlib keeps it open this way.
    const close = handle.close;
    handle.close = () => {};
    const output = stream._processChunk(Buffer.from("hello"), ZSTD_e_flush);
    stream._handle = handle;
    handle.close = close;
    assert.ok(output.length > 0);

    stream.reset();
    assert.strictEqual(stream.destroyed, true);
    await assert.rejects(finished(stream), { code: "ERR_ZLIB_INCOMPLETE_FRAME" });
  });

  test("on the native handle, reports to onerror and keeps what is open", () => {
    const stream = quiet(zlib.createZstdCompress());
    const handle = stream._handle;
    const reports = reportsOf(handle);
    const input = Buffer.from("hello hello hello hello");
    const output = Buffer.alloc(4096);
    try {
      // 4 bytes of room: the output starts, and its end does not fit.
      handle.writeSync(ZSTD_e_end, input, 0, input.length, output, 0, 4);
      handle.reset();
      assert.deepStrictEqual(reports, [refusal]);

      // The refused reset() dropped nothing: the rest arrives, and all of it decodes.
      const unread = stream._writeState[1];
      handle.writeSync(ZSTD_e_end, input, input.length - unread, unread, output, 4, output.length - 4);
      const length = output.length - stream._writeState[0];
      assert.strictEqual(zlib.zstdDecompressSync(output.subarray(0, length)).toString(), input.toString());

      // It is complete now, so reset() is allowed.
      handle.reset();
      assert.strictEqual(reports.length, 1);
    } finally {
      stream.destroy();
    }
  });

  test("on the native handle, after output and then a write that gives none", () => {
    const stream = quiet(zlib.createZstdCompress());
    const handle = stream._handle;
    const reports = reportsOf(handle);
    const input = Buffer.from("hello");
    const output = Buffer.alloc(4096);
    try {
      handle.writeSync(ZSTD_e_flush, input, 0, input.length, output, 0, output.length);
      assert.ok(stream._writeState[0] < output.length);
      handle.writeSync(ZSTD_e_continue, input, 0, input.length, output, 0, output.length);
      assert.deepStrictEqual([...stream._writeState], [output.length, 0]);
      handle.reset();
      assert.deepStrictEqual(reports, [refusal]);
    } finally {
      stream.destroy();
    }
  });

  test("on the native handle, after a write() on the thread pool", async () => {
    const stream = quiet(zlib.createZstdCompress());
    const handle = new stream._handle.constructor(zlib.constants.ZSTD_COMPRESS);
    stream.destroy();
    const { promise: wrote, resolve, reject } = Promise.withResolvers<void>();
    init(handle, new Uint32Array(2), resolve);
    const reports = reportsOf(handle, reject);
    const input = Buffer.from("hello");
    const output = Buffer.alloc(4096);
    try {
      handle.write(ZSTD_e_flush, input, 0, input.length, output, 0, output.length);
      await wrote;
      handle.reset();
      assert.deepStrictEqual(reports, [refusal]);
    } finally {
      handle.close();
    }
  });

  test("on the native handle, is allowed after a second init()", () => {
    const stream = quiet(zlib.createZstdCompress());
    const handle = stream._handle;
    const reports = reportsOf(handle);
    const input = Buffer.from("hello");
    const output = Buffer.alloc(4096);
    try {
      handle.writeSync(ZSTD_e_flush, input, 0, input.length, output, 0, output.length);
      assert.ok(stream._writeState[0] < output.length);
      init(handle, stream._writeState, () => {});
      handle.reset();
      assert.deepStrictEqual(reports, []);
    } finally {
      stream.destroy();
    }
  });
});

describe("ZstdCompress: reset() is allowed while no part of a frame is out", () => {
  const cases: [title: string, drive: (stream: Stream) => Promise<void>, decoded: string][] = [
    ["after a flush of nothing", stream => flushed(stream), "world"],
    ["after an empty write", stream => written(stream, Buffer.alloc(0)), "world"],
    ["after a write that stays in the compressor", stream => written(stream, "dropped"), "world"],
    [
      "after a complete frame and a write that stays in the compressor",
      async stream => {
        stream.write("complete ");
        await flushed(stream, ZSTD_e_end);
        await written(stream, "dropped");
      },
      "complete world",
    ],
  ];
  for (const [title, drive, decoded] of cases) {
    test(title, async () => {
      const stream = quiet(zlib.createZstdCompress());
      const chunks = collect(stream);
      await drive(stream);
      stream.reset();
      assert.strictEqual(stream.destroyed, false);
      stream.end("world");
      await finished(stream);
      assert.strictEqual(zlib.zstdDecompressSync(Buffer.concat(chunks)).toString(), decoded);
    });
  }
});

test("ZstdDecompress: reset() in the middle of the input is allowed", async () => {
  const data = Buffer.alloc(100_000, "abcdefghij");
  const frame = zlib.zstdCompressSync(data);
  const stream = quiet(zlib.createZstdDecompress());
  const chunks = collect(stream);
  await written(stream, frame.subarray(0, frame.length >> 1));
  stream.reset();
  assert.strictEqual(stream.destroyed, false);

  chunks.length = 0;
  stream.end(frame);
  await once(stream, "end");
  assert.ok(Buffer.concat(chunks).equals(data));
});
