// Spawned by v8-heap-snapshot.test.ts in an empty directory. Prints the names
// `v8.writeHeapSnapshot()` gives when it gets no path. Only the names matter
// here, so every snapshot is "{}" and a call costs only its file.
import { readdirSync } from "node:fs";
import v8 from "node:v8";
import { Worker } from "node:worker_threads";

Object.assign(Bun, { generateHeapSnapshot: () => "{}" });

// Twice on the main thread, twice in a Worker, once more on the main thread.
const names: string[] = [v8.writeHeapSnapshot(), v8.writeHeapSnapshot()];
const worker = new Worker(
  `Bun.generateHeapSnapshot = () => "{}";
   const v8 = require("node:v8");
   require("node:worker_threads").parentPort.postMessage([v8.writeHeapSnapshot(), v8.writeHeapSnapshot()]);`,
  { eval: true },
);
const fromWorker = Promise.withResolvers<string[]>();
worker.once("message", fromWorker.resolve);
worker.once("error", fromWorker.reject);
worker.once("exit", code => fromWorker.reject(new Error(`the worker exited with code ${code} and no message`)));
names.push(...(await fromWorker.promise), v8.writeHeapSnapshot());
await worker.terminate();

// Each of the next two names is taken between two readings of the real clock.
const underMockedClock = { before: Date.now(), mockedNow: 0, name: "", after: 0 };
const { setSystemTime } = Bun.jest(import.meta.path);
setSystemTime(new Date("2000-01-01T00:00:00Z"));
underMockedClock.mockedNow = Date.now();
underMockedClock.name = v8.writeHeapSnapshot();
setSystemTime();
underMockedClock.after = Date.now();

process.env.TZ = "Pacific/Kiritimati";
const inKiritimati = { before: Date.now(), name: v8.writeHeapSnapshot(), after: 0 };
inKiritimati.after = Date.now();

console.log(JSON.stringify({ names, underMockedClock, inKiritimati, files: readdirSync(".").sort() }));
