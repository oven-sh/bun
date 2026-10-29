// The `rejectGarbageAfterEnd` option of node:zlib.
// This file uses node:test and node:assert only, so Node.js runs it too:
//   node --test test/js/node/zlib/reject-garbage-after-end.test.ts
import assert from "node:assert";
import { describe, test } from "node:test";
import zlib from "node:zlib";

const trailingJunk = {
  name: "TypeError",
  code: "ERR_TRAILING_JUNK_AFTER_STREAM_END",
  message: "Trailing junk found after the end of the compressed stream",
};
const junk = Buffer.from("JUNK");

// The validation cases pass what the declarations of node:zlib do not allow, so the options have their own type here.
interface Options {
  rejectGarbageAfterEnd?: unknown;
  chunkSize?: number;
  finishFlush?: number;
  info?: boolean;
  maxOutputLength?: number;
  windowBits?: number;
}
const reject: Options = { rejectGarbageAfterEnd: true };
/** The native handle of a stream, with what `zlib.ts` keeps on it. */
interface Handle {
  constructor: new (mode: number) => Handle;
  buffer?: Buffer | null;
  init(...args: unknown[]): void;
  writeSync(
    flush: number,
    input: Buffer,
    inOff: number,
    inLen: number,
    out: Buffer,
    outOff: number,
    outLen: number,
  ): void;
  close(): void;
}
type Stream = zlib.Inflate & {
  _handle: Handle | null;
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
  /** True for gzip input: one more member is more of the same stream, unless the option is set. */
  members?: boolean;
  /** True for zstd: one more frame is more of the same stream, with the option too. */
  frames?: boolean;
}

// prettier-ignore
const decoders = [
  { name: "inflate", compress: zlib.deflateSync, sync: zlib.inflateSync, callback: zlib.inflate, create: zlib.createInflate },
  { name: "inflateRaw", compress: zlib.deflateRawSync, sync: zlib.inflateRawSync, callback: zlib.inflateRaw, create: zlib.createInflateRaw },
  { name: "gunzip", compress: zlib.gzipSync, sync: zlib.gunzipSync, callback: zlib.gunzip, create: zlib.createGunzip, members: true },
  { name: "unzip of gzip", compress: zlib.gzipSync, sync: zlib.unzipSync, callback: zlib.unzip, create: zlib.createUnzip, members: true },
  { name: "unzip of deflate", compress: zlib.deflateSync, sync: zlib.unzipSync, callback: zlib.unzip, create: zlib.createUnzip },
  { name: "brotliDecompress", compress: zlib.brotliCompressSync, sync: zlib.brotliDecompressSync, callback: zlib.brotliDecompress, create: zlib.createBrotliDecompress },
  { name: "zstdDecompress", compress: zlib.zstdCompressSync, sync: zlib.zstdDecompressSync, callback: zlib.zstdDecompress, create: zlib.createZstdDecompress, frames: true },
] as unknown as Decoder[];

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

async function assertRefused(decoder: Decoder, input: Buffer, options: Options) {
  assert.throws(() => decoder.sync(input, options), trailingJunk);
  await assert.rejects(viaCallback(decoder, input, options), trailingJunk);
  assert.deepStrictEqual((await viaStream(decoder.create(options), [input])).events, [trailingJunk.code]);
}

async function assertDecodes(decoder: Decoder, input: Buffer, options: Options | undefined, expected: string) {
  assert.strictEqual(decoder.sync(input, options).toString(), expected);
  assert.strictEqual((await viaCallback(decoder, input, options ?? {})).toString(), expected);
  const { output, events } = await viaStream(decoder.create(options), [input]);
  assert.deepStrictEqual({ output, events }, { output: expected, events: ["end"] });
}

// Node.js finds trailing input for zstd in its native decoder, which keeps the state of the frames across writes.
// Bun's zstd decoder keeps none yet (#33413), so for zstd Bun refuses what one write leaves and no more.
// A `todo` below is a zstd case that needs that state. It asserts what Node.js v26.12.1 gives.
const needsFrameState = (decoder: Decoder) => (decoder.frames ? test.todo : test);

