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
// for the child before its tests start, so that no test has to wait for a process.
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
  { env: { ...process.env, BUN_DEBUG_QUIET_LOGS: "1" } },
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
