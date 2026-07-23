/**
 * Memory leak measurement test for {@link Bun.spawn} with `stdout: "pipe"`.
 *
 * Each scenario spawns batches of child processes that write a fixed payload
 * to stdout, and compares the peak RSS observed over a short warmup phase to a
 * longer main phase. A real leak (#18316 / #20095) retains the per-process
 * pipe buffer across GC, so the main-phase peak climbs batch over batch and
 * the ratio blows past the threshold below.
 */
import { bunEnv, bunExe, isASAN, isCI, isWindows } from "harness";

describe.todoIf(
  /**
   * ASAN CI runs out of file descriptors? Or maybe it's virtual memory
   *
   * It causes the entire test runner to stop and get a little unstable.
   */
  isASAN && isCI,
)("Bun.spawn", () => {
  const MB = 1024 * 1024;

  /**
   * Bytes each child writes in the "read the pipe" scenarios. 2 MB × {@link batchSize}
   * gives a per-batch leak footprint (~40 MB) several times the observed no-leak
   * jitter while keeping the in-flight data small enough to run quickly.
   */
  const OUTPUT_BYTES = 2 * MB;

  const cmd = [
    bunExe(),
    "-e",
    `for (let b = Buffer.alloc(${OUTPUT_BYTES}, 88); b.length > 0;) b = b.slice(require("fs").writeSync(1, b));`,
  ];

  const cmd10 = [bunExe(), "-e", `require("fs").writeSync(1, Buffer.alloc(10, 88));`];

  async function readPipeAfterExit() {
    const proc = Bun.spawn({ cmd, stdout: "pipe", stderr: "ignore", stdin: "ignore", env: bunEnv });
    const exitCode = await proc.exited;
    const blob = await proc.stdout.blob();
    if (blob.size !== OUTPUT_BYTES) throw new Error(`expected ${OUTPUT_BYTES} bytes, got ${blob.size}`);
    if (exitCode !== 0) throw new Error(`child exited with ${exitCode}`);
  }

  async function dontRead() {
    const proc = Bun.spawn({ cmd: cmd10, stdout: "pipe", stderr: "ignore", stdin: "ignore", env: bunEnv });
    const exitCode = await proc.exited;
    if (exitCode !== 0) throw new Error(`child exited with ${exitCode}`);
  }

  async function readPipeBeforeExit() {
    const proc = Bun.spawn({ cmd, stdout: "pipe", stderr: "ignore", stdin: "ignore", env: bunEnv });
    const blob = await proc.stdout.blob();
    if (blob.size !== OUTPUT_BYTES) throw new Error(`expected ${OUTPUT_BYTES} bytes, got ${blob.size}`);
    const exitCode = await proc.exited;
    if (exitCode !== 0) throw new Error(`child exited with ${exitCode}`);
  }

  const batchSize = isWindows ? 10 : 20;
  const warmupBatches = 3;
  const mainBatches = 6;

  async function run(iterate: () => Promise<void>, bytesPerProcess: number) {
    /**
     * @param totalBatches # of batches to run
     * @returns peak RSS observed across the batches
     */
    async function phase(totalBatches: number) {
      let peak = 0;
      for (let batch = 0; batch < totalBatches; batch++) {
        const batchPromises: Promise<void>[] = [];
        for (let i = 0; i < batchSize; i++) batchPromises.push(iterate());
        await Promise.all(batchPromises);

        // Collect between batches so the next batch reuses the same pages instead of
        // growing the heap; otherwise uncollected Blob garbage makes RSS climb across
        // batches and the peak comparison sees a false positive.
        Bun.gc(true);

        peak = Math.max(peak, process.memoryUsage.rss());
      }
      return peak;
    }

    const warmupPeak = await phase(warmupBatches);
    const mainPeak = await phase(mainBatches);

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

    // The ratio check above loses sensitivity when the process base RSS is large
    // (debug/ASAN). Also bound the absolute growth at half of what the main phase
    // would retain if every pipe buffer leaked.
    const leakFootprint = mainBatches * batchSize * bytesPerProcess;
    expect(delta).toBeLessThan(Math.max(leakFootprint / 2, 64 * MB));
  }

  test("'pipe' stdout if read after exit should not leak memory", async () => {
    await run(readPipeAfterExit, OUTPUT_BYTES);
  }, 30_000);

  test("'pipe' stdout if not read should not leak memory", async () => {
    await run(dontRead, 10);
  }, 30_000);

  test.todoIf(isWindows)(
    "'pipe' stdout if read before exit should not leak memory",
    async () => {
      await run(readPipeBeforeExit, OUTPUT_BYTES);
    },
    30_000,
  );
});
