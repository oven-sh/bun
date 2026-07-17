// process.exit() from inside worker.onmessage: JSEventListener::handleEvent
// has a JSLockHolder (RefPtr<VM>) on the stack, so the VM refcount is one
// higher than the two creation refs destructOnExit used to release. ~VM() and
// therefore Heap::lastChanceToFinalize() never ran, and any wrapper collectNow
// left conservatively reachable leaked its native m_ctx. Keep a Timeout
// wrapper live via globalThis so conservative reachability is deterministic.
declare var self: Worker;

if (!Bun.isMainThread) {
  self.onmessage = () => postMessage("ready");
} else {
  const worker = new Worker(import.meta.url);
  worker.onerror = (e: ErrorEvent) => {
    console.error("worker error:", e.message);
    process.exit(1);
  };
  worker.onmessage = () => {
    // Rooted via globalThis so collectNow()'s mark phase keeps the JSTimeout
    // alive regardless of stack layout; only lastChanceToFinalize frees it.
    (globalThis as any).__pin = setTimeout(() => {}, 1 << 30);
    console.log("OK");
    process.exit(0);
  };
  worker.postMessage({});
}
