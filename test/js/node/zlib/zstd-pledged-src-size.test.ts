/**
 * All tests in this file run in both Bun and Node.js: `bun test` runs them
 * here, and the last test runs this same file under Node.js. So the file uses
 * `node:test` and `node:assert`, not `bun:test`. It loads the harness only in
 * Bun, and it starts a child process with `process.execPath`, which is the
 * runtime that runs the file.
 *
 * `pledgedSrcSize` of the zstd compressor, as Node.js v26.12.1 has it:
 * - The input of the first frame is compared with the pledge when that frame
 *   ends (nodejs/node#64601, v26.8.0). zstd itself does not compare when the
 *   first call of a frame also ends it, nor for a frame of several worker jobs.
 * - The option is undefined or a non-negative safe integer (nodejs/node#64604,
 *   v26.7.0).
 * - zlib.zstdCompress() pledges the size of its input (nodejs/node#66358,
 *   v26.11.0).
 * - An ArrayBuffer `dictionary` is loaded (nodejs/node#64599), so a dictionary
 *   that zstd rejects fails the constructor for it too.
 */
import assert from "node:assert";
import { execFile } from "node:child_process";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import zlib from "node:zlib";

const { ZSTD_e_flush, ZSTD_e_end, ZSTD_c_nbWorkers, ZSTD_c_jobSize } = zlib.constants;

// Only in Bun: Node.js cannot load the harness.
const harness = typeof Bun !== "undefined" ? await import("harness") : null;

// @types/node declares no `pledgedSrcSize` and no ArrayBuffer `dictionary`, and the validation tests pass values of every type.
type Options = Omit<zlib.ZstdOptions, "dictionary"> & {
  pledgedSrcSize?: unknown;
  defaultEncoding?: string;
  dictionary?: unknown;
};
// The stream methods that these tests call and @types/node does not declare.
type Compressor = zlib.ZstdCompress & { reset(): void; _processChunk(chunk: Buffer, flushFlag: number): Buffer };

const createCompress = (options: Options) => zlib.createZstdCompress(options as zlib.ZstdOptions) as Compressor;
const compressSync = (input: string | Buffer, options: Options) =>
  zlib.zstdCompressSync(input, options as zlib.ZstdOptions);
// No element: the call has no `options` argument.
function compress(
  input: string | ArrayBuffer | Buffer,
  ...options: [] | [Options | null | undefined]
): Promise<Buffer> {
  const { promise, resolve, reject } = Promise.withResolvers<Buffer>();
  const callback = (error: Error | null, frame: Buffer) => (error ? reject(error) : resolve(frame));
  if (options.length === 0) zlib.zstdCompress(input, callback);
  else zlib.zstdCompress(input, options[0] as zlib.ZstdOptions, callback);
  return promise;
}

const srcSizeWrong = {
  name: "Error",
  code: "ZSTD_error_srcSize_wrong",
  errno: zlib.constants.ZSTD_error_srcSize_wrong,
  message: "Src size is incorrect",
};
const notANumber = "TypeError ERR_INVALID_ARG_TYPE: pledgedSrcSize must be a number";
const notASafeInteger = "RangeError ERR_OUT_OF_RANGE: pledgedSrcSize must be a safe integer";
const negative = "RangeError ERR_OUT_OF_RANGE: pledgedSrcSize must be non-negative";

const data = Buffer.alloc(64, "a");
// zstd cannot compress these bytes, so with a small chunkSize one write takes many native calls.
const noise = Buffer.alloc(256 * 1024);
for (let i = 0, state = 0x12345678; i < noise.length; i++) {
  state = (Math.imul(state, 1664525) + 1013904223) | 0;
  noise[i] = state >>> 24;
}
// The magic number of a zstd dictionary, with no valid tables after it. zstd rejects it.
const rejectedDictionary = Buffer.alloc(64, "A");
rejectedDictionary.writeUInt32LE(0xec30a437, 0);
const loadFailed = {
  name: "Error",
  code: "ERR_ZLIB_INITIALIZATION_FAILED",
  message: "Failed to load zstd dictionary",
};

