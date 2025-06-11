import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { Worker, isMainThread, parentPort } from "node:worker_threads";

if (isMainThread) {
  const { test, expect } = await import("bun:test");

  test("process.exit() works", async () => {
    const worker = new Worker(fileURLToPath(import.meta.url));

    worker.on("message", () => expect().fail("worker should not keep executing after process.exit()"));
    worker.postMessage("boom");

    const [exitCode] = await once(worker, "exit");
    expect(exitCode).toBe(2);
  });
} else {
  console.log("Worker thread started");

  parentPort!.on("message", message => {
    console.log(`Worker received: ${message}`);

    console.log("About to call process.exit(2)...");
    process.exit(2);
    console.log("process.exit(2) called");

    parentPort!.postMessage("i'm still alive!");
  });

  console.log("Worker is ready, waiting for messages...");
}
