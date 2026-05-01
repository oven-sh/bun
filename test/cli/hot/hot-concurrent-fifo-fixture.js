// Fixture for hot-concurrent-fifo.test.ts — run with `bun --hot`.
//
// Sets up the event-loop task FIFO so that `tickConcurrentWithCount` is
// entered with `head > 0` and `count > 0` (reachable via HotReloadTask's
// early return from `tickQueueWithCount`) while a fresh batch of
// ConcurrentTasks is waiting. If `tickConcurrentWithCount` only writes into
// the contiguous tail of the ring buffer, the tail of that batch is silently
// dropped and the corresponding promises never resolve.
//
// `crypto.subtle.digest` with a sub-64-byte message computes synchronously
// and posts its callback via `ScriptExecutionContext::postTaskTo`, which
// always routes through `postTaskConcurrently` — so each call pushes exactly
// one ConcurrentTask to the main thread's queue before returning. That gives
// us precise, single-threaded control over the batch layout.
import { writeFileSync, readFileSync } from "node:fs";

globalThis.__run ??= 0;
globalThis.__run++;
globalThis.__resolved ??= 0;
globalThis.__total ??= 0;
globalThis.__phase_d_fired ??= false;

const small = new Uint8Array(1);
function fire(n) {
  for (let i = 0; i < n; i++) {
    globalThis.__total++;
    crypto.subtle.digest("SHA-256", small).then(() => {
      globalThis.__resolved++;
      // Phase D: while draining phase A (well before the HotReloadTask at
      // position ~50), synchronously enqueue 50 more ConcurrentTasks. These
      // are what the tickConcurrent() immediately after the early-return
      // will pop, with the FIFO at head=51, count=10 in a 64-slot buffer —
      // writableSlice(0) has length 3, writableLength is 54.
      if (globalThis.__resolved === 40 && !globalThis.__phase_d_fired) {
        globalThis.__phase_d_fired = true;
        fire(50);
      }
    });
  }
}

if (globalThis.__run === 1) {
  // Phase A: 50 ConcurrentTasks land before the HotReloadTask.
  fire(50);

  // Trigger a hot reload. The watcher thread enqueues a HotReloadTask (also a
  // ConcurrentTask) after phase A in FIFO order.
  const self = import.meta.path;
  writeFileSync(self, readFileSync(self, "utf8"));
  Bun.sleepSync(250);

  // Phase C: 10 ConcurrentTasks after the HotReloadTask so that `count > 0`
  // when tickQueueWithCount early-returns and `head` is not reset.
  fire(10);

  // Report once the event loop has settled. The timer itself lives on the
  // uv/usockets loop, not in the task FIFO, so it can't be dropped by the
  // bug under test.
  globalThis.__report ??= setTimeout(() => {
    const out = {
      run: globalThis.__run,
      total: globalThis.__total,
      resolved: globalThis.__resolved,
    };
    console.log(JSON.stringify(out));
    process.exit(out.resolved === out.total ? 0 : 1);
  }, 1000);
}
