// usage: bun context-identifier-fixture.js <node|web> <identifier>
//
// Sets the identifier that the next script execution context draws, makes a Worker through that API
// (this file again, as the Worker's entry), and prints one line of JSON: what the Worker is on both
// sides, that a task posted to its context reaches it once it runs, that terminating it ends it,
// and that a task posted to the main thread's context still reaches the main thread.
import { setNextScriptExecutionContextIdentifier } from "bun:internal-for-testing";
import { once } from "node:events";
import fs from "node:fs";
import * as worker_threads from "node:worker_threads";

const [role, identifier] = process.argv.slice(2);

// A MessagePort is woken by a task posted to its context.
async function postToMainThread() {
  const { port1, port2 } = new MessageChannel();
  const received = new Promise(resolve => (port2.onmessage = event => resolve(event.data)));
  port1.postMessage("received");
  const data = await received;
  port2.close();
  return data;
}

if (role === "node") {
  setNextScriptExecutionContextIdentifier(Number(identifier));
  const worker = new worker_threads.Worker(import.meta.filename, { argv: ["node entry"] });
  const seenByParent = worker.threadId;
  const [seenByWorker] = await once(worker, "message");
  // Answered by a task posted to the worker's context.
  const heapStatistics = typeof (await worker.getHeapStatistics()).used_heap_size;
  const exitCode = await worker.terminate();
  const mainThread = await postToMainThread();
  console.log(JSON.stringify({ seenByParent, seenByWorker, heapStatistics, exitCode, mainThread }));
} else if (role === "node entry") {
  const { isMainThread, parentPort, threadId } = worker_threads;
  // What continues this script later carries the identifier of its context: a timer, and a thread pool job.
  await new Promise(resolve => setTimeout(resolve));
  await fs.promises.stat(".");
  // The listener keeps the worker alive, for the parent to terminate.
  parentPort.on("message", () => {});
  parentPort.postMessage({ isMainThread, threadId });
} else if (role === "web") {
  setNextScriptExecutionContextIdentifier(Number(identifier));
  const worker = new Worker(import.meta.url, { argv: ["web entry"] });
  const ask = message =>
    new Promise((resolve, reject) => {
      worker.onmessage = event => resolve(event.data);
      worker.onerror = event => reject(new Error(event.message));
      worker.postMessage(message);
    });
  const seenByParent = worker.threadId;
  // Queued until the worker runs.
  const whileStarting = await ask("posted while it starts");
  // Delivered by a task posted to the worker's context.
  const whileRunning = await ask("posted while it runs");
  const closed = new Promise(resolve => worker.addEventListener("close", resolve, { once: true }));
  worker.terminate();
  await closed;
  const mainThread = await postToMainThread();
  console.log(JSON.stringify({ seenByParent, whileStarting, whileRunning, mainThread }));
} else if (role === "web entry") {
  // Answers from a later turn of the loop, when the task that delivered the message has ended:
  // the next message then needs a task of its own.
  self.onmessage = event => setImmediate(() => postMessage({ echo: event.data, isMainThread: Bun.isMainThread }));
}
