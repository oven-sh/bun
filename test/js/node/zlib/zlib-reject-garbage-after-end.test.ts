// The `rejectGarbageAfterEnd` option of node:zlib, beyond what Node's test-zlib-reject-garbage-after-end.js pins:
// what a stream gives before the error, input that comes in a later write, and the validation of each class.
// This file uses node:test and node:assert only, so Node.js runs it too:
//   node --test test/js/node/zlib/zlib-reject-garbage-after-end.test.ts
// Each expectation is what Node.js v26.12.1 gives.
import assert from "node:assert";
import { describe, test } from "node:test";
import zlib from "node:zlib";

const trailingJunk = {
  name: "TypeError",
  code: "ERR_TRAILING_JUNK_AFTER_STREAM_END",
  message: "Trailing junk found after the end of the compressed stream",
};
const unexpectedEnd = { name: "Error", code: "Z_BUF_ERROR", message: "unexpected end of file" };
const junk = Buffer.from("JUNK");
const zeros = Buffer.alloc(4);

// The validation cases pass what the declarations of node:zlib do not allow, so the options have their own type here.
interface Options {
  rejectGarbageAfterEnd?: unknown;
  chunkSize?: number;
  finishFlush?: number;
  maxOutputLength?: number;
  autoDestroy?: boolean;
}
const reject: Options = { rejectGarbageAfterEnd: true };
type Stream = zlib.Inflate & {
  _handle: object | null;
  _rejectGarbageAfterEnd: boolean;
  _finishFlushFlag: number;
  _processChunk(chunk: Buffer, flushFlag: number): Buffer;
};
interface Decoder {
  name: string;
  compress(input: string, options?: Options): Buffer;
  sync(input: Buffer, options?: Options): Buffer;
  callback(input: Buffer, options: Options, callback: (error: Error | null, result: Buffer) => void): void;
  create(options?: Options): Stream;
  /** True for zstd: one more frame is more of the same stream, with the option too. */
  frames?: boolean;
}

// prettier-ignore
const decoders = [
  { name: "inflate", compress: zlib.deflateSync, sync: zlib.inflateSync, callback: zlib.inflate, create: zlib.createInflate },
  { name: "inflateRaw", compress: zlib.deflateRawSync, sync: zlib.inflateRawSync, callback: zlib.inflateRaw, create: zlib.createInflateRaw },
  { name: "gunzip", compress: zlib.gzipSync, sync: zlib.gunzipSync, callback: zlib.gunzip, create: zlib.createGunzip },
  { name: "unzip of gzip", compress: zlib.gzipSync, sync: zlib.unzipSync, callback: zlib.unzip, create: zlib.createUnzip },
  { name: "unzip of deflate", compress: zlib.deflateSync, sync: zlib.unzipSync, callback: zlib.unzip, create: zlib.createUnzip },
  { name: "brotliDecompress", compress: zlib.brotliCompressSync, sync: zlib.brotliDecompressSync, callback: zlib.brotliDecompress, create: zlib.createBrotliDecompress },
  { name: "zstdDecompress", compress: zlib.zstdCompressSync, sync: zlib.zstdDecompressSync, callback: zlib.zstdDecompress, create: zlib.createZstdDecompress, frames: true },
] as unknown as Decoder[];
const [inflate] = decoders;
const zstd = decoders.find(decoder => decoder.frames)!;

function viaCallback(decoder: Decoder, input: Buffer, options: Options): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    decoder.callback(input, options, (error, result) => (error ? reject(error) : resolve(result)));
  });
}

interface Seen {
  output: string;
  /** "end", or the code of the error. */
  events: string[];
  /** For each write in turn: "ok", the code of the error its callback got, or "not called". */
  callbacks: string[];
  bytesWritten: number;
}

/** Gives each input to the stream as one write, ends it with the last, and resolves after 'close' with what the stream did. */
function viaStream(stream: Stream, inputs: Buffer[]): Promise<Seen> {
  return new Promise(resolve => {
    const chunks: Buffer[] = [];
    const events: string[] = [];
    const callbacks = inputs.map(() => "not called");
    stream.on("data", chunk => chunks.push(chunk));
    stream.on("end", () => events.push("end"));
    stream.on("error", (error: NodeJS.ErrnoException) => events.push(String(error.code)));
    stream.on("close", () => {
      // A write callback that is still to come runs before this.
      setImmediate(() => {
        resolve({ output: Buffer.concat(chunks).toString(), events, callbacks, bytesWritten: stream.bytesWritten });
      });
    });
    inputs.forEach((input, i) => {
      const callback = (error?: NodeJS.ErrnoException | null) => (callbacks[i] = error ? String(error.code) : "ok");
      if (i === inputs.length - 1) stream.end(input, callback);
      else stream.write(input, callback);
    });
  });
}

