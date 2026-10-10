/**
 * All tests in this file run in both Bun and Node.js: `bun test` runs them
 * here, and the last test runs this same file under Node.js. So the file uses
 * `node:test` and `node:assert`, not `bun:test`.
 *
 * zstd writes the size of the input to the frame header (Frame_Content_Size)
 * only if it knows the size before it writes the first block. For
 * `zlib.zstdCompress()` that is the case with a `pledgedSrcSize`. Bun pledges
 * the size of the input if the caller does not (#23314). Node.js does that
 * from nodejs/node fa4af16414 (not in v26.10.0 or earlier), so the tests ask
 * the runtime if it does.
 *
 * The expected results for an explicit `pledgedSrcSize` were recorded from
 * Node v24.21.0, v26.3.0 and v26.10.0.
 */
import assert from "node:assert";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

const { ZSTD_e_flush, ZSTD_c_compressionLevel } = zlib.constants;

const isBun = typeof process.versions.bun === "string";

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

type Input = string | NodeJS.ArrayBufferView | ArrayBuffer | null | undefined;
// No element: the call has no `options` argument. The element is unknown, because the tests pass
// values that the types of node:zlib do not allow.
type Options = [] | [unknown];

function compress(input: Input, ...options: Options): Promise<Buffer> {
  const { promise, resolve, reject } = Promise.withResolvers<Buffer>();
  const callback = (error: Error | null, frame: Buffer) => (error ? reject(error) : resolve(frame));
  if (options.length === 0) zlib.zstdCompress(input as Buffer, callback);
  else zlib.zstdCompress(input as Buffer, options[0] as zlib.ZstdOptions, callback);
  return promise;
}

async function contentSizeOf(input: Input, ...options: Options) {
  return frameContentSize(await compress(input, ...options));
}

// What Bun writes is fixed. A Node.js that pledges for the call has to write the decoded size.
function assertContentSize(actual: number | null, inBun: number | null, decodedSize: number) {
  if (isBun) assert.strictEqual(actual, inBun);
  else assert.ok(actual === null || actual === decodedSize, `content size ${actual} for ${decodedSize} bytes`);
}

function constructorThrows(pledgedSrcSize: unknown) {
  try {
    zlib.createZstdCompress({ pledgedSrcSize } as zlib.ZstdOptions).destroy();
    return false;
  } catch {
    return true;
  }
}
// Node validates the option since nodejs/node#64604 (v24.20.0 and v26.7.0): a number that is not
// a safe integer throws, and so does a value that is not a number. An older Node reads NaN as 0
// and ignores a value that is not a number. Bun throws for the first and ignores the second
// (#44278).
const rejectsNaN = isBun || constructorThrows(NaN);
const ignoresNonNumber = isBun || !constructorThrows("64");

const input = Buffer.alloc(64, 0x61);
const srcSizeWrong = { code: "ZSTD_error_srcSize_wrong" };

const pledgesByDefault = (await contentSizeOf(input)) === input.length;
const sizeByDefault = (size: number) => (pledgesByDefault ? size : null);