// https://github.com/facebook/zstd/blob/dev/doc/zstd_compression_format.md#frame_header
// magic(4) | frame header descriptor(1) | [window descriptor(1)] | [dictionary id] | [frame content size]
function frameContentSize(frame: Buffer): number | null {
  assert.strictEqual(frame.readUInt32LE(0), 0xfd2fb528);
  const descriptor = frame[4];
  const singleSegment = (descriptor >> 5) & 1;
  const offset = 5 + (singleSegment ? 0 : 1) + [0, 1, 2, 4][descriptor & 0b11];
  switch (descriptor >> 6) {
    case 0:
      return singleSegment ? frame[offset] : null;
    case 1:
      return frame.readUInt16LE(offset) + 256;
    case 2:
      return frame.readUInt32LE(offset);
    default:
      return Number(frame.readBigUInt64LE(offset));
  }
}

// Resolves with everything the stream produces. Rejects with the error that the stream emits.
function collect(stream: Compressor, drive: (stream: Compressor) => void): Promise<Buffer> {
  const { promise, resolve, reject } = Promise.withResolvers<Buffer>();
  const chunks: Buffer[] = [];
  stream.on("data", chunk => chunks.push(chunk));
  stream.on("error", reject);
  stream.on("end", () => resolve(Buffer.concat(chunks)));
  drive(stream);
  return promise;
}
// Writes the chunks one after the other, then ends the stream. A write that fails stops it.
const writeAll = (chunks: Buffer[]) => (stream: Compressor) => {
  let index = 0;
  const next = (error?: Error | null) => {
    if (error) return;
    if (index === chunks.length) stream.end();
    else stream.write(chunks[index++], next);
  };
  next();
};
// One chunk of `data` per length.
const write = (...lengths: number[]) => writeAll(lengths.map(length => data.subarray(0, length)));

function outcome(run: () => unknown): string {
  try {
    run();
    return "no error";
  } catch (error) {
    const { name, code, message } = error as NodeJS.ErrnoException;
    return `${name} ${code}: ${message}`;
  }
}

