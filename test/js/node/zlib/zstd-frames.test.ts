/**
 * The zstd decoder of node:zlib follows ZstdDecompressContext of Node v26.10.0:
 * https://github.com/nodejs/node/blob/v26.10.0/src/node_zlib.cc#L1841-L1937
 *
 * This file uses node:test and node:assert, so that the identical file also
 * runs under `node --test` on Node v26.10.0. Each expected value is what that
 * run gives. For the same reason the file does not import from "harness".
 */
import assert from "node:assert";
import { execFile } from "node:child_process";
import { describe, test } from "node:test";
import { promisify } from "node:util";
import zlib from "node:zlib";

const { ZSTD_e_end } = zlib.constants;

const first = zlib.zstdCompressSync("first\n");
const second = zlib.zstdCompressSync("second\n");
const junk = Buffer.from("not valid compressed data");
const magic = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
// The first byte of a skippable magic number is 0x50 to 0x5f. A length of 4 and 4 bytes to skip follow.
const skippable = Buffer.from([0x5a, 0x2a, 0x4d, 0x18, 4, 0, 0, 0, 1, 2, 3, 4]);
const bytewise = (buffer: Buffer) => Array.from(buffer, byte => Buffer.of(byte));

const describeError = (err: any) => ({
  name: err.constructor.name,
  message: err.message,
  code: err.code,
  errno: err.errno,
  keys: Object.keys(err).sort(),
});
const zstdError = (message: string, code: string, errno: number) => ({
  name: "Error",
  message,
  code,
  errno,
  keys: ["code", "errno"],
});

function thrownBy(fn: () => unknown) {
  try {
    fn();
  } catch (err) {
    return describeError(err);
  }
}
const rejectionOf = (promise: Promise<unknown>) => promise.then(() => undefined, describeError);

type Decoder = ReturnType<typeof zlib.createZstdDecompress>;
type Operation = Buffer | ((decoder: Decoder) => unknown);

// Runs the operations on one stream, where a buffer is a write(), and resolves at 'close'.
async function decode(operations: Operation[], options?: zlib.ZstdOptions) {
  const decoder = zlib.createZstdDecompress(options);
  const output: Buffer[] = [];
  const events: unknown[] = [];
  const closed = new Promise(resolve => decoder.on("close", resolve));
  decoder.on("data", chunk => output.push(chunk));
  decoder.on("end", () => events.push("end"));
  decoder.on("error", err => events.push(describeError(err)));
  for (const operation of operations) {
    if (typeof operation === "function") await operation(decoder);
    else decoder.write(operation);
  }
  await closed;
  return { output: Buffer.concat(output).toString("latin1"), events, bytesWritten: decoder.bytesWritten };
}
const end = (decoder: Decoder) => decoder.end();
const reset = (decoder: Decoder) => decoder.reset();
// A write() that waits for its callback, or for 'close' when the stream stops first.
const written = (chunk: Buffer) => (decoder: Decoder) =>
  new Promise<void>(resolve => {
    decoder.once("close", resolve);
    decoder.write(chunk, () => resolve());
  });
const ended = (output: string, bytesWritten: number) => ({ output, events: ["end"], bytesWritten });

// _processChunk on a handle that stays open, which is how minizlib drives the decoder.
function processChunks(steps: ([Buffer, number] | "reset")[]) {
  const decoder = new zlib.ZstdDecompress() as any;
  const handle = decoder._handle;
  const close = handle.close;
  handle.close = () => {};
  let output = "";
  try {
    for (const step of steps) {
      if (step === "reset") handle.reset();
      else output += Buffer.from(decoder._processChunk(step[0], step[1])).toString("latin1");
      decoder._handle = handle;
    }
    return { output };
  } catch (err) {
    return { output, error: describeError(err) };
  } finally {
    close.call(handle);
  }
}

