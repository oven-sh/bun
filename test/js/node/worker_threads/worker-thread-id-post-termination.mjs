import assert from "node:assert";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { Worker, isMainThread, threadId } from "node:worker_threads";

const sleeptime = 100;

if (isMainThread) {
  const worker = new Worker(fileURLToPath(import.meta.url));
  assert.strictEqual(threadId, 0);
  assert.strictEqual(worker.threadId, 1);
  console.log("  (main) threadId:", worker.threadId);

  await sleep(sleeptime);
  assert.strictEqual(await worker.terminate(), 1);
  assert.strictEqual(worker.threadId, -1); // should be -1 after termination
  assert.strictEqual(await worker.terminate(), undefined); // sequential calling is basically no-op
  assert.strictEqual(worker.threadId, -1);
} else {
  console.log("(worker) threadId:", threadId);
  assert.strictEqual(threadId, 1);
  await sleep(sleeptime * 2); // keep it alive definitely longer than the parent
}