describe("zstd pledgedSrcSize is compared with the input of the first frame", () => {
  for (const [pledgedSrcSize, length] of [
    [0, 42],
    [1, 42],
    [42, 0],
    [42, 13],
    [63, 64],
    [65, 64],
  ]) {
    test(`zstdCompressSync throws for a pledge of ${pledgedSrcSize} and ${length} bytes`, () => {
      assert.throws(() => compressSync(data.subarray(0, length), { pledgedSrcSize }), srcSizeWrong);
    });
  }

  test("zstdCompressSync accepts the exact pledge", () => {
    assert.strictEqual(frameContentSize(compressSync(data, { pledgedSrcSize: 64 })), 64);
    assert.strictEqual(frameContentSize(compressSync("", { pledgedSrcSize: 0 })), 0);
  });

  test("counts the input of every native call of one write", () => {
    const options = (pledgedSrcSize: number) => ({ pledgedSrcSize, chunkSize: 64 });
    assert.ok(zlib.zstdDecompressSync(compressSync(noise, options(noise.length))).equals(noise));
    assert.throws(() => compressSync(noise, options(noise.length - 1)), srcSizeWrong);
    assert.throws(() => compressSync(noise, options(noise.length + 1)), srcSizeWrong);
  });

  test("_processChunk() with ZSTD_e_end", () => {
    assert.throws(() => createCompress({ pledgedSrcSize: 10 })._processChunk(data, ZSTD_e_end), srcSizeWrong);
    assert.strictEqual(frameContentSize(createCompress({ pledgedSrcSize: 64 })._processChunk(data, ZSTD_e_end)), 64);
  });

  test("a frame that does not end is not compared", () => {
    const frame = compressSync(data.subarray(0, 10), { pledgedSrcSize: 64, finishFlush: ZSTD_e_flush });
    assert.strictEqual(frameContentSize(frame), 64);
  });

  test("end() with no data", async () => {
    await assert.rejects(collect(createCompress({ pledgedSrcSize: 42 }), write()), srcSizeWrong);
    assert.strictEqual(frameContentSize(await collect(createCompress({ pledgedSrcSize: 0 }), write())), 0);
  });

  test("writes that do not end the frame add up", async () => {
    const frame = await collect(createCompress({ pledgedSrcSize: 42 }), write(20, 22));
    assert.deepStrictEqual(zlib.zstdDecompressSync(frame), data.subarray(0, 42));
    await assert.rejects(collect(createCompress({ pledgedSrcSize: 42 }), write(20, 21)), srcSizeWrong);
  });

  test("a stream with flush: ZSTD_e_end compares its first frame only", async () => {
    const options = { pledgedSrcSize: 64, flush: ZSTD_e_end };
    // Each write is a frame. The second frame has 10 bytes and is not compared.
    const frames = await collect(createCompress(options), write(64, 10));
    assert.strictEqual(frameContentSize(frames), 64);
    assert.deepStrictEqual(zlib.zstdDecompressSync(frames), Buffer.alloc(74, "a"));
    await assert.rejects(collect(createCompress(options), write(10, 64)), srcSizeWrong);
  });

  test("flush(ZSTD_e_end) before any data", async () => {
    const drive = (stream: Compressor) => stream.flush(ZSTD_e_end, () => stream.end());
    await assert.rejects(collect(createCompress({ pledgedSrcSize: 42 }), drive), srcSizeWrong);
    const frames = await collect(createCompress({ pledgedSrcSize: 0 }), drive);
    assert.strictEqual(frameContentSize(frames), 0);
    assert.strictEqual(zlib.zstdDecompressSync(frames).length, 0);
  });

  describe("reset()", () => {
    const resetThen = (drive: (stream: Compressor) => void) => (stream: Compressor) => {
      stream.reset();
      drive(stream);
    };
    // Writes `first` bytes, calls reset() when that write is over, then writes `second` bytes and ends.
    const resetBetween = (first: number, second: number) => (stream: Compressor) => {
      stream.write(data.subarray(0, first), error => {
        if (error) return;
        stream.reset();
        write(second)(stream);
      });
    };

    test("before the first write keeps the pledge", async () => {
      const stream = createCompress({ pledgedSrcSize: 10 });
      stream.reset();
      assert.throws(() => stream._processChunk(data, ZSTD_e_end), srcSizeWrong);

      await assert.rejects(collect(createCompress({ pledgedSrcSize: 64 }), resetThen(write())), srcSizeWrong);
      const frame = await collect(createCompress({ pledgedSrcSize: 64 }), resetThen(write(64)));
      assert.strictEqual(frameContentSize(frame), 64);
    });

    test("after a frame applies the pledge to the next frame", async () => {
      const options = { pledgedSrcSize: 64, flush: ZSTD_e_end };
      const frames = await collect(createCompress(options), resetBetween(64, 64));
      assert.strictEqual(frameContentSize(frames), 64);
      assert.deepStrictEqual(zlib.zstdDecompressSync(frames), Buffer.alloc(128, "a"));
      await assert.rejects(collect(createCompress(options), resetBetween(64, 10)), srcSizeWrong);
    });

    test("in a frame that has no output yet drops the input before it", async () => {
      const options = { pledgedSrcSize: 64 };
      const frame = await collect(createCompress(options), resetBetween(5, 64));
      assert.deepStrictEqual(zlib.zstdDecompressSync(frame), data);
      await assert.rejects(collect(createCompress(options), resetBetween(5, 5)), srcSizeWrong);
    });
  });

  // With workers, zstd compares the pledge with the first job only. For a frame of several jobs the
  // header then holds the pledge, and a pledge below the input gives a frame that does not decompress.
  for (const workers of [0, 1]) {
    test(`with ZSTD_c_nbWorkers ${workers}`, async () => {
      const jobSize = 512 * 1024;
      const input = Buffer.concat([noise, noise, noise, noise]);
      const chunks: Buffer[] = [];
      for (let offset = 0; offset < input.length; offset += 64 * 1024) {
        chunks.push(input.subarray(offset, offset + 64 * 1024));
      }
      const compressStream = (pledgedSrcSize: number) =>
        collect(
          createCompress({
            pledgedSrcSize,
            // With ZSTD_e_continue a stream with workers can end before it has read all input (nodejs/node#59899).
            flush: ZSTD_e_flush,
            params: { [ZSTD_c_nbWorkers]: workers, [ZSTD_c_jobSize]: jobSize },
          }),
          writeAll(chunks),
        );

      const frame = await compressStream(input.length);
      assert.strictEqual(frameContentSize(frame), input.length);
      assert.ok(zlib.zstdDecompressSync(frame).equals(input));
      await assert.rejects(compressStream(input.length - 1), srcSizeWrong);
      await assert.rejects(compressStream(input.length + 1), srcSizeWrong);
      // More than one job, so the workers stay in use.
      await assert.rejects(compressStream(jobSize + jobSize / 2), srcSizeWrong);
    });
  }
});

