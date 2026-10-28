// Terminate a worker that still has pending Atomics.waitAsync tickets on a
// SharedArrayBuffer the parent keeps alive. ~VM() -> WaiterListManager::
// unregister reaches DeferredWorkTimer::scheduleWorkSoon for every such ticket;
// the resulting task must be dropped, not enqueued into the dead event loop.
declare var self: Worker;

if (!Bun.isMainThread) {
  self.onmessage = (e: MessageEvent) => {
    const i32 = new Int32Array(e.data as SharedArrayBuffer);
    for (let i = 0; i < 32; i++) {
      const r = Atomics.waitAsync(i32, 0, 0, 60_000);
      if (r.async) r.value.then(() => {});
    }
    postMessage("ready");
  };
} else {
  const sab = new SharedArrayBuffer(4);
  const worker = new Worker(import.meta.url);
  worker.onerror = (e: ErrorEvent) => {
    console.error("worker error:", e.message);
    process.exit(1);
  };
  worker.onmessage = async () => {
    // Drive a few notifies so some tickets are settled cross-thread before
    // teardown; the rest reach ~VM() with a live ticket.
    Atomics.notify(new Int32Array(sab), 0, 4);
    await worker.terminate();
    console.log("OK");
    process.exit(0);
  };
  worker.postMessage(sab);
}
