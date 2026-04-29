import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";

// ScriptExecutionContext::postTaskConcurrently heap-allocates an EventLoopTask
// and Bun__queueTaskConcurrently wraps it in a heap-allocated ConcurrentTask.
// The only free path for both is the target event loop actually running the
// task (tickConcurrentWithCount → performTask → delete this). If the parent
// posts messages that land in the worker's concurrent_tasks queue after the
// worker has left its spin loop but before ~GlobalObject removes the worker's
// ScriptExecutionContext from the global map, both allocations — and the
// captured SerializedScriptValue — leaked until process exit.
//
// Skipped on Windows: the test widens the teardown window via a busy-wait in
// the worker's process.on('exit') handler, and measures the leak via RSS.
// On Windows the exit-handler stall does not hold (the teardown window
// collapses to near-zero so nothing lands in the queue) and working-set size
// does not shrink back after the parent-side serialization buffers are
// freed, so the RSS check cannot distinguish fixed from unfixed. The drain
// itself (EventLoop.drainCancelledTasks) is platform-independent.
test.skipIf(isWindows)(
  "postMessage to a terminating Worker does not leak EventLoopTask/ConcurrentTask",
  async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        // Stall inside process.on('exit') so the teardown window (between
        // the worker leaving its event loop and removeFromContextsMap())
        // is wide enough for the parent's postMessage flood to land in the
        // worker's concurrent task queue.
        const workerSrc = "data:text/javascript," + encodeURIComponent(\`
          self.onmessage = () => {};
          process.on('exit', () => { const t = Date.now(); while (Date.now() - t < 100) {} });
        \`);

        async function round() {
          const w = new Worker(workerSrc);
          await new Promise(r => w.addEventListener("open", r, { once: true }));
          const closed = new Promise(r => w.addEventListener("close", r, { once: true }));
          w.terminate();
          // Worker is now tearing down (exit handler busy-waits ~100 ms).
          // Every postMessage here allocates an EventLoopTask + ConcurrentTask
          // that the worker will never tick.
          for (let i = 0; i < 300; i++) {
            try { w.postMessage(new ArrayBuffer(128 * 1024)); } catch {}
          }
          await closed;
        }

        // Warm-up: establish allocator high-water mark so measured rounds can
        // reuse freed pages once the tasks are drained on termination.
        for (let i = 0; i < 4; i++) await round();
        Bun.gc(true);
        Bun.gc(true);
        const rssBefore = process.memoryUsage().rss;

        for (let i = 0; i < 20; i++) await round();
        Bun.gc(true);
        Bun.gc(true);
        const rssAfter = process.memoryUsage().rss;
        const deltaMB = (rssAfter - rssBefore) / 1024 / 1024;

        // Without the fix: ~20 rounds * 300 msgs * 128 KB ≈ 750 MB of
        // SerializedScriptValue retained in undrained concurrent_tasks
        // (observed ~215-300 MB depending on scheduling).
        // With the fix: queue is drained in exitAndDeinit, observed ~20-40 MB
        // of allocator noise.
        if (deltaMB > 100) {
          console.error("FAIL: RSS grew by", deltaMB.toFixed(2), "MB across measured rounds");
          process.exit(1);
        }
        console.log("PASS: delta", deltaMB.toFixed(2), "MB");
      `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // ASAN builds print a startup warning about JSC signal handlers; strip it
    // so we can still assert the subprocess produced no other stderr output.
    const stderrFiltered = stderr
      .split(/\r?\n/)
      .filter(line => line && !line.startsWith("WARNING: ASAN interferes"))
      .join("\n");
    expect(stderrFiltered).toBe("");
    expect(stdout).toContain("PASS");
    expect(exitCode).toBe(0);
  },
  60_000,
);
