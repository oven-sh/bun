// Run by heap.test.ts: a Worker's allocations, read after it has exited and while it runs.
import { once } from "node:events";
import { Worker } from "node:worker_threads";
import { decode } from "./pprof-decode";

// A short interval: the tail after the last sample, which no sample has, is an interval long.
Bun.pprof.heap.start({ sampleInterval: 128 * 1024 });

function summarize(bytes: Uint8Array, threadId: number) {
  const profile = decode(bytes);
  const samples = profile.samples.filter(s => s.stack.some(f => f.function === "allocateInWorker"));
  return {
    threadId,
    allocSpace: samples.reduce((sum, s) => sum + s.values.alloc_space, 0),
    labels: samples.map(s => s.labels),
    frame: samples[0]?.stack.find(f => f.function === "allocateInWorker"),
    mainThreadLabels: profile.samples.find(s => s.labels.worker === undefined)?.labels,
  };
}

const worker = new Worker(new URL("./heap-fixture-worker-child.ts", import.meta.url));
const threadId = worker.threadId;
const exited = once(worker, "exit");

// `once` rejects when the Worker emits "error".
await Promise.race([
  once(worker, "message"),
  exited.then(([code]) => Promise.reject(new Error("the Worker exited: " + code))),
]);
const whileWorkerRuns = summarize(Bun.pprof.heap.profile(), threadId);
worker.postMessage("exit");
await exited;
const afterWorkerExit = summarize(Bun.pprof.heap.stop(), threadId);
console.log(JSON.stringify({ whileWorkerRuns, afterWorkerExit }));