describe("zstd pledgedSrcSize is written to the frame header", () => {
  // A frame that finishes with ZSTD_e_flush is never compared, so these can pledge 4 GiB for 64 bytes.
  const flushOnly = (pledgedSrcSize: number) => ({ pledgedSrcSize, finishFlush: ZSTD_e_flush });

  test("unmodified, also at 4 GiB and above", () => {
    const pledges = [1000, 2 ** 32 - 1, 2 ** 32, 2 ** 33 + 1, Number.MAX_SAFE_INTEGER];
    assert.deepStrictEqual(
      pledges.map(pledgedSrcSize => frameContentSize(compressSync(data, flushOnly(pledgedSrcSize)))),
      pledges,
    );
  });

  test("by zstdCompress()", async () => {
    assert.strictEqual(frameContentSize(await compress(data, flushOnly(2 ** 32))), 2 ** 32);
  });

  test("by a stream", async () => {
    const stream = createCompress({ pledgedSrcSize: 2 ** 32 });
    try {
      const chunks: Buffer[] = [];
      const { promise, resolve, reject } = Promise.withResolvers<void>();
      stream.on("data", chunk => chunks.push(chunk));
      stream.on("error", reject);
      stream.on("close", () => reject(new Error("the stream closed before the flush completed")));
      stream.write(data, error => error && reject(error));
      stream.flush(() => resolve());
      await promise;
      assert.strictEqual(frameContentSize(Buffer.concat(chunks)), 2 ** 32);
    } finally {
      stream.destroy();
    }
  });
});

