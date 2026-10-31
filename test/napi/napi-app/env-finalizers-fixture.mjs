import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { setImmediate } from "node:timers/promises";
import { isMainThread, parentPort, Worker, workerData } from "node:worker_threads";

const addon = createRequire(import.meta.url)("./build/Debug/test_env_finalizers.node");
const expected = { counts: [1, 1, 1, 1], offThread: 0, nullEnv: 0 };

async function collect() {
  const deadline = Date.now() + 5000;
  while (addon.stats().counts.some(count => count === 0) && Date.now() < deadline) {
    if (globalThis.Bun) Bun.gc(true);
    else globalThis.gc();
    await setImmediate();
  }
  assert.deepEqual(addon.stats(), expected);
}

if (!isMainThread) {
  globalThis.held = addon.make();
  if (workerData.gc) {
    globalThis.held = null;
    await collect();
  }
  parentPort.on("message", () => process.exit(0));
  parentPort.postMessage("ready");
} else {
  const mode = process.argv[2];
  if (mode.startsWith("main-")) {
    globalThis.held = addon.make();
    if (mode === "main-gc") {
      globalThis.held = null;
      await collect();
    }
    if (mode === "main-exit") process.exit(0);
  } else {
    const worker = new Worker(new URL(import.meta.url), { workerData: { gc: mode.startsWith("gc-") } });
    try {
      const exited = new Promise((resolve, reject) => {
        worker.once("exit", resolve);
        worker.once("error", reject);
      });
      await Promise.race([
        new Promise(resolve => worker.once("message", resolve)),
        exited.then(code => {
          throw new Error(`Worker exited before ready: ${code}`);
        }),
      ]);
      if (mode.endsWith("terminate")) {
        assert.equal(await worker.terminate(), 1);
      } else {
        worker.postMessage("exit");
        assert.equal(await exited, 0);
      }
      assert.deepEqual(addon.stats(), expected);
      console.log("finalized once on the creating thread");
    } finally {
      await worker.terminate();
    }
  }
}
