/**
 * Memory leak measurement test for {@link Bun.spawn}
 *
 * This test spawns processes that write about 32 KB of data to stdout
 * and then exits. We only await the `process.exited` promise without reading
 * any of the output data to test for potential memory leaks.
 */
import { bunExe, isWindows } from "harness";

describe("Bun.spawn", () => {
  const DEBUG_LOGS = true; // turn this on to see debug logs
  const log = (...args: any[]) => DEBUG_LOGS && console.log(...args);

  const MB = 1024 * 1024;

  // Create a command that will generate ~512 KB of output
  const cmd = [
    bunExe(),
    "-e",
    `for (let buffer = Buffer.alloc(1024 * 1024 * 8, 'X'); buffer.length > 0;) {
    const written = require('fs').writeSync(1, buffer);
    buffer = buffer.slice(written);
}`,
  ];

  const cmd10 = [
    bunExe(),
    "-e",
    `for (let buffer = Buffer.alloc(10, 'X'); buffer.length > 0;) {
    const written = require('fs').writeSync(1, buffer);
    buffer = buffer.slice(written);
}`,
  ];

  async function readPipeAfterExit() {
    const process = Bun.spawn({
      cmd,
      stdout: "pipe",
      stderr: "ignore",
      stdin: "ignore",
    });
    await process.exited;
    await Bun.readableStreamToBlob(process.stdout);
  }

  async function dontRead() {
    const process = Bun.spawn({
      cmd: cmd10,
      stdout: "pipe",
      stderr: "ignore",
      stdin: "ignore",
    });
    await process.exited;
  }

  async function readPipeBeforeExit() {
    const process = Bun.spawn({
      cmd,
      stdout: "pipe",
      stderr: "ignore",
      stdin: "ignore",
    });
    await Bun.readableStreamToBlob(process.stdout);
    await process.exited;
  }

  async function run(iterate: () => Promise<void>) {
    /**
     * @param batchSize # of processes to spawn in parallel in each batch
     * @param totalBatches # of batches to run
     */
    async function testSpawnMemoryLeak(batchSize: number, totalBatches: number) {
      log("Starting memory leak test...");
      log(`Initial memory usage: ${Math.round(process.memoryUsage.rss() / MB)} MB`);

      for (let batch = 0; batch < totalBatches; batch++) {
        const batchPromises: Promise<void>[] = [];

        for (let i = 0; i < batchSize; i++) {
          // Use an async IIFE that doesn't return anything
          // This should help the GC clean up resources
          batchPromises.push(iterate());
        }

        // Wait for all processes in this batch to complete
        await Promise.all(batchPromises);

        // Log progress after each batch
        log(`Batch ${batch + 1}/${totalBatches} completed (${(batch + 1) * batchSize} processes)`);
        log(`Current memory usage: ${Math.round(process.memoryUsage.rss() / MB)} MB`);
      }

      // Force garbage collection after all batches have completed
      Bun.gc(true);
    }

    const batchSize = process.platform === "win32" ? 10 : 50;

    // Warmup
    await testSpawnMemoryLeak(batchSize, 5);
    const memBefore = process.memoryUsage();

    // Run the test
    await testSpawnMemoryLeak(batchSize, 10);
    const memAfter = process.memoryUsage();

    log("Memory leak test completed");
    log(`Final memory usage: ${Math.round(process.memoryUsage.rss() / MB)} MB`);
    log(`Memory difference: ${Math.round((process.memoryUsage.rss() - memBefore.rss) / MB)} MB`);

    // should not have grown more than 50%
    const delta = memAfter.rss - memBefore.rss;
    const pct = delta / memBefore.rss;
    console.log(`RSS delta: ${delta / MB}MB (${Math.round(100 * pct)}%)`);
    expect(pct).toBeLessThan(0.5);
  }

  test("'pipe' stdout if read after exit should not leak memory", async () => {
    await run(readPipeAfterExit);
  }, 30_000);

  test("'pipe' stdout if not read should not leak memory", async () => {
    await run(dontRead);
  }, 30_000);

  test.todoIf(isWindows)(
    "'pipe' stdout if read before exit should not leak memory",
    async () => {
      await run(readPipeBeforeExit);
    },
    30_000,
  );
});
