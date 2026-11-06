// Terminates workers in which Python is starting. Wherever that catches them, the process goes on.
import { isMainThread, parentPort } from "node:worker_threads";

if (isMainThread) {
  for (let round = 0; round < 2; ++round) {
    await Promise.all(
      Array.from({ length: 12 }, async (_, index) => {
        const worker = new Worker(import.meta.url);
        const closed = new Promise(resolve => worker.addEventListener("close", resolve));
        await new Promise(resolve => worker.addEventListener("message", resolve, { once: true }));
        // Not a wait for anything: so that it comes at one time and another.
        await new Promise(resolve => setTimeout(resolve, index % 4));
        worker.terminate();
        await closed;
      }),
    );
  }
  console.log("survived");
} else {
  parentPort!.postMessage("starting");
  // Not an import: after the message.
  require("python:builtins");
  setInterval(() => {}, 1000);
}
