import { beforeAll, describe, expect, test } from "bun:test";
import { isASAN } from "harness";
import { promisify } from "node:util";
import zlib from "node:zlib";

const input = Buffer.alloc(50_000);

// Each compressor allocates hundreds of KB of native state per call (deflate
// window ~256KB, brotli/zstd larger). A few thousand calls is enough for a
// leak of that state, or of a retained 50KB input buffer, to grow RSS by
// >100MB, far above the threshold below.
const upper = 1024 * 1024 * (isASAN ? 20 : 10);

// Quality is irrelevant to the leak assertion; the default (11) is ~40x slower.
const brotliOpts = { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 2 } };

type Sync = (buf: Buffer) => Buffer;
type Async = (buf: Buffer) => Promise<Buffer>;
const codecs: Array<[name: string, iters: number, compress: Sync | Async, sync: boolean]> = [
  ["deflate", 2_000, promisify(zlib.deflate), false],
  ["gzip", 2_000, promisify(zlib.gzip), false],
  ["deflateSync", 2_000, zlib.deflateSync, true],
  ["gzipSync", 2_000, zlib.gzipSync, true],
  ["brotliCompress", 1_000, b => promisify(zlib.brotliCompress)(b, brotliOpts), false],
  ["brotliCompressSync", 1_000, b => zlib.brotliCompressSync(b, brotliOpts), true],
  ["zstdCompress", 1_000, promisify(zlib.zstdCompress), false],
  ["zstdCompressSync", 1_000, zlib.zstdCompressSync, true],
];

describe("zlib compression does not leak memory", () => {
  beforeAll(() => {
    // Reach allocator steady state once so the first codec's baseline is not
    // skewed by startup page faults.
    for (let i = 0; i < 500; i++) zlib.deflateSync(input);
    Bun.gc(true);
  });

  test.each(codecs)(
    "%s",
    async (name, iters, compress, sync) => {
      const run = sync
        ? (n: number) => {
            let out: Buffer;
            for (let i = 0; i < n; i++) out = (compress as Sync)(input);
            return out!;
          }
        : async (n: number) => {
            let out: Buffer;
            for (let i = 0; i < n; i++) out = await (compress as Async)(input);
            return out!;
          };

      const sample = await run(1);
      expect(sample.length).toBeGreaterThan(0);

      await run(iters);
      Bun.gc(true);
      const baseline = process.memoryUsage.rss();

      await run(iters);
      Bun.gc(true);
      const after = process.memoryUsage.rss();

      const delta = after - baseline;
      expect(
        delta,
        `${name}: RSS grew ${(delta / 1024 / 1024).toFixed(1)}MB over ${iters} calls (limit ${(upper / 1024 / 1024).toFixed(0)}MB)`,
      ).toBeLessThan(upper);
    },
    60_000,
  );
});
