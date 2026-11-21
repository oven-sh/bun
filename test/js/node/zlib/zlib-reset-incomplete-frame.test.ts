// reset() of a gzip compressor whose open member has already given output.
// Node.js refuses it since v26.11.0 (nodejs/node#66179), because the bytes that
// are already out cannot be taken back. All tests in this file run in both Bun and Node.js:
// `bun test` runs them here, and the last test runs this same file under Node.js.
import assert from "node:assert";
import { finished } from "node:stream/promises";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

const { Z_BUF_ERROR, Z_DEFAULT_STRATEGY, Z_FINISH, Z_NO_FLUSH, Z_STREAM_ERROR, Z_SYNC_FLUSH } = zlib.constants;

// The tests reach `_handle`, `_writeState` and `_processChunk`, and the types have no `reset()` for Gzip.
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

function init(handle: Handle, writeState: Uint32Array, callback: () => void) {
  handle.init(15, 6, 8, Z_DEFAULT_STRATEGY, writeState, callback, undefined);
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
    // This output makes the member open. The finish flush then completes it.
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

      // The member is complete now, so reset() is allowed.
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
    // Node.js writes the result of a write through a pointer to this array, so the array has to stay referenced.
    const writeState = new Uint32Array(2);
    init(handle, writeState, resolve);
    const reports = reportsOf(handle, reject);
    const input = Buffer.from("hello");
    const output = Buffer.alloc(4096);
    try {
      handle.write(Z_SYNC_FLUSH, input, 0, input.length, output, 0, output.length);
      await wrote;
      assert.ok(writeState[0] < output.length);
      handle.reset();
      assert.deepStrictEqual(reports, [refusal]);
    } finally {
      handle.close();
    }
  });

  test("on the native handle, a second init() forgets the output of the first one", () => {
    const stream = quiet(zlib.createGzip());
    const handle = stream._handle;
    const reports = reportsOf(handle);
    const input = Buffer.from("hello");
    const output = Buffer.alloc(4096);
    try {
      handle.writeSync(Z_SYNC_FLUSH, input, 0, input.length, output, 0, output.length);
      assert.ok(stream._writeState[0] < output.length);

      init(handle, stream._writeState, () => {});
      handle.reset();
      assert.deepStrictEqual(reports, []);

      handle.writeSync(Z_FINISH, input, 0, input.length, output, 0, output.length);
      const length = output.length - stream._writeState[0];
      assert.strictEqual(zlib.gunzipSync(output.subarray(0, length)).toString(), input.toString());
    } finally {
      stream.destroy();
    }
  });
});