// node:zlib/iter needs a flag, so its cases run in one child of the same runtime. The file waits
// for the child before its tests start, so that no test has to wait for a process. The deadline
// ends a child that does not exit, so that this file fails and does not stall the run.
// Each result is that of decompressZstd and then that of decompressZstdSync.
const iterChild = await promisify(execFile)(
  process.execPath,
  [
    "--experimental-stream-iter",
    "-e",
    `
    const { bytes, bytesSync, from, fromSync, pull, pullSync } = require("node:stream/iter");
    const { decompressZstd, decompressZstdSync } = require("node:zlib/iter");
    const zlib = require("node:zlib");
    const a = zlib.zstdCompressSync("a");
    const b = zlib.zstdCompressSync("b");
    const junk = Buffer.from("junk");
    const wrongChecksum = zlib.zstdCompressSync("b", { params: { [zlib.constants.ZSTD_c_checksumFlag]: 1 } });
    wrongChecksum[wrongChecksum.length - 1] ^= 1;
    const cases = {
      "after a complete frame": {
        "frame, tail, frame": [a, junk, b],
        "frame, frame, tail": [a, b, junk],
        "frame and tail in one chunk": [Buffer.concat([a, junk])],
        "frame, frame": [a, b],
        "frame, frame with a wrong checksum": [a, wrongChecksum],
      },
      "the end of the input": {
        "no chunk": [],
        "an empty chunk": [Buffer.alloc(0)],
        "a frame without its last byte": [a.subarray(0, -1)],
        "a frame, a frame without its last byte": [a, b.subarray(0, -1)],
        "a frame, 4 bytes of a magic number": [a, b.subarray(0, 4)],
        "a frame, 3 bytes of a magic number": [a, b.subarray(0, 3)],
      },
    };
    const result = decode => decode().then(
      output => Buffer.from(output).toString("latin1"),
      err => ({ name: err.constructor.name, message: err.message, code: err.code, errno: err.errno }),
    );
    (async () => {
      const results = {};
      for (const [group, rows] of Object.entries(cases)) {
        results[group] = {};
        for (const [name, chunks] of Object.entries(rows)) {
          results[group][name] = [
            await result(async () => bytes(pull(from(chunks), decompressZstd()))),
            await result(async () => bytesSync(pullSync(fromSync(chunks), decompressZstdSync()))),
          ];
        }
      }
      console.log(JSON.stringify(results));
    })();
    `,
  ],
  { env: { ...process.env, BUN_DEBUG_QUIET_LOGS: "1" }, timeout: 60_000, killSignal: "SIGKILL" },
);
const iterResults: Record<string, Record<string, unknown>> = JSON.parse(iterChild.stdout);

