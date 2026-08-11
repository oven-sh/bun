// Spawned by promises.test.js with UV_THREADPOOL_SIZE=2 (see the test for what
// this checks).
//
// 1. Park both pool threads in a readFile() of a FIFO each. open("w") on a
//    FIFO returns once the reader has it open, so after that both threads are
//    inside those reads until the write ends are closed.
// 2. A worker queues operations with { signal } behind them and is terminated,
//    tearing its VM down while they are still queued.
// 3. Close the write ends: the pool drains and frees the dead worker's jobs.
import { closeSync, openSync, promises } from "node:fs";
import { join } from "node:path";
import { Worker } from "node:worker_threads";

const dir = process.argv[2];
const fifos = [join(dir, "fifo-a"), join(dir, "fifo-b")];

const parked = fifos.map(fifo => promises.readFile(fifo));
const writeEnds = fifos.map(fifo => openSync(fifo, "w"));
console.log("pool parked");

const worker = new Worker(
  `
  const fs = require("node:fs");
  const { parentPort, workerData: dir } = require("node:worker_threads");
  const ignore = () => {};
  const keep = [];
  for (let i = 0; i < 4; i++) {
    // Aborted after the operations were queued: the reason is a JS value the
    // signal holds through a GC handle.
    const aborted = new AbortController();
    // A JS abort listener registered on the signal.
    const listened = new AbortController();
    listened.signal.addEventListener("abort", ignore);
    // Owns a timer on this worker's event loop.
    const timeout = AbortSignal.timeout(60_000);
    for (const signal of [aborted.signal, listened.signal, timeout]) {
      fs.promises.readFile(dir + "/data.txt", { signal }).catch(ignore);
      fs.promises.writeFile(dir + "/write-" + i + ".txt", "x", { signal }).catch(ignore);
      fs.promises.appendFile(dir + "/append-" + i + ".txt", "x", { signal }).catch(ignore);
      fs.readFile(dir + "/data.txt", { signal }, ignore);
      fs.writeFile(dir + "/cb-write-" + i + ".txt", "x", { signal }, ignore);
    }
    aborted.abort(new Error("aborted after queueing"));
    keep.push(aborted, listened, timeout);
  }
  parentPort.postMessage("queued");
  `,
  { eval: true, workerData: dir },
);

const { promise: queued, resolve, reject } = Promise.withResolvers<void>();
worker.once("message", () => resolve());
worker.once("error", reject);
worker.once("exit", code => reject(new Error(`worker exited with code ${code} before queueing its operations`)));
await queued;
await worker.terminate();
console.log("worker torn down");

for (const fd of writeEnds) closeSync(fd);
await Promise.all(parked);
console.log("pool drained");
