const nativeTests = require("./build/Debug/napitests.node");

// Create three unref'd threadsafe functions owned by the addon, then let this
// worker exit: the addon keeps its thread_count references across the worker's
// teardown and uses them afterwards from one of its own threads.
nativeTests.create_orphaned_threadsafe_functions(
  () => console.log("worker: released tsfn must never be called"),
  () => console.log("worker: called tsfn must never be called"),
  () => console.log("worker: called-then-released tsfn must never be called"),
);