/** The sync form throws `expected`, the callback form gets it, and a stream emits it and no 'end'. */
async function assertFails(decoder: Decoder, input: Buffer, options: Options | undefined, expected: { code: string }) {
  assert.throws(() => decoder.sync(input, options), expected);
  await assert.rejects(viaCallback(decoder, input, options ?? {}), expected);
  assert.deepStrictEqual((await viaStream(decoder.create(options), [input])).events, [expected.code]);
}

async function assertDecodes(decoder: Decoder, input: Buffer, options: Options | undefined, expected: string) {
  assert.strictEqual(decoder.sync(input, options).toString(), expected);
  assert.strictEqual((await viaCallback(decoder, input, options ?? {})).toString(), expected);
  const { output, events } = await viaStream(decoder.create(options), [input]);
  assert.deepStrictEqual({ output, events }, { output: expected, events: ["end"] });
}

describe("rejectGarbageAfterEnd: true", () => {
  for (const decoder of decoders) {
    const a = decoder.compress("a");
    const b = decoder.compress("b");
    // A second zstd frame is not trailing input.
    const second = decoder.frames ? Buffer.concat([b, junk]) : b;

    describe(decoder.name, () => {
      test("decodes input that ends with the stream, and refuses one more byte", async () => {
        await assertDecodes(decoder, a, reject, "a");
        // Output that fills a chunk while input is left is not trailing input.
        const text = Buffer.alloc(65, "z").toString();
        await assertDecodes(decoder, decoder.compress(text), { ...reject, chunkSize: 64 }, text);
        if (decoder.frames) await assertDecodes(decoder, Buffer.concat([a, b]), reject, "ab");
        await assertFails(decoder, Buffer.concat([a, Buffer.from([1])]), reject, trailingJunk);
      });

      test("refuses bytes that are not a compressed stream", async () => {
        await assertFails(decoder, Buffer.concat([a, junk]), reject, trailingJunk);
      });

      test("refuses zero padding", async () => {
        await assertFails(decoder, Buffer.concat([a, zeros]), reject, trailingJunk);
      });

      test(decoder.frames ? "refuses bytes after a second frame" : "refuses a second compressed stream", async () => {
        await assertFails(decoder, Buffer.concat([a, second]), reject, trailingJunk);
      });

      test("refuses trailing input after output that fills the chunk exactly", async () => {
        const options = { ...reject, chunkSize: 64 };
        const text = Buffer.alloc(64, "z").toString();
        const input = Buffer.concat([decoder.compress(text), junk]);
        assert.throws(() => decoder.sync(input, options), trailingJunk);
        await assert.rejects(viaCallback(decoder, input, options), trailingJunk);
        const { output, events } = await viaStream(decoder.create(options), [input]);
        assert.deepStrictEqual({ output, events }, { output: text, events: [trailingJunk.code] });
        // Too much output is found first.
        assert.throws(() => decoder.sync(input, { ...options, maxOutputLength: 63 }), { code: "ERR_BUFFER_TOO_LARGE" });
      });

      test("the sync form closes the handle before it throws", () => {
        const engine = decoder.create(reject);
        assert.throws(() => engine._processChunk(Buffer.concat([a, junk]), engine._finishFlushFlag), trailingJunk);
        assert.deepStrictEqual(
          { handle: engine._handle, bytesWritten: engine.bytesWritten },
          { handle: null, bytesWritten: 0 },
        );
      });

      // The JS driver finds the trailing input for zlib and brotli, after it gave out what the write decoded.
      // The zstd decoder finds it in the native write, and that write gives nothing: no output, no callback, no count.
      test("a stream gives what the earlier writes decoded, then the error, and no 'end'", async () => {
        const inWrite = decoder.frames
          ? { output: "", events: [trailingJunk.code], callbacks: ["not called"], bytesWritten: 0 }
          : { output: "a", events: [trailingJunk.code], callbacks: [trailingJunk.code], bytesWritten: a.length };
        assert.deepStrictEqual(await viaStream(decoder.create(reject), [Buffer.concat([a, junk])]), inWrite);

        for (const later of decoder.frames ? [junk, zeros] : [junk, zeros, b]) {
          assert.deepStrictEqual(await viaStream(decoder.create(reject), [a, later]), {
            output: "a",
            events: [trailingJunk.code],
            callbacks: ["ok", decoder.frames ? "not called" : trailingJunk.code],
            bytesWritten: a.length,
          });
        }
      });

      // end() gives its callback the error of the stream whatever the driver does. A write() shows what the driver gives.
      test("the write that left trailing input gets the error, from a stream that is destroyed by then", async () => {
        const stream = decoder.create({ ...reject, autoDestroy: false });
        const seen = await new Promise(resolve => {
          stream.on("error", () => {}).on("close", () => setImmediate(resolve, "not called"));
          stream.write(Buffer.concat([a, junk]), (error?: NodeJS.ErrnoException | null) => {
            resolve([error?.code, stream.destroyed, stream._handle]);
          });
        });
        assert.deepStrictEqual(seen, decoder.frames ? "not called" : [trailingJunk.code, true, null]);
      });

      test("reset() keeps the option", async () => {
        const stream = decoder.create(reject);
        const chunks: Buffer[] = [];
        const events: string[] = [];
        stream.on("data", chunk => chunks.push(chunk));
        stream.on("end", () => events.push("end"));
        stream.on("error", (error: NodeJS.ErrnoException) => events.push(String(error.code)));
        const closed = new Promise(resolve => stream.on("close", resolve));
        await new Promise(resolve => stream.write(a, resolve));
        stream.reset();
        stream.end(Buffer.concat([a, second]));
        await closed;
        assert.deepStrictEqual(
          { output: Buffer.concat(chunks).toString(), events },
          { output: decoder.frames ? "a" : "aa", events: [trailingJunk.code] },
        );
      });
    });
  }

  // The check is "a write left input and had output space", so it also refuses valid input that a flush stops early.
  test("a finishFlush that stops before the end of the input is refused too", () => {
    const valid = zlib.deflateSync("hello");
    const stopsEarly = { finishFlush: zlib.constants.Z_BLOCK };
    assert.strictEqual(zlib.inflateSync(valid, stopsEarly).toString(), "");
    assert.throws(() => inflate.sync(valid, { ...stopsEarly, ...reject }), trailingJunk);
  });
});

