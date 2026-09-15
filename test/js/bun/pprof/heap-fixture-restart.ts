// Run by heap.test.ts: a second profile does not go on with a thread's sampling state of the first.
import { once } from "node:events";
import { Worker } from "node:worker_threads";
import { decode } from "./pprof-decode";

const worker = new Worker(new URL("./heap-fixture-restart-child.ts", import.meta.url));
const threadId = worker.threadId;
const exited = once(worker, "exit");

// Have the Worker allocate 32 MiB. `once` rejects when the Worker emits "error".
function another32MiB() {
  worker.postMessage("allocate");
  return Promise.race([
    once(worker, "message"),
    exited.then(([code]) => Promise.reject(new Error("the Worker exited: " + code))),
  ]);
}

// The Worker's first sample gives it a distance to the next one that is drawn around 256 MiB.
Bun.pprof.heap.start({ sampleInterval: 256 * 1024 * 1024 });
await another32MiB();
Bun.pprof.heap.stop();
// It allocates nothing between the stop and this start.
Bun.pprof.heap.start({ sampleInterval: 64 * 1024 });
await another32MiB();
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
