/**
 * All tests in this file run in both Bun and Node.js: `bun test` runs them
 * here, and the last test runs this same file under Node.js.
 *
 * zstd writes `pledgedSrcSize` into the frame header as the Frame_Content_Size,
 * a field of up to 8 bytes, so a size of 4 GiB or more is valid. The expected
 * values below were recorded from Node v26.3.0 and v26.10.0.
 */
import assert from "node:assert";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import zlib from "node:zlib";

// Node validates the option as a non-negative safe integer since nodejs/node
// de6eeece8f (v26.7.0). An older Node truncates or clamps such a value, so the
// reject cases only describe it from that version on. Bun always runs them.
const runtimeValidates = (() => {
  if (process.versions.bun) return true;
  const [major, minor] = process.versions.node.split(".").map(Number);
  return major > 26 || (major === 26 && minor >= 7);
})();
const rejectTest = runtimeValidates ? test : test.skip;

// https://github.com/facebook/zstd/blob/dev/doc/zstd_compression_format.md#frame_header
// magic(4) | frame header descriptor(1) | [window descriptor(1)] | [dictionary id] | [frame content size]
function frameContentSize(frame: Buffer): bigint | null {
  assert.strictEqual(frame.readUInt32LE(0), 0xfd2fb528);
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
  test("is written to the frame header unmodified when below 4 GiB", () => {
    assert.strictEqual(frameContentSize(zlib.zstdCompressSync(input, flushOnly(1000))), 1000n);
    assert.strictEqual(frameContentSize(zlib.zstdCompressSync(input, flushOnly(2 ** 32 - 1))), 4294967295n);
  });

  test("accepts 4 GiB and larger", () => {
    assert.strictEqual(frameContentSize(zlib.zstdCompressSync(input, flushOnly(2 ** 32))), 4294967296n);
    assert.strictEqual(frameContentSize(zlib.zstdCompressSync(input, flushOnly(2 ** 33 + 1))), 8589934593n);
    assert.strictEqual(
      frameContentSize(zlib.zstdCompressSync(input, flushOnly(Number.MAX_SAFE_INTEGER))),
      9007199254740991n,
    );
  });

  test("accepts 4 GiB and larger when compressing asynchronously", async () => {
    const compressed = await promisify(zlib.zstdCompress)(input, flushOnly(2 ** 32));
    assert.strictEqual(frameContentSize(compressed), 4294967296n);
  });

  test("accepts 4 GiB and larger when streaming", async () => {
    const encoder = zlib.createZstdCompress({ pledgedSrcSize: 2 ** 32 });
    try {
      const chunks: Buffer[] = [];
      const { promise, resolve, reject } = Promise.withResolvers<void>();
      encoder.on("data", chunk => chunks.push(chunk));
      encoder.on("error", reject);
      encoder.on("close", () => reject(new Error("encoder closed before the flush completed")));
      encoder.write(input, err => err && reject(err));
      encoder.flush(() => resolve());
      await promise;
      assert.strictEqual(frameContentSize(Buffer.concat(chunks)), 4294967296n);
    } finally {
      encoder.destroy();
    }
  });

  for (const pledgedSrcSize of [Number.MAX_SAFE_INTEGER + 1, -1, 1.9, Infinity, -Infinity, NaN]) {
    rejectTest(`rejects ${pledgedSrcSize}`, () => {
      const expected = { name: "RangeError", code: "ERR_OUT_OF_RANGE" };
      assert.throws(() => zlib.createZstdCompress({ pledgedSrcSize }), expected);
      assert.throws(() => zlib.zstdCompressSync(input, { pledgedSrcSize }), expected);
    });
  }
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
