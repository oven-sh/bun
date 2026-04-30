// Stress the process-global database list from multiple threads at once.
// Before the fix, append() from one thread could realloc the Vector backing
// store while another thread was indexing into it -> heap-use-after-free.
import { Database } from "bun:sqlite";
import { isMainThread, parentPort, Worker } from "worker_threads";

const ITERATIONS = 2000;

function hammer() {
  for (let i = 0; i < ITERATIONS; i++) {
    const db = new Database(":memory:");
    // exercise a read of the global list via a prepared statement
    db.query("select 1").get();
    db.close();
  }
}

if (isMainThread) {
  const workerCount = 4;
  let done = 0;
  const workers = [];
  for (let i = 0; i < workerCount; i++) {
    const w = new Worker(import.meta.url);
    w.on("error", err => {
      console.error("worker error", err);
      process.exit(1);
    });
    w.on("message", () => {
      done++;
      if (done === workerCount) {
        for (const w of workers) w.terminate();
        console.log("ok");
        process.exit(0);
      }
    });
    workers.push(w);
  }
  // Race the workers from the main thread too.
  hammer();
} else {
  hammer();
  parentPort.postMessage("done");
}