describe("rejectGarbageAfterEnd: true", () => {
  for (const decoder of decoders) {
    const a = decoder.compress("a");
    const b = decoder.compress("b");

    describe(decoder.name, () => {
      test("decodes input that ends with the stream", async () => {
        await assertDecodes(decoder, a, reject, "a");
      });

      test("refuses bytes that are not a compressed stream", async () => {
        await assertRefused(decoder, Buffer.concat([a, junk]), reject);
      });

      test("refuses zero padding", async () => {
        await assertRefused(decoder, Buffer.concat([a, Buffer.alloc(4)]), reject);
      });

      test("refuses one more byte", async () => {
        await assertRefused(decoder, Buffer.concat([a, Buffer.from([1])]), reject);
      });

      if (decoder.frames) {
        test("decodes a second frame, and refuses bytes after it", async () => {
          await assertDecodes(decoder, Buffer.concat([a, b]), reject, "ab");
          await assertRefused(decoder, Buffer.concat([a, b, junk]), reject);
        });
      } else {
        test("refuses a second compressed stream", async () => {
          await assertRefused(decoder, Buffer.concat([a, b]), reject);
        });
      }

      needsFrameState(decoder)("refuses trailing input after output that fills the chunk exactly", async () => {
        const options = { ...reject, chunkSize: 64 };
        const text = Buffer.alloc(64, "z").toString();
        const input = Buffer.concat([decoder.compress(text), junk]);
        assert.throws(() => decoder.sync(input, options), trailingJunk);
        await assert.rejects(viaCallback(decoder, input, options), trailingJunk);
        const { output, events } = await viaStream(decoder.create(options), [input]);
        assert.deepStrictEqual({ output, events }, { output: text, events: [trailingJunk.code] });
      });

      test("refuses trailing input with info: true", () => {
        assert.throws(() => decoder.sync(Buffer.concat([a, junk]), { ...reject, info: true }), trailingJunk);
        const result = decoder.sync(a, { ...reject, info: true }) as unknown as { buffer: Buffer; engine: Stream };
        assert.strictEqual(result.buffer.toString(), "a");
        assert.strictEqual(result.engine._rejectGarbageAfterEnd, true);
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
      // Node's zstd decoder finds it in the native write, and that write gives nothing: no output, no callback, no count.
      needsFrameState(decoder)("a stream gives what it decoded, then the error, and no 'end'", async () => {
        const inWrite = decoder.frames
          ? { output: "", events: [trailingJunk.code], callbacks: ["not called"], bytesWritten: 0 }
          : { output: "a", events: [trailingJunk.code], callbacks: [trailingJunk.code], bytesWritten: a.length };
        assert.deepStrictEqual(await viaStream(decoder.create(reject), [Buffer.concat([a, junk])]), inWrite);

        for (const later of [junk, Buffer.alloc(4)]) {
          assert.deepStrictEqual(await viaStream(decoder.create(reject), [a, later]), {
            output: "a",
            events: [trailingJunk.code],
            callbacks: ["ok", decoder.frames ? "not called" : trailingJunk.code],
            bytesWritten: a.length,
          });
        }
      });

      needsFrameState(decoder)("reset() keeps the option", async () => {
        const stream = decoder.create(reject);
        const chunks: Buffer[] = [];
        const events: string[] = [];
        stream.on("data", chunk => chunks.push(chunk));
        stream.on("end", () => events.push("end"));
        stream.on("error", (error: NodeJS.ErrnoException) => events.push(String(error.code)));
        const closed = new Promise(resolve => stream.on("close", resolve));
        await new Promise(resolve => stream.write(a, resolve));
        stream.reset();
        stream.end(Buffer.concat([a, junk]));
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
    assert.throws(() => decoders[0].sync(valid, { ...stopsEarly, ...reject }), trailingJunk);
  });
});

describe("rejectGarbageAfterEnd unset or false", () => {
  for (const [label, options] of [
    ["no options", undefined],
    ["{}", {}],
    ["undefined", { rejectGarbageAfterEnd: undefined }],
    ["false", { rejectGarbageAfterEnd: false }],
  ] as const) {
    for (const decoder of decoders) {
      const a = decoder.compress("a");
      if (decoder.members) {
        test(`${decoder.name} decodes a second member and ignores zero padding (${label})`, async () => {
          await assertDecodes(decoder, Buffer.concat([a, decoder.compress("b")]), options, "ab");
          await assertDecodes(decoder, Buffer.concat([a, Buffer.alloc(4)]), options, "a");
          assert.throws(() => decoder.sync(Buffer.concat([a, junk]), options), { code: "Z_DATA_ERROR" });
        });
      } else {
        test(`${decoder.name} ignores trailing bytes (${label})`, async () => {
          await assertDecodes(decoder, Buffer.concat([a, junk]), options, "a");
        });
      }
    }
  }
});

describe("zstd frames", () => {
  const zstd = decoders.find(decoder => decoder.frames)!;
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

  for (const options of [undefined, reject]) {
    const label = options ? "with the option" : "without the option";

    test(`a skippable frame after a frame is not trailing input (${label})`, async () => {
      for (const magic of [0x184d2a50, 0x184d2a5a, 0x184d2a5f]) {
        await assertDecodes(zstd, Buffer.concat([a, skippable(magic), b]), options, "ab");
        await assertDecodes(zstd, Buffer.concat([a, skippable(magic)]), options, "a");
      }
    });

    test(`a frame may begin in one write and go on in the next (${label})`, async () => {
      for (let split = 1; split < b.length; split++) {
        const { output, events } = await viaStream(zstd.create(options), [a, b.subarray(0, split), b.subarray(split)]);
        assert.deepStrictEqual({ output, events }, { output: "ab", events: ["end"] }, `split at byte ${split}`);
      }
    });

    test(`bytes before the first frame are a zstd error (${label})`, async () => {
      assert.throws(() => zstd.sync(junk, options), { name: "Error", code: "ZSTD_error_prefix_unknown" });
      assert.deepStrictEqual((await viaStream(zstd.create(options), [junk, a])).events, ["ZSTD_error_prefix_unknown"]);
    });
  }

  test.todo("1 to 3 bytes of a frame magic number after a frame are trailing input", async () => {
    for (let length = 1; length <= 3; length++) {
      const input = Buffer.concat([a, b.subarray(0, length)]);
      await assertRefused(zstd, input, reject);
      // The decoder can tell only at the end of the input, so the write before gave the data.
      const { output, events } = await viaStream(zstd.create(reject), [a, b.subarray(0, length)]);
      assert.deepStrictEqual({ output, events }, { output: "a", events: [trailingJunk.code] });
    }
  });

  test.todo("a frame magic number that a later write breaks is trailing input", async () => {
    const { output, events } = await viaStream(zstd.create(reject), [a, b.subarray(0, 2), junk]);
    assert.deepStrictEqual({ output, events }, { output: "a", events: [trailingJunk.code] });
  });

  // Node.js refuses this with or without the option.
  test.todo("a frame that is cut after its magic number is an error", async () => {
    for (const options of [undefined, reject]) {
      for (const length of [4, b.length - 1]) {
        const input = Buffer.concat([a, b.subarray(0, length)]);
        assert.throws(() => zstd.sync(input, options), { name: "Error", code: "Z_BUF_ERROR" });
        assert.deepStrictEqual((await viaStream(zstd.create(options), [input])).events, ["Z_BUF_ERROR"]);
      }
    }
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
      for (const value of [undefined, false, true]) {
        const stream = create({ rejectGarbageAfterEnd: value });
        assert.deepStrictEqual(Object.getOwnPropertyDescriptor(stream, "_rejectGarbageAfterEnd"), {
          value: value === true,
          writable: true,
          enumerable: true,
          configurable: true,
        });
        stream.destroy();
      }
    });
  }

  test("the convenience methods validate it", () => {
    const invalid = { name: "TypeError", code: "ERR_INVALID_ARG_TYPE" };
    for (const decoder of decoders) {
      const a = decoder.compress("a");
      assert.throws(() => decoder.sync(a, { rejectGarbageAfterEnd: "yes" }), invalid);
      assert.throws(() => decoder.callback(a, { rejectGarbageAfterEnd: "yes" }, () => {}), invalid);
      assert.throws(() => decoder.compress("a", { rejectGarbageAfterEnd: 1 }), invalid);
    }
  });

  test("the options checked before it fail first", () => {
    const outOfRange = { name: "RangeError", code: "ERR_OUT_OF_RANGE" };
    const invalid: Options = { rejectGarbageAfterEnd: "yes" };
    for (const decoder of decoders) {
      assert.throws(() => decoder.create({ ...invalid, chunkSize: 1 }), outOfRange);
      assert.throws(() => decoder.create({ ...invalid, maxOutputLength: 0 }), outOfRange);
    }
    assert.throws(() => decoders[0].create({ ...invalid, windowBits: 99 }), outOfRange);
  });

  test("a compressor takes the option, and its output decodes to the input", () => {
    for (const decoder of decoders) {
      assert.strictEqual(decoder.sync(decoder.compress("a", reject)).toString(), "a");
    }
  });
});

// What Bun does where Node.js does something else, or nothing. Node.js skips these.
(process.versions.bun ? describe : describe.skip)("in Bun", () => {
  for (const decoder of decoders.filter(decoder => !decoder.frames)) {
    // Node.js leaves the chunk there.
    test(`${decoder.name} holds no input on its handle after the error`, async () => {
      const stream = decoder.create(reject);
      const handle = stream._handle!;
      const { events } = await viaStream(stream, [Buffer.concat([decoder.compress("a"), junk])]);
      assert.deepStrictEqual({ events, buffer: handle.buffer }, { events: [trailingJunk.code], buffer: null });
    });
  }

  test("the last argument of the native init stops a gzip handle at the end of the first member", () => {
    const gunzip = decoders.find(decoder => decoder.name === "gunzip")!.create();
    const NativeZlib = gunzip._handle!.constructor;
    gunzip.destroy();
    const b = zlib.gzipSync("b");
    const input = Buffer.concat([zlib.gzipSync("a"), b]);
    const decode = (...last: unknown[]) => {
      const handle = new NativeZlib(zlib.constants.GUNZIP);
      const writeState = new Uint32Array(2);
      handle.init(15, 6, 8, 0, writeState, () => {}, undefined, ...last);
      const out = Buffer.alloc(16);
      handle.writeSync(zlib.constants.Z_FINISH, input, 0, input.length, out, 0, out.length);
      handle.close();
      return { output: out.subarray(0, out.length - writeState[0]).toString(), inputLeft: writeState[1] };
    };
    const both = { output: "ab", inputLeft: 0 };
    assert.deepStrictEqual([decode(), decode(undefined), decode(false)], [both, both, both]);
    assert.deepStrictEqual(decode(true), { output: "a", inputLeft: b.length });
    // Node.js aborts on a last argument that is no boolean.
    for (const value of ["yes", 1, null, {}]) {
      assert.throws(() => decode(value), { name: "TypeError", code: "ERR_INVALID_ARG_TYPE" });
    }
  });

  // Node.js refuses each of these (the `todo` cases above).
  test("zstd input after a frame that the option does not catch yet", async () => {
    const zstd = decoders.find(decoder => decoder.frames)!;
    const a = zlib.zstdCompressSync("a");
    const b = zlib.zstdCompressSync("b");
    // Bytes that start no frame are refused with the code of zstd, if they come in a native write of their own.
    const unknown = { name: "Error", code: "ZSTD_error_prefix_unknown" };
    assert.deepStrictEqual((await viaStream(zstd.create(reject), [a, junk])).events, [unknown.code]);
    const fillsChunk = Buffer.concat([zlib.zstdCompressSync(Buffer.alloc(64, "z")), junk]);
    assert.throws(() => zstd.sync(fillsChunk, { ...reject, chunkSize: 64 }), unknown);
    // The first bytes of a frame with nothing after them are accepted.
    for (const length of [1, 2, 3, 4]) {
      await assertDecodes(zstd, Buffer.concat([a, b.subarray(0, length)]), reject, "a");
    }
  });
});
