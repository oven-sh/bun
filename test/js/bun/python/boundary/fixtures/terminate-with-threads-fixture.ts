// Terminates a worker in which a thread that Python started is running.
import { isMainThread, parentPort } from "node:worker_threads";

if (isMainThread) {
  const worker = new Worker(import.meta.url);
  await new Promise(resolve => worker.addEventListener("message", resolve, { once: true }));
  const closed = new Promise(resolve => worker.addEventListener("close", resolve));
  worker.terminate();
  await closed;
  // The thread wakes up every millisecond.
  const end = performance.now() + 200;
  while (performance.now() < end) await new Promise(resolve => setImmediate(resolve));
  console.log("survived");
} else {
  const { exec, dict } = require("python:builtins");
  exec(
    `
import threading, time
def work():
    while True: time.sleep(0.001)
threading.Thread(target=work, daemon=True).start()
`,
    dict(),
  );
  parentPort!.postMessage("started");
}
