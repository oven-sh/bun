const assert = require("node:assert/strict");
const { Worker, isMainThread, parentPort, workerData } = require("node:worker_threads");
const addon = require("./build/Debug/tsfn_payload_ownership.node");

if (!isMainThread) {
  const { how, capacity, count, mode } = workerData;
  const keepAlive = how === "natural" ? null : setInterval(() => {}, 1000);
  let calls = 0;
  addon.start(
    () => {
      if (++calls !== 1) return;
      queueMicrotask(() => {
        if (mode === 1) addon.abort();
        if (how === "exit") process.exit(0);
        if (how === "terminate") {
          parentPort.postMessage("checkpoint");
          // Hold the checkpoint until the parent terminates this worker.
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
        }
        if (keepAlive) clearInterval(keepAlive);
      });
    },
    capacity,
    count,
    mode,
  );
  if (how === "natural" && mode === 1) addon.abort();
} else {
  (async () => {
    const liveCount = process.isBun ? require("bun:internal-for-testing").napiThreadsafeFunctionLiveCount : () => 0;
    const before = liveCount();
    const [how, capacity, count, mode] = JSON.parse(process.argv[2]);
    const worker = new Worker(__filename, { workerData: { how, capacity, count, mode }, execArgv: [] });
    let checkpoint = false;
    const code = await new Promise((resolve, reject) => {
      worker.once("error", reject);
      worker.once("exit", resolve);
      worker.once("message", message => {
        assert.equal(message, "checkpoint");
        checkpoint = true;
        worker.terminate().catch(reject);
      });
    });
    assert.equal(code, how === "terminate" ? 1 : 0);
    if (how === "terminate") assert.equal(checkpoint, true);
    const stats = addon.stats();
    console.log(JSON.stringify(stats));
    assert.equal(stats.accepted, capacity ? Math.min(capacity, count) : count);
    assert.equal(stats.finalized, 1);
    assert.equal(stats.delivered + stats.returned, stats.accepted);
    assert.equal(stats.at_finalize, stats.accepted);
    assert.equal(stats.duplicates, 0);
    assert.equal(stats.late, 0);
    assert.equal(stats.released, 1);
    if (mode === 1) {
      assert.equal(stats.delivered, how === "natural" ? 0 : 1);
      assert.equal(stats.returned, stats.accepted - stats.delivered);
    }
    assert.equal(liveCount(), before);
  })().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}
