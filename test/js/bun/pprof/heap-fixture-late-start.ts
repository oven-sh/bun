// Run by heap.test.ts: a profile that starts when a Worker has been allocating for a while.
import { Worker } from "node:worker_threads";
import { decode } from "./pprof-decode";

const worker = new Worker(new URL("./heap-fixture-late-start-child.ts", import.meta.url));
const threadId = worker.threadId;
const { promise: exited, resolve: onExit } = Promise.withResolvers<void>();
worker.on("exit", () => onExit());

// Have the Worker allocate 16 MiB.
function another16MiB() {
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  worker.once("message", () => resolve());
  worker.once("error", reject);
  worker.postMessage("mark");
  return promise;
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
