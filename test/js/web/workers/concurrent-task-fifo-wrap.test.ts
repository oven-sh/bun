import { expect, test } from "bun:test";

// Regression test for tickConcurrentWithCount dropping ConcurrentTasks when the
// tasks FIFO ring buffer's writable region is non-contiguous (head > 0 with
// existing tasks queued). Previously writableSlice(0) returned only the first
// contiguous chunk and the loop `break`ed early, leaking the remaining tasks
// and never running their wrapped CppTask/EventLoopTask.
//
// Reproduction: a Worker's BroadcastChannel onmessage handler triggers
// HTMLRewriter.transform() with an async element handler. HTMLRewriter calls
// waitForPromise() which reenters tick() -> tickConcurrent() while earlier
// sibling tasks are still in the FIFO (so head > 0 and count > 0). A
// SharedArrayBuffer coordinates the main thread to post a second burst of
// messages precisely before the reentrant tickConcurrent runs, so the popped
// batch exceeds the first contiguous writable chunk but still fits in total
// writable capacity (no realloc).
//
// BroadcastChannel is used (not Worker.postMessage) because BroadcastChannel
// creates one ConcurrentTask per postMessage per subscriber with no batching,
// whereas Worker.postMessage batches all queued messages into a single drain
// task.
test("tickConcurrent does not drop tasks when the FIFO writable region wraps", async () => {
  // The tasks FIFO has an initial capacity of 64. Choose N so that after the
  // worker pops the first burst and reads reenterDepth tasks, the remaining
  // writable region wraps around with a short first chunk.
  //
  // After K=reenterDepth readItems: head=K, count=N-K, tail=N.
  //   first contiguous writable chunk = buf.len - tail = 64 - N
  //   total writable = buf.len - count = 64 - N + K
  // Pick M = total writable so ensureUnusedCapacity does not grow the buffer;
  // then K of those M tasks land in the wrapped region and were previously
  // dropped.
  const BUF_LEN = 64;
  const REENTER_DEPTH = 3;
  const N = 50;
  const M = BUF_LEN - N + REENTER_DEPTH; // 17
  const TOTAL = N + M;

  const sab = new SharedArrayBuffer(16);
  const flags = new Int32Array(sab);
  const channel = "concurrent-task-fifo-wrap-" + Math.random().toString(36).slice(2);

  const worker = new Worker(new URL("./concurrent-task-fifo-wrap-worker.js", import.meta.url));
  const bc = new BroadcastChannel(channel);
  try {
    await new Promise<void>((resolve, reject) => {
      worker.onerror = reject;
      worker.onmessage = e => {
        if (e.data.kind === "ready") resolve();
      };
      worker.postMessage({ kind: "init", sab, channel });
    });

    const doneP = new Promise<number[]>((resolve, reject) => {
      worker.onerror = reject;
      worker.onmessage = e => {
        if (e.data.kind === "done") resolve(e.data.received);
      };
    });

    // First burst: N messages. BroadcastChannel creates one ConcurrentTask per
    // postMessage (no batching), pushed synchronously onto the worker's
    // concurrent_tasks queue before postMessage returns. The worker is blocked
    // spinning inside its "init" handler until flags[3] is set below, so all N
    // land in concurrent_tasks before any are popped.
    for (let i = 0; i < N; i++) {
      bc.postMessage({ id: i, reenterDepth: REENTER_DEPTH });
    }
    Atomics.store(flags, 3, 1);

    // Block until the worker is REENTER_DEPTH tasks deep and about to reenter
    // tick(). Atomics.wait on the main thread is fine here: the worker is on
    // its own thread. Bounded wait so a worker-side failure surfaces as a test
    // failure instead of parking the test runner in a futex forever (the
    // event-loop-based per-test timeout cannot fire while this thread is
    // blocked).
    expect(Atomics.wait(flags, 0, 0, 10_000)).not.toBe("timed-out");

    // Second burst: M messages. These land in the worker's concurrent_tasks
    // queue and are popped by the reentrant tickConcurrent().
    for (let i = N; i < TOTAL; i++) {
      bc.postMessage({ id: i, reenterDepth: REENTER_DEPTH });
    }
    Atomics.store(flags, 1, 1);

    // Wait for the worker to finish its reentrant processing before probing.
    expect(Atomics.wait(flags, 2, 0, 10_000)).not.toBe("timed-out");

    // The finalize probe goes through Worker.postMessage (batched, fresh
    // tickConcurrent with head=0), so it is never itself subject to the wrap.
    // The worker replies with every message id it actually received.
    worker.postMessage({ kind: "finalize" });

    const received = await doneP;
    expect(received).toEqual(Array.from({ length: TOTAL }, (_, i) => i));
  } finally {
    bc.close();
    worker.terminate();
  }
});