describe("Gzip: the first deflate() call puts out the header", () => {
  const input = Buffer.from("hello");

  test("reset() after params() is refused, because params() flushes", async () => {
    const stream = quiet(zlib.createGzip());
    await settled(stream, callback => stream.params(1, Z_DEFAULT_STRATEGY, callback));
    stream.reset();
    assert.strictEqual(stream.destroyed, true);
    await assert.rejects(finished(stream), { code: "ERR_ZLIB_INCOMPLETE_FRAME" });
  });

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

  test("a write with no room for the header gives no output, and reset() is allowed", () => {
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

  test("a write after the end of the member fails and gives no output, and reset() is allowed", () => {
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

describe("Gzip: a deflate() result that is not the end of the member leaves it open", () => {
  const input = Buffer.from("hello");
  const member = zlib.gzipSync(input, { level: 0 });
  // A finish write into this much room stops 7 bytes before the end of the trailer.
  const room = member.length - 7;

  test("a second flush with nothing to do (Z_BUF_ERROR, no output)", async () => {
    const stream = quiet(zlib.createGzip());
    const chunks = collect(stream);
    stream.write("hello");
    await flushed(stream);
    const given = Buffer.concat(chunks).length;
    assert.ok(given > 0);
    await flushed(stream);
    assert.strictEqual(Buffer.concat(chunks).length, given);
    assert.strictEqual(stream.destroyed, false);

    stream.reset();
    assert.strictEqual(stream.destroyed, true);
    await assert.rejects(finished(stream), { code: "ERR_ZLIB_INCOMPLETE_FRAME" });
  });

  test("a finish write with new input gives the pending end and then fails (Z_BUF_ERROR with output)", () => {
    const stream = quiet(zlib.createGzip({ level: 0 }));
    const handle = stream._handle;
    const reports = reportsOf(handle);
    const output = Buffer.alloc(64);
    try {
      handle.writeSync(Z_FINISH, input, 0, input.length, output, 0, room);
      assert.deepStrictEqual(reports, []);

      handle.writeSync(Z_FINISH, input, 0, input.length, output, room, output.length - room);
      assert.deepStrictEqual(reports, [{ message: "buffer error", errno: Z_BUF_ERROR, code: "Z_BUF_ERROR" }]);
      // The write that failed gave the 7 bytes. Each byte of the member is out now.
      assert.deepStrictEqual(output.subarray(0, member.length), member);

      // deflate() has not returned Z_STREAM_END, so the member is still open.
      handle.reset();
      assert.deepStrictEqual(reports.slice(1), [refusal]);

      // A finish write with no input returns Z_STREAM_END and gives no output.
      handle.writeSync(Z_FINISH, input, 0, 0, output, member.length, output.length - member.length);
      assert.deepStrictEqual([...stream._writeState], [output.length - member.length, 0]);
      handle.reset();
      assert.strictEqual(reports.length, 2);
    } finally {
      stream.destroy();
    }
  });

  test("a finish write whose room is exactly the pending end (Z_OK, not Z_STREAM_END)", () => {
    const stream = quiet(zlib.createGzip({ level: 0 }));
    const handle = stream._handle;
    const reports = reportsOf(handle);
    const output = Buffer.alloc(64);
    try {
      handle.writeSync(Z_FINISH, input, 0, input.length, output, 0, room);
      handle.writeSync(Z_FINISH, input, 0, 0, output, room, 7);
      assert.deepStrictEqual([...stream._writeState], [0, 0]);
      assert.deepStrictEqual(reports, []);
      assert.deepStrictEqual(output.subarray(0, member.length), member);

      handle.reset();
      assert.deepStrictEqual(reports, [refusal]);
    } finally {
      stream.destroy();
    }
  });

  test("a write that is not a finish write, after a finish write that did not fit (Z_STREAM_ERROR, no output)", () => {
    const stream = quiet(zlib.createGzip({ level: 0 }));
    const handle = stream._handle;
    const reports = reportsOf(handle);
    const output = Buffer.alloc(64, 0xee);
    try {
      handle.writeSync(Z_FINISH, input, 0, input.length, output, 0, room);
      handle.writeSync(Z_NO_FLUSH, input, 0, input.length, output, room, output.length - room);
      assert.deepStrictEqual(reports, [{ message: "stream error", errno: Z_STREAM_ERROR, code: "Z_STREAM_ERROR" }]);
      // Z_STREAM_ERROR is decided before deflate() writes: the 7 bytes are still pending.
      assert.deepStrictEqual(output.subarray(room), Buffer.alloc(output.length - room, 0xee));

      handle.reset();
      assert.deepStrictEqual(reports.slice(1), [refusal]);
    } finally {
      stream.destroy();
    }
  });
});

// Node.js refuses neither of these.
const neverRefused: [name: string, create: () => Stream][] = [
  ["Deflate", () => zlib.createDeflate()],
  ["DeflateRaw", () => zlib.createDeflateRaw()],
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

// Only in Bun: when Node.js runs this file it must not spawn itself again.
if (typeof Bun !== "undefined") {
  const { bunEnv, nodeExeAtLeast } = await import("harness");
  // Node.js refuses these resets since v26.11.0.
  const node = nodeExeAtLeast("26.11.0");

  describe("Node.js compatibility", () => {
    (node ? test : test.skip)("all tests pass in Node.js", async () => {
      // A direct run, not `node --test`: the runner mode forks a second node
      // process per file. node:test still exits non-zero on any failure.
      await using proc = Bun.spawn({
        cmd: [node!, "--v8-pool-size=1", fileURLToPath(import.meta.url)],
        env: { ...bunEnv, UV_THREADPOOL_SIZE: "2" },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      assert.deepStrictEqual({ exitCode, output: exitCode === 0 ? "" : stdout + stderr }, { exitCode: 0, output: "" });
    });
  });
}
