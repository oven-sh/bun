import { expect, test } from "bun:test";
import { isASAN, rss } from "harness";
import { brotliCompressSync, constants, createBrotliCompress, createBrotliDecompress } from "zlib";

// ASAN's quarantine retains freed allocations (default 256 MB) so RSS deltas
// run far higher under bun-asan; widen the threshold there.
const MEMORY_GROWTH_LIMIT_MB = isASAN ? 400 : 50;

// This test verifies that calling reset() on Brotli streams doesn't leak memory.
// Before the fix, each reset() call would allocate a new Brotli encoder/decoder
// without freeing the previous one.

const iterations = 10_000;
const plain = Buffer.alloc(128 * 1024, "reset");
const oneByte = Buffer.alloc(1);

// Leaves the 128 KB in the window of the stream.
function fillAndReset(stream: any, input: Buffer) {
  stream._handle.writeSync(constants.BROTLI_OPERATION_PROCESS, input, 0, input.length, oneByte, 0, 1);
  stream.reset();
}

test("Brotli reset() should not leak memory", { timeout: 30_000 }, async () => {
  // Get baseline memory
  Bun.gc(true);
  await Bun.sleep(10);
  const baselineMemory = rss();

  const compressor = createBrotliCompress();

  for (let i = 0; i < iterations; i++) {
    fillAndReset(compressor, plain);
  }

  compressor.close();

  // Force GC and measure
  Bun.gc(true);
  await Bun.sleep(10);
  const finalMemory = rss();

  const memoryGrowth = finalMemory - baselineMemory;
  const memoryGrowthMB = memoryGrowth / 1024 / 1024;

  console.log(`Memory growth after ${iterations} reset() calls: ${memoryGrowthMB.toFixed(2)} MB`);

  // With 10k iterations and 128KB per leak, we'd expect over 1GB of leakage without the fix.
  // With the fix, memory growth should be minimal (under 50MB accounting for test overhead).
  expect(memoryGrowthMB).toBeLessThan(MEMORY_GROWTH_LIMIT_MB);
});

test("BrotliDecompress reset() should not leak memory", { timeout: 30_000 }, async () => {
  const compressed = brotliCompressSync(plain);

  Bun.gc(true);
  await Bun.sleep(10);
  const baselineMemory = rss();

  const decompressor = createBrotliDecompress();

  for (let i = 0; i < iterations; i++) {
    fillAndReset(decompressor, compressed);
  }

  decompressor.close();

  Bun.gc(true);
  await Bun.sleep(10);
  const finalMemory = rss();

  const memoryGrowth = finalMemory - baselineMemory;
  const memoryGrowthMB = memoryGrowth / 1024 / 1024;

  console.log(`Memory growth after ${iterations} reset() calls: ${memoryGrowthMB.toFixed(2)} MB`);

  expect(memoryGrowthMB).toBeLessThan(MEMORY_GROWTH_LIMIT_MB);
});
