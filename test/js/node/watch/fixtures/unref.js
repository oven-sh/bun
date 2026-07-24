import fs from "fs";
// The process must exit on its own; the 4s abort (which only emits 'close')
// fires only if the unref'd watcher wrongly kept the event loop alive.
fs.watch(import.meta.path, { signal: AbortSignal.timeout(4000) })
  .on("error", err => {
    console.error(err.message);
    process.exit(1);
  })
  .on("close", () => {
    console.error("process did not exit before the abort timeout");
    process.exit(1);
  })
  .unref();
