import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";

// ScriptExecutionContext::postTaskConcurrently heap-allocates an EventLoopTask
// and Bun__queueTaskConcurrently wraps it in a heap-allocated ConcurrentTask.
// The only free path for both is the target event loop actually ticking the
// task (tickConcurrentWithCount → performTask → delete this). When a
// cross-thread task (e.g. Worker.postMessage's drain task, which captures a
// Ref<Worker> and therefore the entire m_toWorker.queue of buffered
// messages) lands in a worker's concurrent_tasks after the worker has left
// its event loop but before ~GlobalObject removes the worker's context from
// the global map, the task — and everything it transitively references —
// leaked until process exit.
//
// Skipped on Windows: Atomics.wait on the main thread + RSS-based
// measurement are not reliable there.
test.skipIf(isWindows)(
  "postMessage to a Worker past its event loop does not leak the queued drain task",
  async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        import { Worker } from "worker_threads";

        // The worker signals via SharedArrayBuffer when it has entered
        // process.on('beforeExit') — at that point it has left its event
        // loop and will next run shutdown() without ticking again. Messages
        // posted during that window allocate an EventLoopTask + ConcurrentTask
        // (the drain task, holding Ref<Worker> and thus the whole buffered
        // queue) that the worker will never run.
        const workerBody = \`
          const { workerData } = require("worker_threads");
          const arr = new Int32Array(workerData);
          process.on("beforeExit", () => {
            Atomics.store(arr, 0, 1);
            Atomics.notify(arr, 0);
            const t = Date.now();
            while (Date.now() - t < 100) {}
          });
        \`;

        async function round() {
          const sab = new SharedArrayBuffer(8);
          const arr = new Int32Array(sab);
          const w = new Worker(workerBody, { eval: true, workerData: sab });
          const closed = new Promise(r => w.once("exit", r));
          // Block until the worker is inside beforeExit (past its event
          // loop, before JSC teardown removes its ScriptExecutionContext).
          Atomics.wait(arr, 0, 0);
          // First postMessage posts one drain task (EventLoopTask +
          // ConcurrentTask capturing Ref<Worker>) into the worker's
          // concurrent queue; the rest buffer in m_toWorker.queue held by
          // that Ref. None will ever be drained.
          for (let i = 0; i < 300; i++) {
            try { w.postMessage(new ArrayBuffer(128 * 1024)); } catch {}
          }
          await closed;
        }

        // Warm-up: establish allocator high-water mark.
        for (let i = 0; i < 4; i++) await round();
        Bun.gc(true);
        Bun.gc(true);
        const rssBefore = process.memoryUsage().rss;

        for (let i = 0; i < 20; i++) await round();
        Bun.gc(true);
        Bun.gc(true);
        const rssAfter = process.memoryUsage().rss;
        const deltaMB = (rssAfter - rssBefore) / 1024 / 1024;

        // Without the fix: ~20 * 300 * 128 KB ≈ 750 MB of SerializedScriptValue
        // retained via the leaked Ref<Worker> → m_toWorker.queue (observed
        // ~900 MB with overhead).
        // With the fix: drainCancelledTasks frees the drain task in
        // shutdown(), the Ref is dropped, and the allocator reuses pages
        // (observed near-zero or slightly negative).
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
