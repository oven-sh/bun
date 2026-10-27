const { workerData } = require("node:worker_threads");
const nativeTests = require("./build/Debug/napitests.node");

// Create unref'd threadsafe functions owned by the addon, then let this worker
// exit: the addon keeps its thread_count references across the worker's
// teardown and uses them afterwards from one of its own threads.
if (workerData?.lateFinalizer) {
  // Kept alive to worker exit, so its finalizer runs during env cleanup (not
  // GC) and registers another finalizer from there.
  globalThis.keep = nativeTests.create_object_whose_finalizer_creates_external_buffer();
} else if (workerData?.leak) {
  nativeTests.create_leaked_threadsafe_functions(workerData.leak, () =>
    console.log("worker: leaked tsfn must never be called"),
  );
} else {
  nativeTests.create_orphaned_threadsafe_functions(
    () => console.log("worker: released tsfn must never be called"),
    () => console.log("worker: called tsfn must never be called"),
  );
}