describe("zlib.zstdCompress", () => {
  describe("with a pledgedSrcSize", () => {
    for (const pledgedSrcSize of [0, -0, 63, 65]) {
      test(`fails when ${Object.is(pledgedSrcSize, -0) ? "-0" : pledgedSrcSize} is pledged for 64 bytes`, async () => {
        await assert.rejects(compress(input, { pledgedSrcSize }), srcSizeWrong);
      });
    }

    test("writes a pledge that matches the input to the frame header", async () => {
      assert.deepStrictEqual(
        [
          await contentSizeOf(input, { pledgedSrcSize: 64 }),
          await contentSizeOf(Buffer.alloc(0), { pledgedSrcSize: 0 }),
          await contentSizeOf("", { pledgedSrcSize: 0 }),
        ],
        [64, 0, 0],
      );
    });

    test("does not replace NaN with the size of the input", async () => {
      if (rejectsNaN) {
        assert.throws(() => compress(input, { pledgedSrcSize: NaN }), { name: "RangeError", code: "ERR_OUT_OF_RANGE" });
      } else {
        await assert.rejects(compress(input, { pledgedSrcSize: NaN }), srcSizeWrong);
      }
    });

    test("does not replace a pledge that is not a number", async () => {
      for (const pledgedSrcSize of [null, "", "64", false, true, 0n]) {
        if (ignoresNonNumber) {
          assert.strictEqual(await contentSizeOf(input, { pledgedSrcSize }), null, typeof pledgedSrcSize);
        } else {
          assert.throws(() => compress(input, { pledgedSrcSize }), { name: "TypeError", code: "ERR_INVALID_ARG_TYPE" });
        }
      }
    });

    test("checks the pledge when finishFlush does not end the frame", async () => {
      await assert.rejects(compress(input, { pledgedSrcSize: 0, finishFlush: ZSTD_e_flush }), srcSizeWrong);
      assert.strictEqual(await contentSizeOf(input, { pledgedSrcSize: 64, finishFlush: ZSTD_e_flush }), 64);
    });

    test("counts the bytes of a string in its defaultEncoding", async () => {
      const options = { defaultEncoding: "hex" };
      assert.strictEqual(await contentSizeOf("68656c6c6f", { ...options, pledgedSrcSize: 5 }), 5);
      await assert.rejects(compress("68656c6c6f", { ...options, pledgedSrcSize: 10 }), srcSizeWrong);
    });
  });

  describe("without a pledgedSrcSize", () => {
    (isBun ? test : test.skip)("pledges the size of the input in Bun", () => {
      assert.strictEqual(pledgesByDefault, true);
    });

    test("gives the same frame for each way to pass no pledge", async () => {
      const sizes: (number | null)[] = [];
      const noPledge: Options[] = [[], [undefined], [null], [{}], [{ pledgedSrcSize: undefined }]];
      for (const options of noPledge) {
        const frame = await compress(input, ...options);
        assert.deepStrictEqual(zlib.zstdDecompressSync(frame), input);
        sizes.push(frameContentSize(frame));
      }
      assert.deepStrictEqual(sizes, new Array(5).fill(sizeByDefault(64)));
    });

    test("pledges the size of an empty input", async () => {
      const sizes: (number | null)[] = [];
      for (const empty of [Buffer.alloc(0), "", new ArrayBuffer(0)]) {
        const frame = await compress(empty);
        assert.strictEqual(zlib.zstdDecompressSync(frame).length, 0);
        sizes.push(frameContentSize(frame));
      }
      assert.deepStrictEqual(sizes, new Array(3).fill(sizeByDefault(0)));
    });

    // With no input there is one write, and it ends the frame. So zstd knows the size itself.
    test("writes size 0 when there is no input", async () => {
      assert.deepStrictEqual([await contentSizeOf(undefined), await contentSizeOf(null)], [0, 0]);
    });

    (pledgesByDefault ? test : test.skip)("returns the same bytes as zstdCompressSync", async () => {
      // 1000 times a pattern of 19 bytes.
      const text = Buffer.alloc(19000, "h\xe9llo w\xf6rld \u{1f680} ").toString();
      const bytes = Buffer.from(text);
      const options = { params: { [ZSTD_c_compressionLevel]: 9 } };
      const inputs = [
        "",
        text,
        bytes,
        new Uint16Array(bytes.buffer, bytes.byteOffset, bytes.length >> 1),
        new DataView(bytes.buffer, bytes.byteOffset, bytes.length),
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length),
      ];
      for (const [index, value] of inputs.entries()) {
        assert.deepStrictEqual(await compress(value, options), zlib.zstdCompressSync(value, options), `input ${index}`);
      }
      for (const defaultEncoding of ["utf8", "utf-8"]) {
        const withEncoding = { ...options, defaultEncoding };
        assert.deepStrictEqual(await compress(text, withEncoding), zlib.zstdCompressSync(text, withEncoding));
      }
      // The wrapper adds the pledge to a copy.
      assert.deepStrictEqual(Object.keys(options), ["params"]);
    });
  });

  // The stream decodes a string with `defaultEncoding`. So the size of the input is the number
  // of bytes in that encoding, and a pledge of another size makes zstd fail.
  describe("a string with a defaultEncoding", () => {
    const text = "h\xe9llo w\xf6rld";

    for (const defaultEncoding of ["utf8", "utf-8"]) {
      test(`${defaultEncoding}: pledges the UTF-8 size`, async () => {
        const frame = await compress(text, { defaultEncoding });
        assert.deepStrictEqual(
          { decompressed: zlib.zstdDecompressSync(frame).toString(), contentSize: frameContentSize(frame) },
          { decompressed: text, contentSize: sizeByDefault(13) },
        );
      });
    }

    // Node.js pledges only for "utf8" and "utf-8". Bun also pledges for their other spellings,
    // and for each encoding in which a string has exactly one byte length.
    const exactEncodings = ["UTF8", "UTF-8", "Utf8", "latin1", "LATIN1", "binary", "ascii"];
    exactEncodings.push("utf16le", "utf-16le", "UTF16LE", "ucs2", "ucs-2");
    for (const defaultEncoding of exactEncodings) {
      test(`${defaultEncoding}: compresses the decoded bytes, and Bun pledges their size`, async () => {
        const bytes = Buffer.from(text, defaultEncoding as BufferEncoding);
        const frame = await compress(text, { defaultEncoding });
        assert.deepStrictEqual(zlib.zstdDecompressSync(frame), bytes);
        assertContentSize(frameContentSize(frame), bytes.length, bytes.length);
      });
    }

    test("latin1: Bun pledges the size of an ASCII string too", async () => {
      assertContentSize(await contentSizeOf("hello", { defaultEncoding: "latin1" }), 5, 5);
    });

    // Buffer.byteLength() also counts the characters that the hex and base64 decoders skip. So
    // the size is not known before the stream decodes the string, and there is no pledge.
    for (const [defaultEncoding, encoded] of [
      ["hex", "68656c6c6f"],
      ["hex", "68656c6c6fzz"],
      ["base64", "aGVsbG8="],
      ["base64", "aGV sbG8"],
      ["base64url", "aGVsbG8"],
    ] as const) {
      test(`${defaultEncoding}: compresses ${JSON.stringify(encoded)} with no pledge`, async () => {
        const bytes = Buffer.from(encoded, defaultEncoding);
        assert.strictEqual(bytes.toString(), "hello");
        const frame = await compress(encoded, { defaultEncoding });
        assert.deepStrictEqual(zlib.zstdDecompressSync(frame), bytes);
        assertContentSize(frameContentSize(frame), null, bytes.length);
      });
    }

    // The stream gets a copy of the own enumerable options. So it decodes these strings as UTF-8.
    for (const defaultEncoding of ["latin1", "binary", "ascii", "utf16le", "ucs2"]) {
      test(`${defaultEncoding}: is not the encoding if the options object does not own it`, async () => {
        class Options {
          get defaultEncoding() {
            return defaultEncoding;
          }
        }
        for (const options of [
          Object.create({ defaultEncoding }),
          Object.defineProperty({}, "defaultEncoding", { value: defaultEncoding, enumerable: false }),
          new Options(),
        ]) {
          const frame = await compress(text, options);
          assert.deepStrictEqual(zlib.zstdDecompressSync(frame), Buffer.from(text));
          assertContentSize(frameContentSize(frame), 13, 13);
        }
      });
    }

    test("measures the string in the encoding that the stream gets from a getter", async () => {
      let reads = 0;
      const options = {
        get defaultEncoding() {
          return reads++ === 0 ? "latin1" : "utf8";
        },
      };
      const frame = await compress(text, options);
      const decoded = zlib.zstdDecompressSync(frame);
      if (isBun) assert.deepStrictEqual({ reads, decoded }, { reads: 1, decoded: Buffer.from(text, "latin1") });
      else assert.ok(decoded.equals(Buffer.from(text, "latin1")) || decoded.equals(Buffer.from(text)));
      assertContentSize(frameContentSize(frame), decoded.length, decoded.length);
    });

    test("does not read the encoding with a replaced String.prototype.toLowerCase", async () => {
      const { toLowerCase } = String.prototype;
      let pending: Promise<Buffer>;
      String.prototype.toLowerCase = () => "latin1";
      try {
        // zstdCompress() reads its options before it returns.
        pending = compress("68656c6c6fzz", { defaultEncoding: "hex" });
      } finally {
        String.prototype.toLowerCase = toLowerCase;
      }
      assert.deepStrictEqual(zlib.zstdDecompressSync(await pending), Buffer.from("hello"));
    });
  });
});

// Only in Bun: when Node.js runs this file it must not spawn itself again.
if (typeof Bun !== "undefined") {
  const { bunEnv, nodeExe } = await import("harness");
  const node = nodeExe();

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
