// Awaits the addon's uv_queue_work promise at top level, as the entry of a
// worker (test_promise_with_uv_queue_work_in_worker in module.js, mode in
// workerData) or of the main thread (mode in argv). Either way the after-work
// callback runs inside the wait for this module, not in the ordinary run loop,
// and a worker still awaiting when its loop goes idle exits with code 13.
//
// Modes: "resolve" logs the value; "reject" throws from the reaction instead;
// "callback-throws" has the callback call a throwing function and logs what
// the process reports, then the value.
import { createRequire } from "node:module";
import { isMainThread, workerData } from "node:worker_threads";

const nativeTests = createRequire(import.meta.url)("./build/Debug/napitests.node");
const mode = isMainThread ? process.argv[2] : workerData;
if (!["resolve", "reject", "callback-throws"].includes(mode)) {
  throw new Error(`unknown mode ${JSON.stringify(mode)}`);
}

let callback;
if (mode === "callback-throws") {
  process.on("uncaughtException", err => console.log("uncaughtException", err.message));
  callback = () => {
    throw new Error("thrown from after_work_cb");
  };
}

let promise = nativeTests.create_promise_with_uv_queue_work(callback);
if (mode === "reject") {
  promise = promise.then(() => {
    throw new Error("thrown in the reaction");
  });
}
console.log(await promise);