describe("zstd frames with rejectGarbageAfterEnd: true", () => {
  const a = zlib.zstdCompressSync("a");
  const b = zlib.zstdCompressSync("b");
  // A skippable frame: a magic number from 0x184D2A50 to 0x184D2A5F, the size of its content, and the content.
  const skippable = (magic: number) => {
    const frame = Buffer.alloc(12);
    frame.writeUInt32LE(magic, 0);
    frame.writeUInt32LE(4, 4);
    frame.write("meta", 8);
    return frame;
  };

  test("1 to 3 bytes of a frame magic number after a frame are trailing input, and 4 are an unexpected end", async () => {
    for (const start of [b, skippable(0x184d2a50), skippable(0x184d2a5f)]) {
      for (let length = 1; length <= 3; length++) {
        const input = Buffer.concat([a, start.subarray(0, length)]);
        await assertDecodes(zstd, input, undefined, "a");
        await assertFails(zstd, input, reject, trailingJunk);
        // The decoder can tell only at the end of the input, so the write before gave the data.
        assert.deepStrictEqual(await viaStream(zstd.create(reject), [input]), {
          output: "a",
          events: [trailingJunk.code],
          callbacks: ["ok"],
          bytesWritten: input.length,
        });
      }
      await assertFails(zstd, Buffer.concat([a, start.subarray(0, 4)]), reject, unexpectedEnd);
      await assertFails(zstd, Buffer.concat([a, start.subarray(0, -1)]), reject, unexpectedEnd);
    }
  });

  test("a frame magic number that a later write breaks is trailing input", async () => {
    for (const breaks of [junk, Buffer.alloc(1)]) {
      const writes = [a, b.subarray(0, 2), breaks];
      assert.deepStrictEqual(await viaStream(zstd.create(reject), writes), {
        output: "a",
        events: [trailingJunk.code],
        callbacks: ["ok", "ok", "not called"],
        bytesWritten: a.length + 2,
      });
      const { output, events } = await viaStream(zstd.create(), writes);
      assert.deepStrictEqual({ output, events }, { output: "a", events: ["end"] });
    }
  });

  test("bytes after a skippable frame are trailing input, and bytes before the first frame are a zstd error", async () => {
    const input = Buffer.concat([a, skippable(0x184d2a50), junk]);
    await assertFails(zstd, input, reject, trailingJunk);
    await assertDecodes(zstd, input, undefined, "a");
    await assertFails(zstd, junk, reject, { name: "Error", code: "ZSTD_error_prefix_unknown" });
  });
});