describe("zstd pledgedSrcSize is validated", () => {
  const frame = zlib.zstdCompressSync(data);
  // Each call has to throw before it starts work, so nothing calls this.
  const callback = () => {};
  const entryPoints: Record<string, (options: Options) => unknown> = {
    createZstdCompress: options => createCompress(options).destroy(),
    createZstdDecompress: options => zlib.createZstdDecompress(options as zlib.ZstdOptions).destroy(),
    zstdCompressSync: options => compressSync("", options),
    zstdDecompressSync: options => zlib.zstdDecompressSync(frame, options as zlib.ZstdOptions),
    zstdCompress: options => zlib.zstdCompress(data, options as zlib.ZstdOptions, callback),
    zstdDecompress: options => zlib.zstdDecompress(frame, options as zlib.ZstdOptions, callback),
  };
  const invalid: [string, string, unknown[]][] = [
    ["a value that is not a number", notANumber, ["1", "", null, true, false, 1n, {}, [], new Number(5)]],
    [
      "a number that is not a safe integer",
      notASafeInteger,
      [NaN, Infinity, -Infinity, 1.9, -1.5, 2 ** 53, -(2 ** 53)],
    ],
    ["a negative safe integer", negative, [-1, -Number.MAX_SAFE_INTEGER]],
  ];

  for (const [name, call] of Object.entries(entryPoints)) {
    for (const [kind, expected, values] of invalid) {
      test(`${name} throws for ${kind}`, () => {
        assert.deepStrictEqual(
          values.map(pledgedSrcSize => outcome(() => call({ pledgedSrcSize }))),
          values.map(() => expected),
        );
      });
    }
  }

  test("accepts undefined and each non-negative safe integer", () => {
    for (const pledgedSrcSize of [undefined, 0, -0, 2 ** 32, Number.MAX_SAFE_INTEGER]) {
      createCompress({ pledgedSrcSize }).destroy();
      zlib.createZstdDecompress({ pledgedSrcSize } as zlib.ZstdOptions).destroy();
      assert.deepStrictEqual(zlib.zstdDecompressSync(frame, { pledgedSrcSize } as zlib.ZstdOptions), data);
    }
  });

  test("is checked after params and dictionary, and before the other options and arguments", () => {
    const pledgedSrcSize = "1";
    assert.deepStrictEqual(
      [
        outcome(() => createCompress({ pledgedSrcSize, params: { 99999: 1 } })),
        outcome(() => createCompress({ pledgedSrcSize, dictionary: null })),
        outcome(() => createCompress({ pledgedSrcSize, chunkSize: 1 })),
        outcome(() => createCompress({ pledgedSrcSize, flush: 99 })),
        outcome(() => createCompress({ pledgedSrcSize, finishFlush: 99 })),
        outcome(() => createCompress({ pledgedSrcSize, maxOutputLength: -1 })),
        outcome(() => compressSync(123 as unknown as Buffer, { pledgedSrcSize })),
        outcome(() => zlib.zstdCompress(123 as unknown as Buffer, { pledgedSrcSize } as zlib.ZstdOptions, callback)),
        outcome(() => zlib.zstdCompress(data, { pledgedSrcSize } as zlib.ZstdOptions, "no function" as never)),
      ],
      [
        "RangeError ERR_ZSTD_INVALID_PARAM: 99999 is not a valid zstd parameter",
        'TypeError ERR_INVALID_ARG_TYPE: The "options.dictionary" property must be an instance of Buffer, TypedArray, DataView, or ArrayBuffer. Received null',
        notANumber,
        notANumber,
        notANumber,
        notANumber,
        notANumber,
        notANumber,
        notANumber,
      ],
    );
  });
});

