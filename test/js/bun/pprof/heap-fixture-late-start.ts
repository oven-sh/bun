// Run by heap.test.ts: a profile that starts when a Worker has been allocating for a while.
import { once } from "node:events";
import { Worker } from "node:worker_threads";
import { decode } from "./pprof-decode";

const worker = new Worker(new URL("./heap-fixture-late-start-child.ts", import.meta.url));
const threadId = worker.threadId;
const exited = once(worker, "exit");

// Have the Worker allocate 16 MiB. `once` rejects when the Worker emits "error".
function another16MiB() {
  worker.postMessage("allocate");
  return Promise.race([
    once(worker, "message"),
    exited.then(([code]) => Promise.reject(new Error("the Worker exited: " + code))),
  ]);
}

await another16MiB(); // with no profile running
await another16MiB();
Bun.pprof.heap.start({ sampleInterval: 64 * 1024 });
await another16MiB();
const profile = decode(Bun.pprof.heap.stop());
worker.postMessage("exit");
await exited;

const samples = profile.samples.filter(s => s.labels.worker === threadId);
console.log(
  JSON.stringify({
    threadId,
    workerAllocSpace: samples.reduce((sum, s) => sum + s.values.alloc_space, 0),
  }),
);