describe("validation", () => {
  // prettier-ignore
  const classes = [
    zlib.createDeflate, zlib.createInflate, zlib.createDeflateRaw, zlib.createInflateRaw, zlib.createGzip, zlib.createGunzip,
    zlib.createUnzip, zlib.createBrotliCompress, zlib.createBrotliDecompress, zlib.createZstdCompress, zlib.createZstdDecompress,
  ] as unknown as ((options: Options) => Stream)[];

  for (const create of classes) {
    test(`${create.name} takes a boolean or undefined only`, () => {
      for (const [value, received] of [
        [1, "type number (1)"],
        [0, "type number (0)"],
        ["true", "type string ('true')"],
        [null, "null"],
        [{}, "an instance of Object"],
      ] as const) {
        assert.throws(() => create({ rejectGarbageAfterEnd: value }), {
          name: "TypeError",
          code: "ERR_INVALID_ARG_TYPE",
          message: `The "options.rejectGarbageAfterEnd" property must be of type boolean. Received ${received}`,
        });
      }
      // The options that are checked before it fail first.
      const outOfRange = { name: "RangeError", code: "ERR_OUT_OF_RANGE" };
      assert.throws(() => create({ rejectGarbageAfterEnd: "yes", chunkSize: 1 }), outOfRange);
      assert.throws(() => create({ rejectGarbageAfterEnd: "yes", maxOutputLength: 0 }), outOfRange);

      for (const value of [undefined, false, true]) {
        const stream = create({ rejectGarbageAfterEnd: value });
        assert.strictEqual(stream._rejectGarbageAfterEnd, value === true);
        stream.destroy();
      }
      assert.deepStrictEqual(Object.getOwnPropertyDescriptor(create(reject), "_rejectGarbageAfterEnd"), {
        value: true,
        writable: true,
        enumerable: true,
        configurable: true,
      });
    });
  }

  test("the convenience methods validate it, and a compressor takes it", () => {
    const invalid = { name: "TypeError", code: "ERR_INVALID_ARG_TYPE" };
    for (const decoder of decoders) {
      const a = decoder.compress("a", reject);
      assert.strictEqual(decoder.sync(a).toString(), "a");
      assert.throws(() => decoder.sync(a, { rejectGarbageAfterEnd: "yes" }), invalid);
      assert.throws(() => decoder.callback(a, { rejectGarbageAfterEnd: "yes" }, () => {}), invalid);
      assert.throws(() => decoder.compress("a", { rejectGarbageAfterEnd: 1 }), invalid);
    }
  });

  test("false and undefined leave the option off", () => {
    for (const options of [{ rejectGarbageAfterEnd: false }, { rejectGarbageAfterEnd: undefined }]) {
      for (const decoder of decoders) {
        assert.strictEqual(decoder.create(options)._rejectGarbageAfterEnd, false);
        assert.strictEqual(decoder.sync(Buffer.concat([decoder.compress("a"), zeros]), options).toString(), "a");
      }
      const [member, frame] = [zlib.gzipSync("b"), zlib.zstdCompressSync("b")];
      assert.strictEqual(zlib.gunzipSync(Buffer.concat([zlib.gzipSync("a"), member]), options).toString(), "ab");
      assert.strictEqual(zstd.sync(Buffer.concat([zstd.compress("a"), frame, junk]), options).toString(), "ab");
    }
  });

  // The JS driver reads the property at each write. The native flag of gzip and zstd is fixed at construction.
  test("a later write to _rejectGarbageAfterEnd turns the check of the JS driver on and off", async () => {
    const input = Buffer.concat([zlib.deflateSync("a"), junk]);
    for (const [options, later, events] of [
      [undefined, true, [trailingJunk.code]],
      [reject, false, ["end"]],
    ] as const) {
      const stream = inflate.create(options);
      stream._rejectGarbageAfterEnd = later;
      assert.deepStrictEqual((await viaStream(stream, [input])).events, events);

      const engine = inflate.create(options);
      engine._rejectGarbageAfterEnd = later;
      const sync = () => engine._processChunk(input, engine._finishFlushFlag).toString();
      if (later) assert.throws(sync, trailingJunk);
      else assert.strictEqual(sync(), "a");
    }
  });
});
