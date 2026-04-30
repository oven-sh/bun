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
  let exited = 0;
  for (let i = 0; i < workerCount; i++) {
    const w = new Worker(import.meta.url);
    w.on("error", err => {
      console.error("worker error", err);
      process.exitCode = 1;
    });
    // Wait for the worker to fully exit rather than just postMessage so
    // crashes during teardown are not masked.
    w.on("exit", code => {
      if (code !== 0) {
        console.error("worker exited with code", code);
        process.exitCode = 1;
      }
      exited++;
      if (exited === workerCount) {
        if (!process.exitCode) console.log("ok");
      }
    });
  }
  // Race the workers from the main thread too.
  hammer();
} else {
  hammer();
  parentPort.postMessage("done");
  parentPort.close();
}
