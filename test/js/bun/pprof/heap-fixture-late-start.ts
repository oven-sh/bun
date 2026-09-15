// Run by heap.test.ts: a profile that starts when a Worker has been allocating for a while.
import { Worker } from "node:worker_threads";
import { decode } from "./pprof-decode";

const worker = new Worker(new URL("./heap-fixture-late-start-child.ts", import.meta.url));
const threadId = worker.threadId;
let pending = Promise.withResolvers<void>();
let exiting = false;
worker.on("message", () => pending.resolve());
worker.on("error", error => pending.reject(error));
worker.on("exit", code => (exiting ? pending.resolve() : pending.reject(new Error("the Worker exited: " + code))));

// Have the Worker allocate 16 MiB.
function another16MiB() {
  pending = Promise.withResolvers<void>();
  worker.postMessage("allocate");
  return pending.promise;
}

await another16MiB(); // with no profile running
await another16MiB();
Bun.pprof.heap.start({ sampleInterval: 64 * 1024 });
await another16MiB();
const profile = decode(Bun.pprof.heap.stop());
pending = Promise.withResolvers<void>();
exiting = true;
worker.postMessage("exit");
await pending.promise;

const samples = profile.samples.filter(s => s.labels.worker === threadId);
console.log(
  JSON.stringify({
    threadId,
    workerAllocSpace: samples.reduce((sum, s) => sum + s.values.alloc_space, 0),
  }),
);