describe("zlib.zstdCompress pledges the size of its input", () => {
  test("for each way to pass no pledge", async () => {
    const sizes: (number | null)[] = [];
    for (const options of [[], [undefined], [null], [{}], [{ pledgedSrcSize: undefined }]] as const) {
      sizes.push(frameContentSize(await compress(data, ...options)));
    }
    assert.deepStrictEqual(sizes, [64, 64, 64, 64, 64]);
  });

  test("of an empty input too", async () => {
    const sizes: (number | null)[] = [];
    for (const empty of ["", Buffer.alloc(0), new ArrayBuffer(0)]) sizes.push(frameContentSize(await compress(empty)));
    assert.deepStrictEqual(sizes, [0, 0, 0]);
  });

  test("in a copy of the options", async () => {
    const options = { chunkSize: 128 };
    assert.strictEqual(frameContentSize(await compress(data, options)), 64);
    assert.deepStrictEqual(options, { chunkSize: 128 });
  });

  // The copy has no prototype. A child process, because the test changes Object.prototype.
  test("in a copy that reads no option from Object.prototype", async () => {
    const script = `
      const zlib = require("node:zlib");
      const input = Buffer.alloc(64, 97);
      const results = [];
      const done = (error, result) => {
        results.push(error === null && Buffer.isBuffer(result));
        if (results.length === 2) console.log(JSON.stringify(results));
      };
      // With this option, the result is an object that holds the buffer.
      Object.prototype.info = true;
      zlib.zstdCompress(input, done);
      zlib.zstdCompress(input, { __proto__: null }, done);`;
    const { stdout } = await promisify(execFile)(process.execPath, ["-e", script], {
      env: harness?.bunEnv ?? process.env,
    });
    assert.deepStrictEqual(JSON.parse(stdout), [true, true]);
  });

  for (const defaultEncoding of [undefined, null, "utf8", "utf-8"]) {
    test(`of a string with defaultEncoding ${defaultEncoding}`, async () => {
      const frame = await compress("h\xe9llo", { defaultEncoding } as Options);
      assert.deepStrictEqual(
        { decompressed: zlib.zstdDecompressSync(frame), contentSize: frameContentSize(frame) },
        { decompressed: Buffer.from("h\xe9llo"), contentSize: 6 },
      );
    });
  }

  // The stream decodes a string with `defaultEncoding`, so its size is not known before the write.
  // Node.js compares the option with the two exact strings above, so "UTF8" gets no pledge either.
  for (const [defaultEncoding, text] of [
    ["hex", "616263"],
    ["base64", "YWJj"],
    ["latin1", "\xe9\xe8"],
    ["utf16le", "abc"],
    ["ascii", "abc"],
    ["UTF8", "h\xe9llo"],
  ] as const) {
    test(`but not of a string with defaultEncoding ${defaultEncoding}`, async () => {
      const bytes = Buffer.from(text, defaultEncoding as BufferEncoding);
      const frame = await compress(text, { defaultEncoding });
      assert.deepStrictEqual(
        { decompressed: zlib.zstdDecompressSync(frame), contentSize: frameContentSize(frame) },
        { decompressed: bytes, contentSize: null },
      );
      // The first write ends the frame, so zstd takes the size from that write.
      const frames = await compress(text, { defaultEncoding, flush: ZSTD_e_end });
      assert.deepStrictEqual(
        { decompressed: zlib.zstdDecompressSync(frames), contentSize: frameContentSize(frames) },
        { decompressed: bytes, contentSize: bytes.length },
      );
    });
  }

  test("but does not replace a pledge of the caller", async () => {
    await assert.rejects(compress(data, { pledgedSrcSize: 0 }), srcSizeWrong);
    await assert.rejects(compress(data, { pledgedSrcSize: 63 }), srcSizeWrong);
    await assert.rejects(compress(data, { pledgedSrcSize: 63, flush: ZSTD_e_end }), srcSizeWrong);
    const frames = await compress(data, { pledgedSrcSize: 64, flush: ZSTD_e_end });
    assert.strictEqual(frameContentSize(frames), 64);
    assert.deepStrictEqual(zlib.zstdDecompressSync(frames), data);
    assert.strictEqual(frameContentSize(await compress("616263", { defaultEncoding: "hex", pledgedSrcSize: 3 })), 3);
    await assert.rejects(compress("616263", { defaultEncoding: "hex", pledgedSrcSize: 6 }), srcSizeWrong);
  });
});

describe("a dictionary that zstd rejects", () => {
  const frame = zlib.zstdCompressSync(data);
  const { buffer, byteOffset, byteLength } = rejectedDictionary;

  for (const [kind, dictionary] of [
    ["Buffer", rejectedDictionary],
    ["ArrayBuffer", buffer.slice(byteOffset, byteOffset + byteLength)],
  ] as const) {
    test(`fails the decompressor when it is constructed (${kind})`, () => {
      const options = { dictionary } as zlib.ZstdOptions;
      assert.throws(() => zlib.createZstdDecompress(options), loadFailed);
      assert.throws(() => zlib.zstdDecompressSync(frame, options), loadFailed);
    });
  }
});