describe("zstd: input after a complete frame", () => {
  // The last number is how many bytes of the tail a magic number can begin with.
  const tails: [string, Buffer, number][] = [
    ["text", junk, 0],
    ["1 byte of the zstd magic number and then text", Buffer.from("(hello world"), 1],
    ["2 bytes of the zstd magic number and then another byte", Buffer.from([0x28, 0xb5, 0x58]), 2],
    ["3 bytes of the zstd magic number and then another byte", Buffer.from([0x28, 0xb5, 0x2f, 0x58]), 3],
    ["1 byte of a skippable magic number and then text", Buffer.from("PK\x03\x04"), 1],
    ["2 bytes of a skippable magic number and then another byte", Buffer.from([0x50, 0x2a, 0x58]), 2],
    ["3 bytes of a skippable magic number and then another byte", Buffer.from([0x5f, 0x2a, 0x4d, 0x19]), 3],
    ["a first byte above the skippable magic numbers", Buffer.from([0x60, 0x2a, 0x4d, 0x18]), 0],
    ["a first byte below the skippable magic numbers", Buffer.from([0x4f, 0x2a, 0x4d, 0x18]), 0],
    ["a first byte below the zstd magic number", Buffer.from([0x27, 0xb5, 0x2f, 0xfd]), 0],
  ];
  for (const [name, tail, accepted] of tails) {
    test(`${name} ends the stream`, async () => {
      const input = Buffer.concat([first, tail]);
      assert.strictEqual(zlib.zstdDecompressSync(input).toString(), "first\n");
      assert.strictEqual((await promisify(zlib.zstdDecompress)(input)).toString(), "first\n");
      assert.deepStrictEqual(await decode([d => d.end(input)]), ended("first\n", first.length));
      assert.deepStrictEqual(await decode([first, tail, second, end]), ended("first\n", first.length));
      assert.deepStrictEqual(await decode([input, second, end]), ended("first\n", first.length));
      // zstd takes each byte that a magic number can begin with, so those count as written.
      assert.deepStrictEqual(
        await decode([first, ...bytewise(tail), second, end]),
        ended("first\n", first.length + accepted),
      );
    });
  }

  test("a tail after two frames, and after a skippable frame, ends the stream", async () => {
    const both = first.length + second.length;
    assert.strictEqual(zlib.zstdDecompressSync(Buffer.concat([first, second, junk])).toString(), "first\nsecond\n");
    assert.deepStrictEqual(await decode([first, second, junk, end]), ended("first\nsecond\n", both));
    assert.deepStrictEqual(
      await decode([first, skippable, junk, second, end]),
      ended("first\n", first.length + skippable.length),
    );
  });

  test("a tail ends the stream when the frame fills the output chunk", () => {
    // The sync driver calls the handle again when the chunk is full, with only the tail as the input.
    const exact = Buffer.alloc(zlib.constants.Z_DEFAULT_CHUNK, "a");
    const input = Buffer.concat([zlib.zstdCompressSync(exact), Buffer.from("junkjunk")]);
    assert.deepStrictEqual(zlib.zstdDecompressSync(input), exact);
  });

  describe("reset()", () => {
    test("after a tail, the stream decodes again, and its output comes after 'end'", async () => {
      const { events, ...rest } = await decode([written(first), written(junk), reset, written(second), end]);
      assert.deepStrictEqual(rest, { output: "first\n", bytesWritten: first.length + second.length });
      assert.deepStrictEqual(
        events.map((event: any) => event.code ?? event),
        ["end", "ERR_STREAM_PUSH_AFTER_EOF"],
      );
    });

    test("after a tail, a handle that stays open decodes again", () => {
      assert.deepStrictEqual(
        processChunks([[first, 0], [junk, 0], "reset", [second, 0], [Buffer.alloc(0), ZSTD_e_end]]),
        { output: "first\nsecond\n" },
      );
    });

    test("in the middle of a magic number, the next frame starts at its first byte", async () => {
      assert.deepStrictEqual(
        await decode([written(first), written(magic.subarray(0, 2)), reset, written(second), end]),
        ended("first\nsecond\n", first.length + 2 + second.length),
      );
    });
  });

  // The cases below follow the five zstd tests of test/parallel/test-zlib-reject-garbage-after-end.js
  // of Node v26.10.0 (lines 133-259), with the default options. That file is not vendored, because
  // its other tests need options.rejectGarbageAfterEnd.
  describe("concatenated frames", () => {
    for (const [name, frames] of [
      ["two frames", [first, second]],
      ["two frames with a skippable frame between them", [first, skippable, second]],
    ] as [string, Buffer[]][]) {
      test(`${name} decode at each split of the input`, async () => {
        const input = Buffer.concat(frames);
        assert.strictEqual(zlib.zstdDecompressSync(input).toString(), "first\nsecond\n");
        assert.strictEqual((await promisify(zlib.zstdDecompress)(input)).toString(), "first\nsecond\n");
        for (let split = 0; split <= input.length; split++) {
          assert.deepStrictEqual(
            await decode([input.subarray(0, split), input.subarray(split), end]),
            ended("first\nsecond\n", input.length),
            `split at byte ${split}`,
          );
        }
        assert.deepStrictEqual(await decode([...bytewise(input), end]), ended("first\nsecond\n", input.length));
      });
    }

    test("a skippable frame alone decodes to nothing", async () => {
      assert.deepStrictEqual(zlib.zstdDecompressSync(skippable), Buffer.alloc(0));
      assert.deepStrictEqual(await decode([skippable, end]), ended("", skippable.length));
    });

    test("1 to 3 bytes of a frame after a frame are a tail", async () => {
      for (let length = 1; length <= 3; length++) {
        const tail = second.subarray(0, length);
        assert.strictEqual(zlib.zstdDecompressSync(Buffer.concat([first, tail])).toString(), "first\n");
        assert.deepStrictEqual(await decode([first, tail, end]), ended("first\n", first.length + length));
      }
    });

    test("two frames decode across many output chunks", async () => {
      const payloads = [Buffer.alloc(1024, "first "), Buffer.alloc(1024, "second ")];
      const input = Buffer.concat(payloads.map(payload => zlib.zstdCompressSync(payload)));
      const options = { chunkSize: zlib.constants.Z_MIN_CHUNK };
      assert.deepStrictEqual(zlib.zstdDecompressSync(input, options), Buffer.concat(payloads));
      assert.deepStrictEqual(
        await decode([input, end], options),
        ended(Buffer.concat(payloads).toString("latin1"), input.length),
      );
    });

    // Each frame begins with a valid magic number, so it is a frame and not a tail.
    const checksummed = zlib.zstdCompressSync("second\n", { params: { [zlib.constants.ZSTD_c_checksumFlag]: 1 } });
    checksummed[checksummed.length - 1] ^= 1;
    const badFrames: [string, Buffer, ReturnType<typeof zstdError>][] = [
      [
        "a wrong checksum",
        checksummed,
        zstdError("Restored data doesn't match checksum", "ZSTD_error_checksum_wrong", 22),
      ],
      [
        "a block of the reserved type",
        Buffer.from([...magic, 0x20, 0x01, 0x0f, 0x00, 0x00, 0x00]),
        zstdError("Data corruption detected", "ZSTD_error_corruption_detected", 20),
      ],
      [
        "the reserved bit in its header",
        Buffer.from([...magic, 0x28, 0x01, 0x01, 0x00, 0x00, 0x00]),
        zstdError("Unsupported frame parameter", "ZSTD_error_frameParameter_unsupported", 14),
      ],
    ];
    for (const [name, bad, error] of badFrames) {
      test(`a later frame with ${name} is an error`, async () => {
        const input = Buffer.concat([first, bad]);
        assert.deepStrictEqual(
          thrownBy(() => zlib.zstdDecompressSync(input)),
          error,
        );
        assert.deepStrictEqual(await rejectionOf(promisify(zlib.zstdDecompress)(input)), error);
        // A write that fails gives none of its output, also not that of the frames before the bad one.
        assert.deepStrictEqual(await decode([input, end]), { output: "", events: [error], bytesWritten: 0 });
        for (const [writes, bytesWritten] of [
          [[first, bad], first.length],
          [[Buffer.concat([first, bad.subarray(0, 2)]), bad.subarray(2)], first.length + 2],
          [[first, skippable, bad], first.length + skippable.length],
        ] as [Buffer[], number][]) {
          assert.deepStrictEqual(await decode([...writes, end]), { output: "first\n", events: [error], bytesWritten });
        }
      });
    }
  });

  test("input that is not a frame at the start of the stream is an error, not a tail", async () => {
    const error = zstdError("Unknown frame descriptor", "ZSTD_error_prefix_unknown", 10);
    assert.deepStrictEqual(
      thrownBy(() => zlib.zstdDecompressSync(junk)),
      error,
    );
    assert.deepStrictEqual(await decode([junk, end]), { output: "", events: [error], bytesWritten: 0 });
  });

  test("zlib/iter stops at a chunk that cannot start a frame", () => {
    const checksumWrong = {
      name: "Error",
      message: "Restored data doesn't match checksum",
      code: "ZSTD_error_checksum_wrong",
      errno: 22,
    };
    assert.deepStrictEqual(iterResults["after a complete frame"], {
      "frame, tail, frame": ["a", "a"],
      "frame, frame, tail": ["ab", "ab"],
      "frame and tail in one chunk": ["a", "a"],
      "frame, frame": ["ab", "ab"],
      "frame, frame with a wrong checksum": [checksumWrong, checksumWrong],
    });
  });
});

