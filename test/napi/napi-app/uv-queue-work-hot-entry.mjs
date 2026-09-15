// Run with --hot. Queues the addon's work, then fails at top level: with an
// error counted, the loop is never alive again, so the after-work callback
// runs inside the park --hot falls back to (tick_possibly_forever) instead of
// an ordinary turn. The callback installs the listener (the top-level error
// has to stay unhandled to get there) and then throws; that throw has to be
// reported from the park, and the reaction still has to run, or the process
// never reaches exit(0).
import { createRequire } from "node:module";

const nativeTests = createRequire(import.meta.url)("./build/Debug/napitests.node");

nativeTests
  .create_promise_with_uv_queue_work(() => {
    process.on("uncaughtException", err => console.log("uncaughtException", err.message));
    throw new Error("thrown from after_work_cb");
  })
  .then(value => {
    console.log(value);
    process.exit(0);
  });

throw new Error("entry failed");