// node:zlib/iter exists only with --experimental-stream-iter, so these run in one child process.
describe("node:zlib/iter zstd", () => {
  const script = `
    const { compressZstd, compressZstdSync, decompressZstd, decompressZstdSync } = require("node:zlib/iter");
    const { pull, pullSync, bytes, bytesSync } = require("node:stream/iter");
    const outcome = async (run, decompress) => {
      try {
        const output = await run();
        return decompress ? require("node:zlib").zstdDecompressSync(output).byteLength : output.byteLength;
      } catch (error) {
        return error.name + " " + error.code + ": " + error.message;
      }
    };
    const chunks = lengths => lengths.map(length => new Uint8Array(length).fill(97));
    const viaAsync = (transform, lengths, decompress) =>
      outcome(() => bytes(pull((async function* () { yield* chunks(lengths); })(), transform)), decompress);
    const viaSync = (transform, lengths, decompress) =>
      outcome(() => bytesSync(pullSync(chunks(lengths), transform)), decompress);
    (async () => {
      const compared = {};
      for (const [pledgedSrcSize, ...lengths] of [[0], [42], [64, 64], [64, 32, 32], [10, 64], [63, 32, 32]]) {
        compared[pledgedSrcSize + " for " + JSON.stringify(lengths)] = [
          await viaAsync(compressZstd({ pledgedSrcSize }), lengths, true),
          await viaSync(compressZstdSync({ pledgedSrcSize }), lengths, true),
        ];
      }
      // Each use of a transform has its own handle, so its own first frame.
      const transform = compressZstdSync({ pledgedSrcSize: 64 });
      compared.reused = [await viaSync(transform, [64], true), await viaSync(transform, [10], true)];

      const validated = {};
      for (const [label, pledgedSrcSize] of [["string", "bad"], ["null", null], ["NaN", NaN], ["2 ** 53", 2 ** 53], ["-1", -1]]) {
        // The factory does not look at the option.
        const [compress, compressSync, decompress, decompressSync] = [
          compressZstd, compressZstdSync, decompressZstd, decompressZstdSync,
        ].map(factory => factory({ pledgedSrcSize }));
        validated[label] = [
          await viaAsync(compress, []),
          await viaSync(compressSync, []),
          await viaAsync(decompress, []),
          await viaSync(decompressSync, []),
        ];
      }

      const dictionary = Buffer.from("${rejectedDictionary.toString("hex")}", "hex");
      const rejected = [
        await viaAsync(decompressZstd({ dictionary }), []),
        await viaSync(decompressZstdSync({ dictionary }), []),
      ];
      console.log(JSON.stringify({ compared, validated, rejected }));
    })();`;
  let child: Promise<{ compared: object; validated: object; rejected: string[] }> | undefined;
  const results = () =>
    (child ??= promisify(execFile)(process.execPath, ["--experimental-stream-iter", "--no-warnings", "-e", script], {
      env: harness?.bunEnv ?? process.env,
    }).then(({ stdout }) => JSON.parse(stdout)));

  test("pledgedSrcSize is compared with the input of the frame", async () => {
    const wrong = `${srcSizeWrong.name} ${srcSizeWrong.code}: ${srcSizeWrong.message}`;
    // A number is the size of the decompressed output.
    assert.deepStrictEqual((await results()).compared, {
      "0 for []": [0, 0],
      "42 for []": [wrong, wrong],
      "64 for [64]": [64, 64],
      "64 for [32,32]": [64, 64],
      "10 for [64]": [wrong, wrong],
      "63 for [32,32]": [wrong, wrong],
      reused: [64, wrong],
    });
  });

  test("pledgedSrcSize is validated when the transform is first pulled", async () => {
    assert.deepStrictEqual((await results()).validated, {
      string: new Array(4).fill(notANumber),
      null: new Array(4).fill(notANumber),
      NaN: new Array(4).fill(notASafeInteger),
      "2 ** 53": new Array(4).fill(notASafeInteger),
      "-1": new Array(4).fill(negative),
    });
  });

  test("a dictionary that zstd rejects fails the decompressor when the transform is first pulled", async () => {
    const failed = `${loadFailed.name} ${loadFailed.code}: ${loadFailed.message}`;
    assert.deepStrictEqual((await results()).rejected, [failed, failed]);
  });
});

// Only in Bun: when Node.js runs this file it must not spawn itself again.
if (harness) {
  const { bunEnv, nodeExeAtLeast } = harness;
  // The version of nodejs/node#66358, the newest of the changes above.
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