// With finishFlush ZSTD_e_end, which is the default, the input must end where a frame ends.
describe("zstd: the end of the input", () => {
  const { ZSTD_e_continue, ZSTD_e_flush } = zlib.constants;
  const unexpectedEnd = zstdError("unexpected end of file", "Z_BUF_ERROR", -5);
  const payload = Buffer.alloc(192, "hello world ");
  const text = payload.toString("latin1");
  const frame = zlib.zstdCompressSync(payload);
  const truncated = frame.subarray(0, -10);
  const checksummed = zlib.zstdCompressSync(payload, { params: { [zlib.constants.ZSTD_c_checksumFlag]: 1 } });
  const withoutChecksumByte = checksummed.subarray(0, -1);
  const withoutChecksum = checksummed.subarray(0, -4);
  // A compressor that got a flush and no end gives whole blocks, and not the last block of the frame.
  const flushed = zlib.zstdCompressSync(payload, { finishFlush: ZSTD_e_flush });
  const empty = Buffer.alloc(0);
  const flushEnd = (decoder: Decoder) => decoder.flush(ZSTD_e_end);
  const failed = (payloads: number, bytesWritten: number) => ({
    output: text.repeat(payloads),
    events: [unexpectedEnd],
    bytesWritten,
  });

  describe("inside a frame", () => {
    // After the input, each row has the number of payloads that the input gives before it ends:
    // with the input in one write, and with each byte in a write of its own. Then it has that number
    // and bytesWritten for a write of the input that has ZSTD_e_end. A write that fails gives no
    // output and counts no bytes.
    const inputs: [string, Buffer, number, number, [number, number]][] = [
      ["no input", empty, 0, 0, [0, 0]],
      ["a frame without its last 10 bytes", truncated, 0, 0, [0, 0]],
      ["2 bytes of a magic number", magic.subarray(0, 2), 0, 0, [0, 0]],
      ["a skippable frame without its last 2 bytes", skippable.subarray(0, -2), 0, 0, [0, 0]],
      ["a frame without the last byte of its checksum", withoutChecksumByte, 1, 1, [1, withoutChecksumByte.length]],
      ["a frame without its checksum", withoutChecksum, 1, 0, [1, withoutChecksum.length]],
      ["the output of a compressor that did not end", flushed, 1, 0, [1, flushed.length]],
      ["a frame and a frame without its last 10 bytes", Buffer.concat([frame, truncated]), 1, 1, [1, frame.length]],
      ["a frame and 4 bytes of a magic number", Buffer.concat([frame, magic]), 1, 1, [1, frame.length]],
      [
        "two frames and 4 bytes of a skippable magic number",
        Buffer.concat([frame, frame, skippable.subarray(0, 4)]),
        2,
        2,
        [2, 2 * frame.length],
      ],
    ];
    for (const [name, input, payloads, payloadsBytewise, finishing] of inputs) {
      test(`${name} is an error`, async () => {
        assert.deepStrictEqual(
          thrownBy(() => zlib.zstdDecompressSync(input)),
          unexpectedEnd,
        );
        assert.deepStrictEqual(await rejectionOf(promisify(zlib.zstdDecompress)(input)), unexpectedEnd);
        assert.deepStrictEqual(processChunks([[input, ZSTD_e_end]]), { output: "", error: unexpectedEnd });
        assert.deepStrictEqual(
          processChunks([
            [input, ZSTD_e_continue],
            [empty, ZSTD_e_end],
          ]),
          { output: text.repeat(payloads), error: unexpectedEnd },
        );
        assert.deepStrictEqual(await decode([d => d.end(input)]), failed(payloads, input.length));
        assert.deepStrictEqual(
          await decode([...bytewise(input), end]),
          failed(payloadsBytewise, Math.max(input.length - 1, 0)),
        );
        for (const chunkSize of [zlib.constants.Z_MIN_CHUNK, payload.length]) {
          assert.deepStrictEqual(await decode([input, end], { flush: ZSTD_e_end, chunkSize }), failed(...finishing));
        }
      });

      test(`${name} is not an error with another finishFlush`, async () => {
        for (const finishFlush of [ZSTD_e_flush, ZSTD_e_continue]) {
          const options = { finishFlush, chunkSize: zlib.constants.Z_MIN_CHUNK };
          assert.strictEqual(zlib.zstdDecompressSync(input, options).toString("latin1"), text.repeat(payloads));
          assert.strictEqual(
            (await promisify(zlib.zstdDecompress)(input, options)).toString("latin1"),
            text.repeat(payloads),
          );
          assert.deepStrictEqual(
            await decode([d => d.end(input)], options),
            ended(text.repeat(payloads), input.length),
          );
        }
      });
    }

    const orders: [string, Operation[], zlib.ZstdOptions | undefined, number, number][] = [
      ["end() with no write", [end], undefined, 0, 0],
      ["flush(ZSTD_e_end) before the first write", [flushEnd, end], undefined, 0, 0],
      ["flush(ZSTD_e_end) after the input", [truncated, flushEnd, end], undefined, 0, truncated.length],
      ["options.flush = ZSTD_e_end", [truncated.subarray(0, 10), end], { flush: ZSTD_e_end }, 0, 0],
      ["a write that waits for its callback", [written(truncated), end], undefined, 0, truncated.length],
      ["a frame and the input in one tick", [frame, truncated, end], undefined, 1, frame.length],
      [
        "a magic number in two writes after a frame",
        [frame, magic.subarray(0, 2), magic.subarray(2), end],
        undefined,
        1,
        frame.length + 2,
      ],
      ["reset() after a frame", [written(frame), reset, end], undefined, 1, frame.length],
    ];
    for (const [name, operations, options, payloads, bytesWritten] of orders) {
      test(`${name}: the stream gives the error`, async () => {
        assert.deepStrictEqual(await decode(operations, options), failed(payloads, bytesWritten));
      });
    }

    test("after a frame, the output of the input comes before the error", async () => {
      const options = { chunkSize: payload.length };
      for (const input of [withoutChecksumByte, withoutChecksum, flushed]) {
        assert.deepStrictEqual(await decode([frame, input, end], options), failed(2, frame.length + input.length));
      }
      assert.deepStrictEqual(await decode([frame, truncated, end], options), failed(1, frame.length));
    });

    test("the blocks that are complete come out before the error", async () => {
      const block = 128 * 1024;
      const big = zlib.zstdCompressSync(Buffer.alloc(8 * block, "hello world "));
      const cut = big.subarray(0, -10);
      // The shortest input that gives the first block ends where that block ends.
      const lengths = Array.from(big.keys(), index => index + 1);
      const firstBlockEnd = lengths.find(
        length => zlib.zstdDecompressSync(big.subarray(0, length), { finishFlush: ZSTD_e_flush }).length === block,
      );
      assert.ok(firstBlockEnd, "no prefix of the frame gives exactly its first block");
      const oneBlock = big.subarray(0, firstBlockEnd);
      const sizes = ({ output, ...rest }: Awaited<ReturnType<typeof decode>>) => ({ ...rest, output: output.length });
      for (const [input, output] of [
        [cut, 7 * block],
        [oneBlock, block],
      ] as [Buffer, number][]) {
        const expected = { events: [unexpectedEnd], bytesWritten: input.length, output };
        assert.deepStrictEqual(sizes(await decode([input, end])), expected);
        // In the next two orders the write of the input has ZSTD_e_end, and it fills output chunks before it ends.
        assert.deepStrictEqual(sizes(await decode([empty, input, end])), expected);
        assert.deepStrictEqual(sizes(await decode([d => d.end(input)], { flush: ZSTD_e_end })), expected);
      }
    });

    test("a stream that stops inside a frame gives no error", async () => {
      const stopped = { output: "", events: [], bytesWritten: truncated.length };
      assert.deepStrictEqual(await decode([written(truncated), d => d.destroy()]), stopped);
      assert.deepStrictEqual(await decode([written(truncated), d => d.close()]), stopped);
    });

    test("the finishFlush of the stream at the time of end() decides", async () => {
      const lenient = (decoder: any) => (decoder._finishFlushFlag = ZSTD_e_flush);
      assert.deepStrictEqual(await decode([lenient, d => d.end(truncated)]), ended("", truncated.length));
    });

    // Node aborts on a write before init(), so this test is for bun only.
    test("a handle that init() did not set up reports nothing", { skip: typeof Bun === "undefined" }, () => {
      const Handle = (zlib.createZstdDecompress() as any)._handle.constructor;
      const handle = new Handle(zlib.constants.ZSTD_DECOMPRESS);
      const errors: string[] = [];
      handle.onerror = (message: string, errno: number, code: string) => errors.push(code);
      handle.writeSync(ZSTD_e_end, null, 0, 0, new Uint8Array(64), 0, 64);
      assert.deepStrictEqual(errors, []);
    });

    test("zlib/iter gives the error", () => {
      const { keys, ...error } = unexpectedEnd;
      assert.deepStrictEqual(iterResults["the end of the input"], {
        "no chunk": [error, error],
        "an empty chunk": [error, error],
        "a frame without its last byte": [error, error],
        "a frame, a frame without its last byte": [error, error],
        "a frame, 4 bytes of a magic number": [error, error],
        "a frame, 3 bytes of a magic number": ["a", "a"],
      });
    });
  });

  describe("where a frame ends", () => {
    const twice = text.repeat(2);
    // Fewer than 4 bytes after a frame do not show that a frame began.
    const tails: [string, Buffer][] = [
      ["nothing", empty],
      ["1 byte of a magic number", magic.subarray(0, 1)],
      ["2 bytes of a magic number", magic.subarray(0, 2)],
      ["3 bytes of a magic number", magic.subarray(0, 3)],
      ["1 byte of a skippable magic number", skippable.subarray(0, 1)],
      ["2 bytes of a skippable magic number", skippable.subarray(0, 2)],
      ["3 bytes of a skippable magic number", skippable.subarray(0, 3)],
    ];
    for (const [name, tail] of tails) {
      test(`${name} after the last frame is not an error`, async () => {
        for (const [frames, output] of [
          [[frame], text],
          [[frame, frame], twice],
          [[frame, skippable], text],
        ] as [Buffer[], string][]) {
          const input = Buffer.concat([...frames, tail]);
          for (const chunkSize of [zlib.constants.Z_DEFAULT_CHUNK, zlib.constants.Z_MIN_CHUNK, payload.length]) {
            const options = { chunkSize };
            assert.strictEqual(zlib.zstdDecompressSync(input, options).toString("latin1"), output);
            assert.deepStrictEqual(processChunks([[input, ZSTD_e_end]]), { output });
            assert.deepStrictEqual(await decode([d => d.end(input)], options), ended(output, input.length));
            assert.deepStrictEqual(await decode([...bytewise(input), end], options), ended(output, input.length));
            assert.deepStrictEqual(
              await decode([input, end], { ...options, flush: ZSTD_e_end }),
              ended(output, input.length),
            );
          }
        }
      });
    }

    const orders: [string, Operation[], string, number][] = [
      ["flush(ZSTD_e_end) between two frames", [frame, flushEnd, frame, end], twice, 2 * frame.length],
      ["20 times flush(ZSTD_e_end)", [frame, ...Array(20).fill(flushEnd), end], text, frame.length],
      ["20 empty writes", [frame, ...Array(20).fill(empty), end], text, frame.length],
      [
        "reset() inside a frame, and then a frame",
        [written(truncated), reset, frame, end],
        text,
        truncated.length + frame.length,
      ],
    ];
    for (const [name, operations, output, bytesWritten] of orders) {
      test(`${name} is not an error`, async () => {
        for (const chunkSize of [zlib.constants.Z_DEFAULT_CHUNK, zlib.constants.Z_MIN_CHUNK]) {
          assert.deepStrictEqual(await decode(operations, { chunkSize }), ended(output, bytesWritten));
        }
      });
    }
  });
});
