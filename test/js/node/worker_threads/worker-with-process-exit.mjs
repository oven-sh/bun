import assert from "node:assert";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { Worker, isMainThread, parentPort } from "node:worker_threads";

if (isMainThread) {
  const worker = new Worker(fileURLToPath(import.meta.url));
  worker.postMessage("process.exit(2); parentPort.postMessage('done')");
  worker.on("message", () => {
    assert.fail("worker should not send a message");
  });
  const [exitCode] = await once(worker, "exit");
  assert.strictEqual(exitCode, 2);
} else {
  parentPort.on("message", code => {
    console.log(`EVAL(${code})`);
    eval(code);
  });
}
