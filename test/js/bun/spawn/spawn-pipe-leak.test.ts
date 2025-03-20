import { bunExe } from "harness";

/**
 * Memory leak measurement test for Bun.spawn
 *
 * This test spawns processes that write about 512 KB of data to stdout
 * and then exits. We only await the process.exited promise without reading
 * any of the output data to test for potential memory leaks.
 *
 * The test runs in batches of 1000 parallel processes to efficiently test
 * for memory leaks over approximately 100,000 iterations.
 */
describe("Bun.spawn", () => {
  const DEBUG_LOGS = false;
  const log = (...args: any[]) => DEBUG_LOGS && console.log(...args);
  test("'pipe' stdout should not leak memory", async () => {
    async function testSpawnMemoryLeak(batchSize: number, totalBatches: number) {
      // Create a command that will generate ~512 KB of output
      const cmd = [bunExe(), "-e", "process.stdout.write(Buffer.alloc(32 * 1024, 'X'))"];

      log("Starting memory leak test...");
      log(`Initial memory usage: ${Math.round(process.memoryUsage.rss() / 1024 / 1024)} MB`);

      for (let batch = 0; batch < totalBatches; batch++) {
        const batchPromises: Promise<void>[] = [];

        for (let i = 0; i < batchSize; i++) {
          // Use an async IIFE that doesn't return anything
          // This should help the GC clean up resources
          batchPromises.push(
            (async (): Promise<void> => {
              const process = Bun.spawn({
                cmd,
                stdout: "pipe", // We pipe stdout but never read from it
                stderr: "ignore",
                stdin: "ignore",
              });

              // Only await the exit, don't read any data
              await process.exited;

              // Don't return anything to help GC
              Bun.gc(true);
            })(),
          );
        }

        // Wait for all processes in this batch to complete
        await Promise.all(batchPromises);

        // Force garbage collection
        Bun.gc(true);

        // Log progress after each batch
        log(`Batch ${batch + 1}/${totalBatches} completed (${(batch + 1) * batchSize} processes)`);
        log(`Current memory usage: ${Math.round(process.memoryUsage.rss() / 1024 / 1024)} MB`);
      }
    }

    // Warmup
    await testSpawnMemoryLeak(5, 2);
    const memBefore = process.memoryUsage();

    // Run the test
    await testSpawnMemoryLeak(10, 5);
    // Check memory after the test
    const memAfter = process.memoryUsage();

    log("Memory leak test completed");
    log(`Final memory usage: ${Math.round(process.memoryUsage.rss() / 1024 / 1024)} MB`);
    log(`Memory difference: ${Math.round((process.memoryUsage.rss() - memBefore.rss) / 1024 / 1024)} MB`);

    // should not have grown more than 25%
    const delta = memAfter.rss - memBefore.rss;
    expect(delta / memBefore.rss).toBeLessThan(0.25);
  }, 20_000);
});
