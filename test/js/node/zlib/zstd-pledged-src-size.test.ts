import { describe, expect, it } from "bun:test";
import { promisify } from "node:util";
import * as zlib from "node:zlib";

// https://github.com/facebook/zstd/blob/dev/doc/zstd_compression_format.md#frame_header
// magic(4) | frame header descriptor(1) | [window descriptor(1)] | [dictionary id] | [frame content size]
function frameContentSize(frame: Buffer): bigint | null {
  expect(frame.readUInt32LE(0)).toBe(0xfd2fb528);
  const descriptor = frame[4];
  const singleSegment = (descriptor >> 5) & 1;
  const offset = 5 + (singleSegment ? 0 : 1) + [0, 1, 2, 4][descriptor & 0b11];
  switch (descriptor >> 6) {
    case 0:
      return singleSegment ? BigInt(frame[offset]) : null;
    case 1:
      return BigInt(frame.readUInt16LE(offset) + 256);
    case 2:
      return BigInt(frame.readUInt32LE(offset));
    default:
      return frame.readBigUInt64LE(offset);
  }
}

// Finishing with ZSTD_e_flush instead of ZSTD_e_end means zstd never checks the pledged size
// against what was actually written, so these can pledge 4 GiB without feeding it 4 GiB.
// The pledge still goes into the frame header.
const input = Buffer.alloc(64, 0x61);
const flushOnly = (pledgedSrcSize: number) => ({ pledgedSrcSize, finishFlush: zlib.constants.ZSTD_e_flush });

describe("zstd pledgedSrcSize", () => {
  it("is written to the frame header unmodified when below 4 GiB", () => {
    expect(frameContentSize(zlib.zstdCompressSync(input, flushOnly(1000)))).toBe(1000n);
    expect(frameContentSize(zlib.zstdCompressSync(input, flushOnly(2 ** 32 - 1)))).toBe(4294967295n);
  });

  it("accepts 4 GiB and larger", () => {
    expect(frameContentSize(zlib.zstdCompressSync(input, flushOnly(2 ** 32)))).toBe(4294967296n);
    expect(frameContentSize(zlib.zstdCompressSync(input, flushOnly(2 ** 33 + 1)))).toBe(8589934593n);
    expect(frameContentSize(zlib.zstdCompressSync(input, flushOnly(Number.MAX_SAFE_INTEGER)))).toBe(
      9007199254740991n,
    );
  });

  it("accepts 4 GiB and larger when compressing asynchronously", async () => {
    const compressed = await promisify(zlib.zstdCompress)(input, flushOnly(2 ** 32));
    expect(frameContentSize(compressed)).toBe(4294967296n);
  });

  it("accepts 4 GiB and larger when streaming", async () => {
    const encoder = zlib.createZstdCompress({ pledgedSrcSize: 2 ** 32 });
    const chunks: Buffer[] = [];
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    encoder.on("data", chunk => chunks.push(chunk));
    encoder.on("error", reject);
    encoder.write(input, err => err && reject(err));
    encoder.flush(() => resolve());
    await promise;
    encoder.destroy();
    expect(frameContentSize(Buffer.concat(chunks))).toBe(4294967296n);
  });

  it("rejects values that are not a non-negative safe integer", () => {
    for (const pledgedSrcSize of [Number.MAX_SAFE_INTEGER + 1, -1, 1.5, Infinity]) {
      expect(() => zlib.createZstdCompress({ pledgedSrcSize })).toThrow(
        expect.objectContaining({
          code: "ERR_OUT_OF_RANGE",
          message: expect.stringContaining('The value of "pledgedSrcSize" is out of range.'),
        }),
      );
    }
  });
});
