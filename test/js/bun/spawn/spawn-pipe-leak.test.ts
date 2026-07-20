/**
 * Memory leak measurement test for {@link Bun.spawn}
 *
 * This test spawns processes that write about 32 KB of data to stdout
 * and then exits. We only await the `process.exited` promise without reading
 * any of the output data to test for potential memory leaks.
 */
import { bunExe, isASAN, isCI, isWindows } from "harness";

describe.todoIf(
  /**
   * ASAN CI runs out of file descriptors? Or maybe it's virtual memory
   *
   * It causes the entire test runner to stop and get a little unstable.
   */
  isASAN && isCI,
)("Bun.spawn", () => {
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
    await process.stdout.blob();
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
    await process.stdout.blob();
    await process.exited;
  }

  async function run(iterate: () => Promise<void>) {
    /**
     * @param batchSize # of processes to spawn in parallel in each batch
     * @param totalBatches # of batches to run
     * @returns peak RSS observed across the batches
     */
    async function testSpawnMemoryLeak(batchSize: number, totalBatches: number) {
      log("Starting memory leak test...");
      log(`Initial memory usage: ${Math.round(process.memoryUsage.rss() / MB)} MB`);

      let peak = 0;
      for (let batch = 0; batch < totalBatches; batch++) {
        const batchPromises: Promise<void>[] = [];

        for (let i = 0; i < batchSize; i++) {
          // Use an async IIFE that doesn't return anything
          // This should help the GC clean up resources
          batchPromises.push(iterate());
        }

        // Wait for all processes in this batch to complete
        await Promise.all(batchPromises);

        // Collect between batches so the next batch reuses the same pages instead of
        // growing the heap; otherwise uncollected Blob garbage makes RSS climb across
        // batches and the peak comparison sees a false positive.
        Bun.gc(true);

        const rss = process.memoryUsage.rss();
        peak = Math.max(peak, rss);

        // Log progress after each batch
        log(`Batch ${batch + 1}/${totalBatches} completed (${(batch + 1) * batchSize} processes)`);
        log(`Current memory usage: ${Math.round(rss / MB)} MB`);
      }

      return peak;
    }

    const batchSize = process.platform === "win32" ? 10 : 50;

    // Warmup
    const warmupPeak = await testSpawnMemoryLeak(batchSize, 5);

    // Run the test
    const mainPeak = await testSpawnMemoryLeak(batchSize, 10);

    log("Memory leak test completed");
    log(`Final memory usage: ${Math.round(process.memoryUsage.rss() / MB)} MB`);

    // Compare the max RSS seen across batches rather than a single post-run sample.
    // mimalloc returns pages on its own schedule, so one sample can land anywhere;
    // the max over N batches is stable and still grows per batch under #18316/#20095.
    const delta = mainPeak - warmupPeak;
    const pct = delta / warmupPeak;
    console.log(
      `Peak RSS: warmup ${Math.round(warmupPeak / MB)} MB -> main ${Math.round(mainPeak / MB)} MB, ` +
        `delta ${Math.round(delta / MB)} MB (${Math.round(100 * pct)}%)`,
    );
    expect(pct).toBeLessThan(0.8);
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
