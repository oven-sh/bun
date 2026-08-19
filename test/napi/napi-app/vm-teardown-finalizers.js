// Usage: bun vm-teardown-finalizers.js <addon target> <kind>[,<kind>...] [--main-thread]
//
// Loads build/Debug/<addon target>.node (see test_vm_teardown_finalizers.c)
// and registers one pinned finalizer per kind, in a worker_threads Worker
// that then exits, or on the main thread with --main-thread (run under
// BUN_DESTRUCT_VM_ON_EXIT=1 so that the main thread's VM is destroyed too).
// Any other argument is ignored.
const { Worker, isMainThread, workerData } = require("node:worker_threads");
const path = require("node:path");

function setup({ addon, kinds }) {
  const { setup } = require(path.join(__dirname, "build/Debug", addon + ".node"));
  for (const kind of kinds) setup(kind);
  console.log("registered:", kinds.join(","));
}

if (!isMainThread) {
  setup(workerData);
} else {
  const [addon, kindList] = process.argv.slice(2);
  const args = { addon, kinds: kindList.split(",") };
  if (process.argv.includes("--main-thread")) {
    setup(args);
  } else {
    new Worker(__filename, { workerData: args }).on("exit", code => console.log("worker exited:", code));
  }
}
