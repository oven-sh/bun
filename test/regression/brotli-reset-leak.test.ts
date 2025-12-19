import { expect, test } from "bun:test";
import { createBrotliCompress, createBrotliDecompress } from "zlib";

// This test verifies that calling reset() on Brotli streams doesn't leak memory.
// Before the fix, each reset() call would allocate a new Brotli encoder/decoder
// without freeing the previous one.

test("Brotli reset() should not leak memory", { timeout: 30_000 }, async () => {
  const iterations = 100_000;

  // Get baseline memory
  Bun.gc(true);
  await Bun.sleep(10);
  const baselineMemory = process.memoryUsage.rss();

  const compressor = createBrotliCompress();

  // Reset many times - before the fix, each reset leaks ~400KB (brotli encoder state)
  for (let i = 0; i < iterations; i++) {
    compressor.reset();
  }

  compressor.close();

  // Force GC and measure
  Bun.gc(true);
  await Bun.sleep(10);
  const finalMemory = process.memoryUsage.rss();

  const memoryGrowth = finalMemory - baselineMemory;
  const memoryGrowthMB = memoryGrowth / 1024 / 1024;

  console.log(`Memory growth after ${iterations} reset() calls: ${memoryGrowthMB.toFixed(2)} MB`);

  // With 100k iterations and ~400KB per leak, we'd expect ~40GB of leakage without the fix.
  // With the fix, memory growth should be minimal (under 50MB accounting for test overhead).
  expect(memoryGrowthMB).toBeLessThan(50);
});

test("BrotliDecompress reset() should not leak memory", { timeout: 30_000 }, async () => {
  const iterations = 100_000;

  Bun.gc(true);
  await Bun.sleep(10);
  const baselineMemory = process.memoryUsage.rss();

  const decompressor = createBrotliDecompress();

  for (let i = 0; i < iterations; i++) {
    decompressor.reset();
  }

  decompressor.close();

  Bun.gc(true);
  await Bun.sleep(10);
  const finalMemory = process.memoryUsage.rss();

  const memoryGrowth = finalMemory - baselineMemory;
  const memoryGrowthMB = memoryGrowth / 1024 / 1024;

  console.log(`Memory growth after ${iterations} reset() calls: ${memoryGrowthMB.toFixed(2)} MB`);

  expect(memoryGrowthMB).toBeLessThan(50);
});
