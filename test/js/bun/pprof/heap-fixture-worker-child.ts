import { parentPort } from "node:worker_threads";

type Buffers = ArrayBuffer[];
const kept: Buffers = [];

function allocateInWorker(count: number): number {
  for (let i = 0; i < count; i++) kept.push(new ArrayBuffer(1024 * 1024)); // line 7
  return kept.length;
}

parentPort!.on("message", () => process.exit(0));
parentPort!.postMessage(allocateInWorker(32));
